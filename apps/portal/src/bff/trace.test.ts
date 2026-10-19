import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTraceparent } from "./trace.ts";

test("builds a sampled W3C traceparent whose trace id it also returns", () => {
	const { traceparent, traceId } = buildTraceparent();
	assert.match(traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
	assert.equal(traceparent.split("-")[1], traceId);
});

test("builds a new trace id each call", () => {
	assert.notEqual(buildTraceparent().traceId, buildTraceparent().traceId);
});
