import { fileLogger } from "#src/runtime.ts";

const logger = fileLogger(import.meta.url);

// Create consumer client singleton
// import { SchemaRegistry } from "@platformatic/kafka";
import {
	type BeforeHookPayloadType,
	type ConsumeOptions,
	Consumer,
	type ConsumerOptions,
	type DeserializationErrorHandler,
	type Message,
	MessagesStreamFallbackModes,
	type MessagesStreamModeValue,
	ProduceAcks,
	Producer,
	type ProducerOptions,
	stringSerializer
} from "@platformatic/kafka";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import { commitBatch } from "./commit.ts";
import type {
	BatchHandler,
	ClassifiedMessage,
	DlqFailure
} from "./handlers/transactionBatchHandler.ts";

/**
 * `undefined` is a tombstone or empty payload. A CONTINUE'd poison message
 * instead carries the raw Buffer with `metadata.deserializationError` set, so
 * anything reading `message.value` must check `hasDeserialisationFailure`
 * first and cope with a missing value.
 */
export type ConsumedValue = DomainTransactionSchema | undefined;

export type KafkaMessage = Message<string, ConsumedValue, string, string>;

export type KafkaConsumer = Consumer<string, ConsumedValue, string, string>;

export async function createKafkaConsumer<Key, Value, HeaderKey, HeaderValue>(
	options: ConsumerOptions<Key, Value, HeaderKey, HeaderValue>
) {
	const kafkaConsumer = new Consumer(options);

	// Register listeners
	kafkaConsumer.addListener("consumer:group:rebalance", () =>
		logger.warn("Preparing a rebalance")
	);

	kafkaConsumer.addListener("client:broker:disconnect", () => {
		logger.warn("Consumer disconnected");
	});

	return kafkaConsumer;
}

/**
 * Creates a DLQ kafka producer
 * No serializers should be passed.
 * Raw messages should be persisted as is
 */
export type DlqProducer = Producer<string, Buffer, string, string>;

export async function createKafkaDlqProducer(
	options: Omit<ProducerOptions<string, Buffer, string, string>, "serializers">
) {
	const kafkaDlqProducer = new Producer({
		...options,
		acks: ProduceAcks.ALL,
		serializers: {
			key: stringSerializer,
			headerKey: stringSerializer,
			headerValue: stringSerializer
		}
	});

	return kafkaDlqProducer;
}

function toDlqRecord(dlqTopic: string, failure: DlqFailure) {
	const { message, error } = failure;

	return {
		topic: dlqTopic,
		key: `${message.topic}-${message.partition}-${message.offset}`,
		value:
			message.kind === "poison"
				? (message.raw ?? Buffer.alloc(0))
				: Buffer.from(JSON.stringify(message.value)),
		headers: {
			"x-dlq-reason":
				message.kind === "poison" ? "deserialization" : "processing",
			"x-dlq-error": error instanceof Error ? error.message : String(error),
			"x-source-topic": message.topic,
			"x-source-partition": String(message.partition),
			"x-source-offset": message.offset.toString()
		}
	};
}

export function createDlqSender(dlqProducer: DlqProducer, dlqTopic: string) {
	return async function sendToDlq(failures: DlqFailure[]) {
		if (failures.length === 0) return;

		const records = [];
		for (const failure of failures) {
			records.push(toDlqRecord(dlqTopic, failure));
		}

		dlqProducer.send({ messages: records, acks: -1 });
	};
}

/**
 * What the stream writes onto `metadata` when the handler returned CONTINUE
 * (messages-stream.js:673). `Message.metadata` is `Record<string, unknown>`, so
 * this narrows rather than blindly casting.
 */
interface DeserialisationFailure {
	error: unknown;
	payloadType: BeforeHookPayloadType;
}

function deserialisationFailureOf(
	message: KafkaMessage
): DeserialisationFailure | undefined {
	const failure = message.metadata.deserializationError;

	return failure && typeof failure === "object"
		? (failure as DeserialisationFailure)
		: undefined;
}

export function classifyMessages(messages: KafkaMessage[]) {
	const classifiedMessages: ClassifiedMessage[] = [];

	for (const message of messages) {
		const origin = {
			topic: message.topic,
			partition: message.partition,
			offset: message.offset
		};
		const failure = deserialisationFailureOf(message);
		if (failure) {
			classifiedMessages.push({
				...origin,
				kind: "poison",
				// CONTINUE hands back record.value verbatim as the raw Buffer
				// (messages-stream.js:671), which is the whole point of the DLQ.
				raw: (message.value as Buffer | null | undefined) ?? null,
				error: failure.error
			});
		} else if (message.value == null) {
			classifiedMessages.push({ ...origin, kind: "tombstone" });
		} else {
			classifiedMessages.push({
				...origin,
				kind: "valid",
				value: message.value
			});
		}
	}

	return classifiedMessages;
}

export interface BatchConsumerOptions {
	topics: string[];
	mode: MessagesStreamModeValue;
	maxWaitTime: number;
	batchSize: number;
	lingerMs: number;
	maxRetries: number;
	retryBaseDelayMs: number;
}

export async function startBatchConsumer(
	consumer: KafkaConsumer,
	onBatch: BatchHandler,
	onDeserialisationFailure: DeserializationErrorHandler,
	options: BatchConsumerOptions,
	overrides?: Partial<ConsumeOptions<string, ConsumedValue, string, string>>
) {
	const messageStream = await consumer.consume({
		topics: options.topics,
		mode: options.mode,
		fallbackMode: MessagesStreamFallbackModes.EARLIEST,
		maxWaitTime: options.maxWaitTime,
		...overrides,
		autocommit: false,
		onDeserializationError: onDeserialisationFailure
	});

	let messageBatch: KafkaMessage[] = [];
	let timeoutId: NodeJS.Timeout | null = null;

	async function flushBatch() {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}

		const batch = messageBatch;
		messageBatch = [];

		if (batch.length === 0) return;

		await onBatch(classifyMessages(batch));

		try {
			await commitBatch(batch);
		} catch (error) {
			logger.warn(
				{ error: error, size: batch.length },
				"Commit failed after a successful flush."
			);
		}
	}

	for await (const message of messageStream) {
		messageBatch.push(message);

		if (messageBatch.length === 1) {
			timeoutId = setTimeout(() => {
				flushBatch().catch((error: unknown) => {
					messageStream.destroy(
						error instanceof Error ? error : new Error(String(error))
					);
				});
			}, options.lingerMs);
		}

		if (messageBatch.length >= options.batchSize) {
			await flushBatch();
		}
	}
}
