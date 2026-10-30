import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildServer } from "#src/server.ts";

// The contract as the generate-contract script builds it: the real plugins and
// the real route table.

interface DocumentedResponse {
	content?: Record<string, unknown>;
}

interface DocumentedOperation {
	responses: Record<string, DocumentedResponse>;
}

suite("OpenAPI contract", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({
			queryWindow: { maxDays: 366 },
			autoload: true,
			enableSwagger: true
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	// Every documented operation is guarded and needs a scope, so the auth
	// hook can answer each of these before the route runs
	test("every operation documents the auth hook's 401, 403 and 503", () => {
		const paths = app.swagger().paths as Record<
			string,
			Record<string, DocumentedOperation>
		>;
		const operations = Object.entries(paths);
		assert.ok(operations.length > 0, "the route table loaded");

		for (const [path, methods] of operations) {
			for (const [method, operation] of Object.entries(methods)) {
				for (const status of ["401", "403", "503"]) {
					assert.ok(
						operation.responses[status],
						`${method.toUpperCase()} ${path} documents ${status}`
					);
				}
			}
		}
	});

	// The server answers every error as RFC 9457 problem+json, so the contract
	// must say so: a generated client dispatches on Content-Type, and finds no
	// schema for the body it got otherwise
	test("every error response is documented as application/problem+json, not application/json", () => {
		const paths = app.swagger().paths as Record<
			string,
			Record<string, DocumentedOperation>
		>;

		for (const [path, methods] of Object.entries(paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				for (const [status, response] of Object.entries(operation.responses)) {
					if (Number(status) < 400) continue;
					const content = response.content ?? {};
					assert.ok(
						content["application/problem+json"],
						`${method.toUpperCase()} ${path} ${status} is problem+json`
					);
					assert.equal(
						content["application/json"],
						undefined,
						`${method.toUpperCase()} ${path} ${status} is not also application/json`
					);
				}
			}
		}
	});
});
