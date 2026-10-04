import {
	Counter,
	collectDefaultMetrics,
	Histogram,
	Registry
} from "@prometheus-io/client";

/**
 * One registry for the whole process. The Kafka factories hand it to
 * @platformatic/kafka, which registers its own client metrics here too
 * (kafka_consumed_messages, kafka_consumers_lags, ...). The metrics below
 * measure the consumer's own work, which the client cannot see.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const batchSize = new Histogram({
	name: "batch_size",
	help: "Messages per flush",
	buckets: [1, 10, 50, 100, 250, 500],
	registers: [registry]
});

export const batchFlushTotal = new Counter({
	name: "batch_flush_total",
	help: "Flushes by what triggered them: size, linger or stream_end",
	labelNames: ["trigger"] as const,
	registers: [registry]
});

export const batchFlushDurationSeconds = new Histogram({
	name: "batch_flush_duration_seconds",
	help: "Whole flush: handling the batch, then committing its offsets",
	registers: [registry]
});

export const insertDurationSeconds = new Histogram({
	name: "insert_duration_seconds",
	help: "The batch insert's database transaction only",
	registers: [registry]
});

export const rowsInsertedTotal = new Counter({
	name: "rows_inserted_total",
	help: "Rows the insert's RETURNING clause reported",
	registers: [registry]
});

export const duplicatesSkippedTotal = new Counter({
	name: "duplicates_skipped_total",
	help: "Rows attempted but skipped by ON CONFLICT DO NOTHING",
	registers: [registry]
});

export const dlqMessagesTotal = new Counter({
	name: "dlq_messages_total",
	help: "Messages published to the dead-letter topic, by deserialisation or processing failure",
	labelNames: ["reason"] as const,
	registers: [registry]
});

export const tombstonesSkippedTotal = new Counter({
	name: "tombstones_skipped_total",
	help: "Tombstones skipped by design",
	registers: [registry]
});

export const categorisationVerdictsTotal = new Counter({
	name: "categorization_verdicts_total",
	help: "Which matcher tier decided each committed verdict",
	labelNames: ["matcher_type"] as const,
	registers: [registry]
});

export const ingestLagSeconds = new Histogram({
	name: "ingest_lag_seconds",
	help: "Insert time minus the Kafka record timestamp (CreateTime, set by the producer client at send)",
	buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
	registers: [registry]
});
