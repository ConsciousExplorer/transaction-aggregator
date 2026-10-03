import {
	Counter,
	collectDefaultMetrics,
	Histogram,
	Registry
} from "@prometheus-io/client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const messagesConsumedTotal = new Counter({
	name: "messages_consumed_total",
	help: "Every message pulled into a batch",
	labelNames: ["topic"],
	registers: [registry]
});

export const batchSize = new Histogram({
	name: "batch_size",
	help: "Messages per flush",
	buckets: [1, 10, 50, 100, 250, 500],
	registers: [registry]
});

export const ingestLagSeconds = new Histogram({
	name: "ingest_lag_seconds",
	help: "Insert time minus producedAt; skipped when producedAt unknown (0)",
	buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
	registers: [registry]
});
