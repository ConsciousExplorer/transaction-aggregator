import { fileLogger } from "#src/logger.ts";
import {
	batchFlushDurationSeconds,
	batchFlushTotal,
	batchSize,
	dlqMessagesTotal
} from "#src/telemetry/metrics.ts";
import { withSpan } from "#src/telemetry/tracing.ts";

const logger = fileLogger(import.meta.url);

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
import type { Registry } from "@prometheus-io/client";
import * as prometheusClient from "@prometheus-io/client";
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

/**
 * The client declares its own copy of the prom-client types, which the real
 * client satisfies at runtime but not exactly as types — hence the cast.
 */
function kafkaMetrics(registry: Registry) {
	return { registry, client: prometheusClient } as unknown as NonNullable<
		BaseOptions["metrics"]
	>;
}

/**
 * Given a registry, the client records its own metrics there
 * (kafka_consumed_messages, kafka_consumers_lags, ...). Without one, none.
 */
export async function createKafkaConsumer<Key, Value, HeaderKey, HeaderValue>(
	options: ConsumerOptions<Key, Value, HeaderKey, HeaderValue>,
	registry?: Registry
) {
	const consumerOptions = { ...options };

	if (registry) {
		consumerOptions.metrics = kafkaMetrics(registry);
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

/**
 * Creates a DLQ kafka producer
 * No serializers should be passed.
 * Raw messages should be persisted as is
 * Given a registry, the client records its own metrics there
 * (kafka_produced_messages, ...). Without one, none.
 */
export type DlqProducer = Producer<string, Buffer, string, string>;

export async function createKafkaDlqProducer(
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
		producerOptions.metrics = kafkaMetrics(registry);
	}

	const kafkaDlqProducer = new Producer(producerOptions);

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

		const records: ReturnType<typeof toDlqRecord>[] = [];
		for (const failure of failures) {
			records.push(toDlqRecord(dlqTopic, failure));
		}

		// One span per send: it is one produce request, however many records
		await withSpan(
			"dlq.publish",
			{
				kind: SpanKind.PRODUCER,
				attributes: {
					"messaging.system": "kafka",
					"messaging.operation.type": "send",
					"messaging.destination.name": dlqTopic,
					"messaging.batch.message_count": records.length
				}
			},
			() => dlqProducer.send({ messages: records, acks: -1 })
		);

		for (const record of records) {
			dlqMessagesTotal.inc({ reason: record.headers["x-dlq-reason"] });
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
}

type FlushTrigger = "size" | "linger" | "stream_end";

/**
 * One link per message that carries a W3C traceparent header, pointing back
 * at the producer's span. Empty until the producers emit traceparent.
 */
function linksFrom(batch: KafkaMessage[]): Link[] {
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

	// Orders flushes one after another. The linger timer cannot await, so
	// without this a timer-triggered flush can run while a size-triggered one is
	// still inserting — two concurrent transactions, two commits, and
	// `messageBatch` mutated in between. Every flush chains onto the previous.
	let inFlight: Promise<void> = Promise.resolve();

	async function drainBatch(trigger: FlushTrigger) {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}

		const batch = messageBatch;
		messageBatch = [];

		if (batch.length === 0) return;

		const endFlushTimer = batchFlushDurationSeconds.startTimer();
		batchFlushTotal.inc({ trigger });
		batchSize.observe(batch.length);

		const topic = options.topics.join(",");
		await withSpan(
			`consume.batch ${topic}`,
			{
				// Each batch is its own trace. The producers' traces are links,
				// not parents: one span cannot have a parent per message.
				root: true,
				kind: SpanKind.CONSUMER,
				links: linksFrom(batch),
				attributes: {
					"messaging.system": "kafka",
					"messaging.destination.name": topic,
					"messaging.batch.message_count": batch.length,
					"batch.trigger": trigger
				}
			},
			async () => {
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
		);

		endFlushTimer();
	}

	function flushBatch(trigger: FlushTrigger): Promise<void> {
		const flushed = inFlight.then(() => drainBatch(trigger));
		// The queue swallows the rejection so one failure does not poison every
		// later flush; the returned promise still carries it to the caller.
		inFlight = flushed.catch(() => {});
		return flushed;
	}

	for await (const message of messageStream) {
		messageBatch.push(message);

		if (messageBatch.length === 1) {
			timeoutId = setTimeout(() => {
				flushBatch("linger").catch((error: unknown) => {
					messageStream.destroy(
						error instanceof Error ? error : new Error(String(error))
					);
				});
			}, options.lingerMs);
		}

		if (messageBatch.length >= options.batchSize) {
			await flushBatch("size");
		}
	}

	// The stream ended with a partial batch still buffered — flush it, and let
	// a failure propagate rather than dropping the messages silently.
	await flushBatch("stream_end");
}
