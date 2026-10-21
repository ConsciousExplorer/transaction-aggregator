import {
	type Link,
	propagation,
	ROOT_CONTEXT,
	SpanKind,
	trace
} from "@opentelemetry/api";
import {
	type BaseOptions,
	type BeforeHookPayloadType,
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
import type { Registry } from "@prometheus-io/client";
import * as prometheusClient from "@prometheus-io/client";
import { createFileLogger } from "#src/logger.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import {
	batchFlushDurationSeconds,
	batchFlushTotal,
	batchSize,
	deadLetterMessagesTotal
} from "#src/telemetry/metrics.ts";
import { runInSpan } from "#src/telemetry/tracing.ts";
import type { DecodedValue } from "./avro-deserialiser.ts";
import { commitBatch } from "./commit.ts";
import type {
	BatchHandler,
	ClassifiedMessage,
	DeadLetterFailure
} from "./handlers/transactionBatchHandler.ts";

const logger = createFileLogger(import.meta.url);

/**
 * `undefined` is a tombstone or empty payload. A CONTINUE'd poison message
 * instead carries the raw Buffer with `metadata.deserializationError` set, so
 * anything reading `message.value` must check `hasDeserialisationFailure`
 * first and cope with a missing value.
 */
export type ConsumedValue = DecodedValue<DomainTransactionSchema> | undefined;

export type KafkaMessage = Message<string, ConsumedValue, string, string>;

export type KafkaConsumer = Consumer<string, ConsumedValue, string, string>;

/**
 * The client declares its own copy of the prom-client types, which the real
 * client satisfies at runtime but not exactly as types — hence the cast.
 */
function buildKafkaMetricsOptions(registry: Registry) {
	return { registry, client: prometheusClient } as unknown as NonNullable<
		BaseOptions["metrics"]
	>;
}

/**
 * Given a registry, the client records its own metrics there
 * (kafka_consumed_messages, kafka_consumers_lags, ...). Without one, none.
 */
export function createKafkaConsumer<Key, Value, HeaderKey, HeaderValue>(
	options: ConsumerOptions<Key, Value, HeaderKey, HeaderValue>,
	registry?: Registry
) {
	const consumerOptions = { ...options };

	if (registry) {
		consumerOptions.metrics = buildKafkaMetricsOptions(registry);
	}

	const kafkaConsumer = new Consumer(consumerOptions);

	// Register listeners
	kafkaConsumer.addListener("consumer:group:rebalance", () =>
		logger.warn("Preparing a rebalance")
	);

	kafkaConsumer.addListener("client:broker:disconnect", () => {
		logger.warn("Consumer disconnected");
	});

	return kafkaConsumer;
}

export type DeadLetterProducer = Producer<string, Buffer, string, string>;

/**
 * Creates a DLQ kafka producer
 * No serializers should be passed.
 * Raw messages should be persisted as is
 * Given a registry, the client records its own metrics there
 * (kafka_produced_messages, ...). Without one, none.
 */
export function createKafkaDeadLetterProducer(
	options: Omit<ProducerOptions<string, Buffer, string, string>, "serializers">,
	registry?: Registry
) {
	const producerOptions = {
		...options,
		acks: ProduceAcks.ALL,
		serializers: {
			key: stringSerializer,
			headerKey: stringSerializer,
			headerValue: stringSerializer
		}
	};

	if (registry) {
		producerOptions.metrics = buildKafkaMetricsOptions(registry);
	}

	const kafkaDeadLetterProducer = new Producer(producerOptions);

	return kafkaDeadLetterProducer;
}

function chooseDeadLetterReason(failure: DeadLetterFailure) {
	return failure.message.kind === "poison" ? "deserialisation" : "processing";
}

/**
 * The record as it arrived: its key, its raw bytes and its own headers, so a
 * redrive re-produces the original onto the customer's partition. The DLQ
 * headers go on top and win a name clash; where it came from and when it was
 * produced travel as headers too.
 */
function buildDeadLetterRecord(
	deadLetterTopic: string,
	failure: DeadLetterFailure
) {
	const { message, error } = failure;

	const headers: Record<string, string> = {};
	for (const [key, value] of message.headers) {
		headers[key] = value;
	}
	headers["x-dlq-reason"] = chooseDeadLetterReason(failure);
	headers["x-dlq-error"] =
		error instanceof Error ? error.message : String(error);
	headers["x-source-topic"] = message.topic;
	headers["x-source-partition"] = String(message.partition);
	headers["x-source-offset"] = message.offset.toString();
	headers["x-source-timestamp"] = String(message.recordTimestamp);

	return {
		topic: deadLetterTopic,
		// A record produced without a key is dead-lettered without one
		...(message.key !== undefined && { key: message.key }),
		value: message.raw ?? Buffer.alloc(0),
		headers
	};
}

export function createDeadLetterSender(
	deadLetterProducer: DeadLetterProducer,
	deadLetterTopic: string
) {
	return async function sendToDeadLetterQueue(failures: DeadLetterFailure[]) {
		if (failures.length === 0) return;

		const records: ReturnType<typeof buildDeadLetterRecord>[] = [];
		for (const failure of failures) {
			records.push(buildDeadLetterRecord(deadLetterTopic, failure));
		}

		// One span per send: it is one produce request, however many records
		await runInSpan(
			"dlq.publish",
			{
				kind: SpanKind.PRODUCER,
				attributes: {
					"messaging.system": "kafka",
					"messaging.operation.type": "send",
					"messaging.destination.name": deadLetterTopic,
					"messaging.batch.message_count": records.length
				}
			},
			() => deadLetterProducer.send({ messages: records, acks: -1 })
		);

		for (const failure of failures) {
			deadLetterMessagesTotal.inc({ reason: chooseDeadLetterReason(failure) });
		}
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

function getDeserialisationFailure(message: KafkaMessage) {
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
			offset: message.offset,
			key: message.key,
			recordTimestamp: Number(message.timestamp),
			headers: message.headers
		};
		const failure = getDeserialisationFailure(message);
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
				value: message.value.value,
				raw: message.value.raw
			});
		}
	}

	return classifiedMessages;
}

