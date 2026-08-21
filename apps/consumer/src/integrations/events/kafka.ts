import type { Pool } from "pg";
import { fileLogger } from "../../runtime.ts";

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
import type { RuleCategorizer } from "#src/domain/categorisation/rule-categorizer.ts";
import type { Normaliser } from "#src/domain/normaliser/normaliser.ts";
import type { CardTransaction } from "#src/generated/card.ts";
import type { DebitOrderTransaction } from "#src/generated/debit_order.ts";
import type { EftTransaction } from "#src/generated/eft.ts";
import type { InternalTransferTransaction } from "#src/generated/internal_transfer.ts";
import type { LoanTransaction } from "#src/generated/loan.ts";
// import type { CardTransaction } from "#src/generated/card.ts";

export type ConsumedTransaction =
	| CardTransaction
	| EftTransaction
	| DebitOrderTransaction
	| InternalTransferTransaction
	| LoanTransaction;

/**
 * `undefined` is a tombstone or empty payload. A CONTINUE'd poison message
 * instead carries the raw Buffer with `metadata.deserializationError` set, so
 * anything reading `message.value` must check `hasDeserialisationFailure`
 * first and cope with a missing value.
 */
export type ConsumedValue = ConsumedTransaction | undefined;

export type ConsumedMessage = Message<string, ConsumedValue, string, string>;

export type KafkaConsumer = Consumer<string, ConsumedValue, string, string>;
export async function createKafkaConsumer<Key, Value, HeaderKey, HeaderValue>(
	options: ConsumerOptions<Key, Value, HeaderKey, HeaderValue>
): Promise<Consumer<Key, Value, HeaderKey, HeaderValue>> {
	const kafkaConsumer = new Consumer(options);

	// Connects and authenticates. Same as postgres select 1
	await kafkaConsumer.metadata({ forceUpdate: true });

	// Register listerners
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
): Promise<DlqProducer> {
	const kafkaDlqProducer = new Producer({
		...options,
		acks: ProduceAcks.ALL,
		serializers: {
			key: stringSerializer,
			headerKey: stringSerializer,
			headerValue: stringSerializer
		}
	});
	// Connects and authenticates. Same as postgres select 1
	await kafkaDlqProducer.metadata({});

	return kafkaDlqProducer;
}

export async function sendToDLQ<Key, Value, HeaderKey, HeaderValue>(
	dlqProducer: DlqProducer,
	dlqTopic: string,
	messages: readonly Message<Key, Value, HeaderKey, HeaderValue>[]
): Promise<void> {
	if (messages.length === 0) return;

	await dlqProducer.send({
		messages: messages.map((message) => {
			const failure = deserialisationFailureOf(message);

			return {
				topic: dlqTopic,
				// Unique and traceable, and it spreads evenly across DLQ partitions.
				key: `${message.topic}-${message.partition}-${message.offset}`,
				// Already a Buffer: CONTINUE hands back record.value verbatim
				// (messages-stream.js:671), which is the whole point of the DLQ.
				value: message.value as Buffer,
				headers: {
					"x-dlq-reason": "deserialization",
					"x-dlq-payload-type": failure?.payloadType ?? "unknown",
					"x-dlq-error":
						failure?.error instanceof Error
							? failure.error.message
							: String(failure?.error),
					"x-source-topic": message.topic,
					"x-source-partition": String(message.partition),
					// bigint -> string: header values must be strings, and
					// JSON.stringify throws on a raw bigint anyway.
					"x-source-offset": message.offset.toString()
				}
			};
		})
	});
}

export interface CommittableMessage {
	topic: string;
	partition: number;
	offset: bigint;
	commit(): void | Promise<void>;
}

export async function commitBatch(
	messages: readonly CommittableMessage[]
): Promise<void> {
	const highest = new Map<string, CommittableMessage>();
	for (const message of messages) {
		const key = `${message.topic}:${message.partition}`;
		const current = highest.get(key);

		if (!current || message.offset > current.offset) {
			highest.set(key, message);
		}
	}

	await Promise.all([...highest.values()].map((message) => message.commit()));
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

/**
 * What the stream writes onto `metadata` when the handler returned CONTINUE
 * (messages-stream.js:673). `Message.metadata` is `Record<string, unknown>`, so
 * this narrows rather than blindly casting.
 */
export interface DeserialisationFailure {
	error: unknown;
	payloadType: BeforeHookPayloadType;
}

export function deserialisationFailureOf(message: {
	metadata: Record<string, unknown>;
}): DeserialisationFailure | undefined {
	const failure = message.metadata.deserializationError;

	return failure && typeof failure === "object"
		? (failure as DeserialisationFailure)
		: undefined;
}

export function hasDeserialisationFailure(message: {
	metadata: Record<string, unknown>;
}): boolean {
	return deserialisationFailureOf(message) !== undefined;
}

export async function startBatchConsumer(
	consumer: KafkaConsumer,
	dlqProducer: DlqProducer,
	dlqTopic: string,
	pool: Pool,
	transactionNormaliser: Normaliser,
	ruleCategorizer: RuleCategorizer,
	batchHandler: (
		pool: Pool,
		messages: ConsumedMessage[],
		dlqProducer: DlqProducer,
		dlqTopic: string,
		transactionNormaliser: Normaliser,
		ruleCategorizer: RuleCategorizer
	) => Promise<void>,
	deserialisationErrorHandler: DeserializationErrorHandler,
	options: BatchConsumerOptions,
	overrides?: Partial<ConsumeOptions<string, ConsumedValue, string, string>>
) {
	const messageStream = await consumer.consume({
		topics: options.topics,
		mode: options.mode,
		// Only consulted when the group has no committed offset for a partition.
		fallbackMode: MessagesStreamFallbackModes.EARLIEST,
		maxWaitTime: options.maxWaitTime,
		...overrides,
		autocommit: false,
		onDeserializationError: deserialisationErrorHandler
	});

	// Creating our own batch handler
	let messageBatch: ConsumedMessage[] = [];
	let timeoutId: NodeJS.Timeout | null = null;

	async function flushBatch(): Promise<void> {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}

		// Create a new batch of messages and clear the old ones.
		// We create a copy so that the existing one does not grow on failure
		const batch = messageBatch;
		messageBatch = [];
		if (batch.length === 0) return;

		await batchHandler(
			pool,
			batch,
			dlqProducer,
			dlqTopic,
			transactionNormaliser,
			ruleCategorizer
		);
	}

	for await (const message of messageStream) {
		messageBatch.push(message);

		// First message of a batch starts the clock, so a partial batch still
		// gets processed on a quiet topic.
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

	// The stream ended - whatever is left is still a batch worth processing.
	await flushBatch();
}
