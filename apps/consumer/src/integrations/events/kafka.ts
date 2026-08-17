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
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import type { CardTransaction } from "#src/generated/card.ts";

/**
 * Value is `CardTransaction`, not `CardTransaction | undefined`, because that is
 * what TypeScript infers from the deserializer at the call site — the `| undefined`
 * in its return type is not carried into `Value`.
 *
 * Two cases make that optimistic at runtime: a tombstone (empty payload) returns
 * undefined, and a CONTINUE'd message carries the raw Buffer instead. Anything
 * reading `message.value` must check `hasDeserialisationFailure` first and cope
 * with a missing value.
 */
export type CardConsumer = Consumer<string, CardTransaction, string, string>;
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

export async function startBatchConsumer<Key, Value, HeaderKey, HeaderValue>(
	consumer: Consumer<Key, Value, HeaderKey, HeaderValue>,
	dlqProducer: DlqProducer,
	dlqTopic: string,
	pool: Pool,
	ruleCategorizer: RuleCategorizer,
	batchHandler: (
		pool: Pool,
		messages: Message<Key, Value, HeaderKey, HeaderValue>[],
		ruleCategorizer: RuleCategorizer
	) => Promise<void>,
	deserialisationErrorHandler: DeserializationErrorHandler,
	options: BatchConsumerOptions,
	overrides?: Partial<ConsumeOptions<Key, Value, HeaderKey, HeaderValue>>
) {
	type ConsumedMessage = Message<Key, Value, HeaderKey, HeaderValue>;

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

		if (messageBatch.length === 0) return;

		// Create a new batch of messages and clear the old ones.
		// We create a copy so that the existing one does not grow on failure
		const batch = messageBatch;
		messageBatch = [];

		// Setup failure and clean messages
		const poison = batch.filter((message) =>
			hasDeserialisationFailure(message)
		);
		const valid = batch.filter(
			(message) => !hasDeserialisationFailure(message)
		);

		try {
			// Both have to be durable before a single offset moves: the rows in
			// Postgres, and the undeserialisable records on the DLQ topic.
			await batchHandler(pool, valid, ruleCategorizer);
			await sendToDLQ(dlqProducer, dlqTopic, poison);
		} catch (error) {
			// Classify errors
			const failure = classifyPostgresError(error, "Batch insert failed");

			// TODO: Check
			if (failure instanceof NonRetryableError) {
				logger.error(
					{ error },
					"A non retryable error was encountered, not halting"
				);
				await sendToDLQ(dlqProducer, dlqTopic, batch);
			}

			if (failure instanceof RetryableError) {
				logger.error(
					"We encountered a retyrable error, a consumer restart will fix"
				);

				throw error;
			}

			// Rethrow rather than swallow. Falling through to the commit below
			// would advance offsets past rows that were never inserted — the
			// batch replays on the next run instead.
			logger.error(
				{
					error,
					size: batch.length,
					valid: valid.length,
					poison: poison.length
				},
				"Batch failed — not committing"
			);
		}

		if (poison.length > 0) {
			logger.warn(
				{ size: poison.length, dlqTopic },
				"Dead-lettered undeserialisable messages"
			);
		}

		try {
			// Commit only once the batch is durably handled — including the
			// poison records, which are now safely on the DLQ topic.
			await commitBatch(batch);
		} catch (error) {
			logger.warn(
				{ err: error, size: batch.length },
				"Commit failed after a successful insert — offsets will replay"
			);
		}
	}

	for await (const message of messageStream) {
		messageBatch.push(message);

		// First message of a batch starts the clock, so a partial batch still
		// gets processed on a quiet topic.
		if (messageBatch.length === 1) {
			timeoutId = setTimeout(() => {
				flushBatch().catch((error: unknown) => {
					// flushBatch throws now, and a timer rejection has nobody to
					// propagate to. Destroying the stream makes the for-await
					// below rethrow it on the caller's stack instead.
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
