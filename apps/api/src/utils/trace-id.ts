import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { isSpanContextValid, trace } from "@opentelemetry/api";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_PARENT_ID = "0".repeat(16);

/**
 * The request's W3C trace id: the active span's when tracing is on, else the
 * one in the caller's traceparent, else a new one.
 */
export function requestTraceId(request: {
	headers: IncomingHttpHeaders;
}): string {
	const spanContext = trace.getActiveSpan()?.spanContext();
	if (spanContext && isSpanContextValid(spanContext)) {
		return spanContext.traceId;
	}

	const callerTraceId = traceIdFromTraceparent(request.headers.traceparent);
	if (callerTraceId) {
		return callerTraceId;
	}

	return randomBytes(16).toString("hex");
}

function traceIdFromTraceparent(
	header: string | string[] | undefined
): string | undefined {
	if (typeof header !== "string") return undefined;

	const match = TRACEPARENT.exec(header);
	if (!match) return undefined;

	const traceId = match[1];
	const parentId = match[2];
	if (traceId === ZERO_TRACE_ID || parentId === ZERO_PARENT_ID) {
		return undefined;
	}

	return traceId;
}
