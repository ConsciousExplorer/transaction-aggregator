import http from "node:http";
import { registry } from "#src/telemetry/metrics.ts";

export function createServer() {
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
