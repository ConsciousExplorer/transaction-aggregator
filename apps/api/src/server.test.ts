import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { problemSchema } from "./schemas/common.ts";
import { buildServer } from "./server.ts";

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

suite("an unhandled error", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer();
		app.route({
			method: "GET",
			url: "/failing",
			schema: { response: { 500: problemSchema } },
			handler: async () => {
				throw new Error("pg password=hunter2");
			}
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	test("answers a documented 500 with the request's trace_id", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/failing",
			headers: { traceparent: TRACEPARENT }
		});
		assert.strictEqual(response.statusCode, 500);
		assert.deepStrictEqual(response.json(), {
			type: "internal",
			title: "Internal server error",
			status: 500,
			trace_id: TRACE_ID
		});
	});
});

suite("request id", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer();
		app.get("/request-id", async (request) => ({ id: request.id }));
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	test("is the trace id of the caller's traceparent", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/request-id",
			headers: {
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
			}
		});
		assert.deepStrictEqual(res.json(), {
			id: "4bf92f3577b34da6a3ce929d0e0e4736"
		});
	});

	test("is a fresh trace id when the caller sends none", async () => {
		const res = await app.inject({ method: "GET", url: "/request-id" });
		assert.match(res.json().id, /^[0-9a-f]{32}$/);
	});
});
