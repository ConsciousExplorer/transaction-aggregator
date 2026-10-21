import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, type Mock, mock, suite, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { buildServer } from "#src/server.ts";
import { httpRequestDurationSeconds, httpRequestsInFlight } from "./metrics.ts";

// The metrics are process-wide singletons, so tests compare before and after.

async function readRequestsInFlight() {
	const metric = await httpRequestsInFlight.get();
	return metric.values[0]?.value ?? 0;
}

/** How many requests to the route the histogram has timed with this status */
async function countTimedRequests(route: string, status: number) {
	const metric = await httpRequestDurationSeconds.get();
	for (const value of metric.values) {
		// Each value carries all three labels; the client types them one by one
		const labels = value.labels as Record<string, string | number | undefined>;
		if (
			value.metricName === "http_request_duration_seconds_count" &&
			labels.route === route &&
			String(labels.status_code) === String(status)
		) {
			return value.value;
		}
	}
	return 0;
}

// The client is the one hanging up, so its socket error is expected
function ignoreClientError() {}

/** A GET whose connection the test closes before the response arrives */
function startAbandonedRequest(port: number, path: string) {
	const outgoing = request({ host: "127.0.0.1", port, path });
	outgoing.on("error", ignoreClientError);
	outgoing.end();
	return outgoing;
}

async function waitForCalls(handler: Mock<() => Promise<unknown>>) {
	while (handler.mock.callCount() === 0) {
		await wait(1);
	}
}

suite("HTTP metrics", () => {
	let app: FastifyInstance;
	let port: number;
	// Slow enough that the client hangs up while the handler is still running
	const answerSlowly = mock.fn(async () => {
		await wait(100);
		return { ok: true };
	});

	before(async () => {
		app = buildServer();
		app.get("/slow", answerSlowly);
		app.get("/fast", async () => ({ ok: true }));
		await app.listen({ host: "127.0.0.1", port: 0 });
		port = (app.server.address() as AddressInfo).port;
	});
	after(async () => {
		await app.close();
	});

	test("a request whose client hangs up leaves the in-flight gauge and is timed as 499", async () => {
		const inFlightBefore = await readRequestsInFlight();
		const abandonedBefore = await countTimedRequests("/slow", 499);

		const outgoing = startAbandonedRequest(port, "/slow");
		await waitForCalls(answerSlowly);
		outgoing.destroy();
		// Past the end of the handler, which still runs to completion
		await wait(150);

		assert.strictEqual(await readRequestsInFlight(), inFlightBefore);
		assert.strictEqual(
			await countTimedRequests("/slow", 499),
			abandonedBefore + 1
		);
	});

	test("an answered request is timed with the status it was sent", async () => {
		const answeredBefore = await countTimedRequests("/fast", 200);

		const response = await app.inject({ method: "GET", url: "/fast" });

		assert.strictEqual(response.statusCode, 200);
		assert.strictEqual(
			await countTimedRequests("/fast", 200),
			answeredBefore + 1
		);
	});
});
