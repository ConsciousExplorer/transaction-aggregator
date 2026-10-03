import {
	collectDefaultMetrics,
	Gauge,
	Histogram,
	Registry
} from "@prometheus-io/client";

/**
 * One registry for the whole process. SPEC §7's RED metrics: rate and errors
 * come from the histogram's _count series, so they need no counter of their own.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDurationSeconds = new Histogram({
	name: "http_request_duration_seconds",
	help: "Request duration by method, route pattern and status",
	labelNames: ["method", "route", "status_code"] as const,
	// 0.2 is a bucket edge, so the 200 ms SLO line (S1) is exact, not interpolated
	buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5],
	registers: [registry]
});

export const httpRequestsInFlight = new Gauge({
	name: "http_requests_in_flight",
	help: "Requests received and not yet answered",
	registers: [registry]
});