export interface BatchConsumerOptions {
	topics: string[];
	mode: MessagesStreamModeValue;
	maxWaitTime: number;
	fetchMaxBytes: number;
	batchSize: number;
	lingerMs: number;
}

type FlushTrigger = "size" | "linger" | "stream_end";

/**
 * One link per message that carries a W3C traceparent header, pointing at the
 * trace context the producer minted for it.
 */
function buildSpanLinks(batch: KafkaMessage[]) {
	const links: Link[] = [];

	for (const message of batch) {
		const traceparent = message.headers.get("traceparent");
		if (!traceparent) continue;

		const extracted = propagation.extract(ROOT_CONTEXT, { traceparent });
		const spanContext = trace.getSpanContext(extracted);
		if (spanContext) links.push({ context: spanContext });
	}

	return links;
}

/**
 * The batch being filled, and what a flush needs to hand it on. `startBatchConsumer`
 * owns it; `drainBatch` and `flushBatch` take it as a parameter.
 */
interface BatchState {
	messages: KafkaMessage[];
	lingerTimer: NodeJS.Timeout | null;
	// Orders flushes one after another. The linger timer cannot await, so
	// without this a timer-triggered flush can run while a size-triggered one is
	// still inserting — two concurrent transactions, two commits, and
	// `messages` mutated in between. Every flush chains onto the previous, and
	// once one fails every later flush fails with it (see `flushBatch`).
	inFlight: Promise<void>;
	onBatch: BatchHandler;
	topic: string;
}

async function drainBatch(state: BatchState, trigger: FlushTrigger) {
	if (state.lingerTimer) {
		clearTimeout(state.lingerTimer);
		state.lingerTimer = null;
	}

	// Swapped for a new array, never emptied in place: `batch` keeps these
	// messages while the loop fills the next batch.
	const batch = state.messages;
	state.messages = [];

	if (batch.length === 0) return;

	const endFlushTimer = batchFlushDurationSeconds.startTimer();
	batchFlushTotal.inc({ trigger });
	batchSize.observe(batch.length);

	// Timed whether it succeeds or not, so a slow failure shows up too
	try {
		await runInSpan(
			`consume.batch ${state.topic}`,
			{
				// Each batch is its own trace. The producers' traces are links,
				// not parents: one span cannot have a parent per message.
				root: true,
				kind: SpanKind.CONSUMER,
				links: buildSpanLinks(batch),
				attributes: {
					"messaging.system": "kafka",
					"messaging.destination.name": state.topic,
					"messaging.batch.message_count": batch.length,
					"batch.trigger": trigger
				}
			},
			async () => {
				await state.onBatch(classifyMessages(batch));

				try {
					await commitBatch(batch);
				} catch (error) {
					logger.warn(
						{ err: error, size: batch.length },
						"Commit failed after a successful flush."
					);
				}
			}
		);
	} finally {
		endFlushTimer();
	}
}

function flushBatch(state: BatchState, trigger: FlushTrigger) {
	const flushed = state.inFlight.then(() => drainBatch(state, trigger));
	// The queue keeps the rejection. A flush queued behind a failed one then
	// fails with the same error before it inserts or commits anything: its
	// commit would move the group's offset past the batch that was never
	// stored. Every caller handles the rejection by ending the consumer, and
	// the restart reads the failed batch again.
	state.inFlight = flushed;
	return flushed;
}

export async function startBatchConsumer(
	consumer: KafkaConsumer,
	onBatch: BatchHandler,
	onDeserialisationFailure: DeserializationErrorHandler,
	options: BatchConsumerOptions
) {
	const messageStream = await consumer.consume({
		topics: options.topics,
		mode: options.mode,
		fallbackMode: MessagesStreamFallbackModes.EARLIEST,
		maxWaitTime: options.maxWaitTime,
		// The stream takes in a whole fetch before it applies backpressure, so
		// the fetch size is the bound on the records held in memory
		maxBytes: options.fetchMaxBytes,
		autocommit: false,
		onDeserializationError: onDeserialisationFailure
	});

	const state: BatchState = {
		messages: [],
		lingerTimer: null,
		inFlight: Promise.resolve(),
		onBatch,
		topic: options.topics.join(",")
	};

	for await (const message of messageStream) {
		state.messages.push(message);

		if (state.messages.length === 1) {
			state.lingerTimer = setTimeout(() => {
				flushBatch(state, "linger").catch((error: unknown) => {
					messageStream.destroy(
						error instanceof Error ? error : new Error(String(error))
					);
				});
			}, options.lingerMs);
		}

		if (state.messages.length >= options.batchSize) {
			await flushBatch(state, "size");
		}
	}

	// The stream ended with a partial batch still buffered — flush it, and let
	// a failure propagate rather than dropping the messages silently.
	await flushBatch(state, "stream_end");
}
