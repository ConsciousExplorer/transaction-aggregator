import { randomBytes } from "node:crypto";

// W3C trace context: version 00, a 16-byte trace id, an 8-byte parent id, flags 01 (sampled).
// The API logs the trace id on its audit line, so a portal request can be found in the API's logs.
export function buildTraceparent() {
	const traceId = randomBytes(16).toString("hex");
	const parentId = randomBytes(8).toString("hex");
	return { traceparent: `00-${traceId}-${parentId}-01`, traceId };
}
