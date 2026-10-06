import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { resolveTraceId } from "./trace-id.ts";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const HEX_TRACE_ID = /^[0-9a-f]{32}$/;

suite("resolveTraceId", () => {
	test("a valid traceparent gives its trace id", () => {
		const headers = {
			traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01`
		};
		assert.strictEqual(resolveTraceId({ headers }), TRACE_ID);
	});

	test("a malformed traceparent is ignored and a new id minted", () => {
		const malformed = [
			"garbage",
			`01-${TRACE_ID}-00f067aa0ba902b7-01`,
			`00-${TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01`,
			`00-${TRACE_ID.slice(1)}-00f067aa0ba902b7-01`,
			`00-${TRACE_ID}-00f067aa0ba902b7`,
			`00-${TRACE_ID}-00f067aa0ba902b7-01-extra`
		];
		for (const traceparent of malformed) {
			const traceId = resolveTraceId({ headers: { traceparent } });
			assert.match(traceId, HEX_TRACE_ID, traceparent);
			assert.notStrictEqual(traceId, TRACE_ID, traceparent);
		}
	});

	test("an all-zero trace id or parent id is ignored", () => {
		const allZero = [
			`00-${"0".repeat(32)}-00f067aa0ba902b7-01`,
			`00-${TRACE_ID}-${"0".repeat(16)}-01`
		];
		for (const traceparent of allZero) {
			const traceId = resolveTraceId({ headers: { traceparent } });
			assert.match(traceId, HEX_TRACE_ID, traceparent);
			assert.notStrictEqual(traceId, "0".repeat(32), traceparent);
			assert.notStrictEqual(traceId, TRACE_ID, traceparent);
		}
	});

	test("no traceparent mints a fresh id per request", () => {
		const first = resolveTraceId({ headers: {} });
		const second = resolveTraceId({ headers: {} });
		assert.match(first, HEX_TRACE_ID);
		assert.match(second, HEX_TRACE_ID);
		assert.notStrictEqual(first, second);
	});
});
