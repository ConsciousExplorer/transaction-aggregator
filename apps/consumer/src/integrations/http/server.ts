import http, { type Server } from "node:http";
import os from "node:os";
import { registry } from "#src/telemetry/metrics.ts";

export async function createServer(options?: {
	appName?: string;
	description?: string;
}): Promise<Server> {
	return http.createServer(async (req, res) => {
		if (req.method === "GET" && ["/alive", "/alivez"].includes(req.url ?? "")) {
			return res.end("ok");
		}

		/**
		 * Health endpoint for application liveness and readiness.
		 * It is useful for monitoring and debugging purposes.
		 */
		if (
			req.method === "GET" &&
			["/health", "/healthz"].includes(req.url ?? "")
		) {
			res.setHeader("Content-Type", "application/json");
			return res.end(JSON.stringify({ status: "ok" }));
		}

		/**
		 * Info endpoint for application metadata.
		 * It is useful for monitoring and debugging purposes.
		 */
		if (req.method === "GET" && req.url === "/info") {
			res.setHeader("Content-Type", "application/json");
			return res.end(
				JSON.stringify({
					application: options?.appName || "Kafka Consumer",
					description:
						options?.description || "Kafka Consumer App for transactions",
					node: process.version,
					platform: process.platform,
					arch: process.arch,

					hostname: os.hostname(),
					pid: process.pid,

					uptime: Math.floor(process.uptime()),
					startedAt: new Date(
						Date.now() - process.uptime() * 1000
					).toISOString()
				})
			);
		}

		/**
		 * Metrics endpoint for Prometheus.
		 * This is a standard endpoint that Prometheus scrapes to collect metrics from the application.
		 * The metrics are collected from the `registry` which is defined in the `metrics.ts` file.
		 */
		if (req.method === "GET" && req.url === "/metrics") {
			res.setHeader("Content-Type", registry.contentType);
			return res.end(await registry.metrics());
		}

		res.statusCode = 404;
		res.end();
	});
}
