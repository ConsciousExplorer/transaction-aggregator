import http from "node:http";
import os from "node:os";
import { registry } from "#src/telemetry/metrics.ts";

export function createServer(options?: {
	appName?: string;
	description?: string;
}) {
	return http.createServer(async (request, response) => {
		/**
		 * Health endpoints to see if the service is up and running.
		 */
		if (
			request.method === "GET" &&
			["/health", "/healthz"].includes(request.url ?? "")
		) {
			response.setHeader("Content-Type", "application/json");
			return response.end(JSON.stringify({ status: "ok" }));
		}

		/**
		 * Info endpoint for application metadata.
		 * It is useful for monitoring and debugging purposes.
		 */
		if (request.method === "GET" && request.url === "/info") {
			response.setHeader("Content-Type", "application/json");
			return response.end(
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
		if (request.method === "GET" && request.url === "/metrics") {
			response.setHeader("Content-Type", registry.contentType);
			return response.end(await registry.metrics());
		}

		response.statusCode = 404;
		response.end();
	});
}
