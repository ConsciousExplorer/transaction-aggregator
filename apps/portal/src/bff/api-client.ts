import type { BffConfig } from "./config.ts";
import { apiUnavailableError, upstreamError } from "./problems.ts";
import { getServiceToken } from "./runtime.ts";
import { buildTraceparent } from "./trace.ts";

type ApiRequest = {
	method: "GET" | "PUT" | "DELETE";
	path: string;
	query?: URLSearchParams;
	body?: unknown;
};

// Every API path names its user. Here it is always the signed-in customer, from the session.
export function buildCustomerPath(customerId: string, rest: string) {
	return `/users/${encodeURIComponent(customerId)}${rest}`;
}

async function sendToApi(url: URL, init: RequestInit, traceId: string) {
	try {
		return await fetch(url, init);
	} catch (error) {
		console.error(JSON.stringify({ event: "api-unreachable", url: url.toString(), traceId, error: String(error) }));
		throw apiUnavailableError(traceId);
	}
}

function logApiCall(request: ApiRequest, status: number, traceId: string, startedAt: number) {
	const durationMs = Math.round(performance.now() - startedAt);
	console.info(JSON.stringify({ event: "api-call", method: request.method, path: request.path, status, traceId, durationMs }));
}

// Every API call goes through here. It adds the three headers the API expects from a caller:
// the BFF's own bearer token (never the customer's), a fresh traceparent so the request can be
// found in the API's logs and traces, and accept.
export async function callApi(config: BffConfig, request: ApiRequest) {
	const url = new URL(`/api/v1${request.path}`, config.apiBaseUrl);
	if (request.query !== undefined) url.search = request.query.toString();
	const accessToken = await getServiceToken(config);
	const { traceparent, traceId } = buildTraceparent();
	const headers = new Headers({ authorization: `Bearer ${accessToken}`, accept: "application/json", traceparent });
	if (request.body !== undefined) headers.set("content-type", "application/json");

	const startedAt = performance.now();
	const response = await sendToApi(
		url,
		{
			method: request.method,
			headers,
			body: request.body === undefined ? undefined : JSON.stringify(request.body),
			cache: "no-store"
		},
		traceId
	);
	logApiCall(request, response.status, traceId, startedAt);

	if (response.status === 204) return undefined;
	const body: unknown = await response.json();
	if (!response.ok) throw upstreamError(response.status, body, traceId);
	return body;
}
