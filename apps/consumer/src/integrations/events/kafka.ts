import {
	type Link,
	propagation,
	ROOT_CONTEXT,
	SpanKind,
	trace
} from "@opentelemetry/api";
import {
	type BaseOptions,
	Consumer,
	type ConsumerOptions,
	type DeserializationErrorHandler,
	type Message,
	MessagesStreamFallbackModes,
	type MessagesStreamModeValue,
	type MessageToProduce,
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
 * anything reading `message.value` must check `getDeserialisationFailure`
 * first and cope with a missing value.
 */
type ConsumedValue = DecodedValue<DomainTransactionSchema> | undefined;

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
export function createKafkaConsumer(
	options: ConsumerOptions<string, ConsumedValue, string, string>,
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
		serializers: {
			key: stringSerializer,
			headerKey: stringSerializer,
			headerValue: stringSerializer
		}
	};

	if (registry) {
		producerOptions.metrics = buildKafkaMetricsOptions(registry);
	}

	return new Producer(producerOptions);
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

	const record: MessageToProduce<string, Buffer, string, string> = {
		topic: deadLetterTopic,
		value: message.raw ?? Buffer.alloc(0),
		headers
	};
	// A record produced without a key is dead-lettered without one
	if (message.key !== undefined) {
		record.key = message.key;
	}
	return record;
}

export function createDeadLetterSender(
	deadLetterProducer: DeadLetterProducer,
	deadLetterTopic: string
) {
	return async function sendToDeadLetterQueue(failures: DeadLetterFailure[]) {
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
			// Set on each send: send() falls back to a leader-only ack and never
			// reads an acks given to the producer
			() =>
				deadLetterProducer.send({ messages: records, acks: ProduceAcks.ALL })
		);

		for (const failure of failures) {
			deadLetterMessagesTotal.inc({ reason: chooseDeadLetterReason(failure) });
		}
	};
}

/**
 * What the stream writes onto `metadata` when the handler returned CONTINUE.
 * `Message.metadata` is `Record<string, unknown>`, so this narrows rather than
 * blindly casting.
 */
interface DeserialisationFailure {
	error: unknown;
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
	fetchMinBytes: number;
	fetchMaxBytes: number;
	batchSize: number;
}

/** What closed the batch: it reached `batchSize`, or the fetch it came from was used up. */
type FlushTrigger = "size" | "fetch";

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
 * Hands the batch to the handler, then commits its offsets. The consume loop
 * awaits every flush, so one runs at a time and a rejection ends the loop.
 */
async function flushBatch(
	batch: KafkaMessage[],
	onBatch: BatchHandler,
	topic: string,
	trigger: FlushTrigger
) {
	const endFlushTimer = batchFlushDurationSeconds.startTimer();
	batchFlushTotal.inc({ trigger });
	batchSize.observe(batch.length);

	// Timed whether it succeeds or not, so a slow failure shows up too
	try {
		await runInSpan(
			`consume.batch ${topic}`,
			{
				// Each batch is its own trace. The producers' traces are links,
				// not parents: one span cannot have a parent per message.
				root: true,
				kind: SpanKind.CONSUMER,
				links: buildSpanLinks(batch),
				attributes: {
					"messaging.system": "kafka",
					"messaging.destination.name": topic,
					"messaging.batch.message_count": batch.length,
					"batch.trigger": trigger
				}
			},
			async () => {
				await onBatch(classifyMessages(batch));
				// A commit that fails rejects the flush and ends the consumer. The
				// rows are stored, so the restart reads them again and the insert
				// skips them as duplicates.
				await commitBatch(batch);
			}
		);
	} finally {
		endFlushTimer();
	}
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
		// The broker holds a fetch until minBytes are ready or maxWaitTime has
		// passed: Kafka's own linger, and where a batch gathers at low rates
		minBytes: options.fetchMinBytes,
		maxWaitTime: options.maxWaitTime,
		// The stream takes in a whole fetch before it applies backpressure, so
		// the fetch size and the stream's buffer bound the records held in memory
		maxBytes: options.fetchMaxBytes,
		autocommit: false,
		onDeserializationError: onDeserialisationFailure
	});
	const topic = options.topics.join(",");

	let batch: KafkaMessage[] = [];
	for await (const message of messageStream) {
		batch.push(message);

		// The client pushes a whole fetch into the stream before the loop sees
		// any of it, so an empty stream means this fetch is used up. The batch
		// is flushed then rather than held open for the next fetch, and the
		// loop pulls nothing more until the flush and its commit are done.
		const isFull = batch.length >= options.batchSize;
		if (!isFull && messageStream.readableLength > 0) continue;

		await flushBatch(batch, onBatch, topic, isFull ? "size" : "fetch");
		batch = [];
	}
	// The stream ends only when shutdown closes the consumer, and a closed
	// consumer can't commit. Whatever it still held is read again after the
	// restart.
}
