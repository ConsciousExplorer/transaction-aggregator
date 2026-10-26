import { z } from "zod";

// RFC 9457 problem details, the shape the API answers with, so the browser handles one error format
type ProblemPayload = {
	type: string;
	title: string;
	status: number;
	detail?: string | undefined;
	trace_id?: string | undefined;
};

class BffProblem extends Error {
	payload: ProblemPayload;
	constructor(payload: ProblemPayload) {
		super(payload.title);
		this.payload = payload;
	}
}

export function notSignedInError() {
	return new BffProblem({
		type: "not-signed-in",
		title: "Sign in to continue",
		status: 401
	});
}

export function foreignOriginError() {
	return new BffProblem({
		type: "foreign-origin",
		title: "Request from another site refused",
		status: 403
	});
}

export function invalidRequestError(detail: string) {
	return new BffProblem({
		type: "invalid-request",
		title: "The request is not valid",
		status: 400,
		detail
	});
}

export function apiUnavailableError(traceId: string) {
	return new BffProblem({
		type: "api-unavailable",
		title: "The transaction API could not be reached",
		status: 502,
		trace_id: traceId
	});
}

const apiProblemSchema = z.object({
	type: z.string(),
	title: z.string(),
	detail: z.string().optional(),
	trace_id: z.string().optional()
});

// The API's 401 and 403 are about the portal's service token, not the customer's session. The
// browser reads 401 as "sign in again", so they become a 502: the portal itself is misconfigured.
export function upstreamError(status: number, body: unknown, traceId: string) {
	if (status === 401 || status === 403) {
		return new BffProblem({
			type: "api-refused-portal",
			title: "The API refused the portal's credentials",
			status: 502,
			trace_id: traceId
		});
	}
	const problem = apiProblemSchema.safeParse(body);
	if (!problem.success) {
		return new BffProblem({
			type: "api-error",
			title: "The API request failed",
			status,
			trace_id: traceId
		});
	}
	return new BffProblem({
		type: problem.data.type,
		title: problem.data.title,
		status,
		detail: problem.data.detail,
		trace_id: problem.data.trace_id ?? traceId
	});
}

function buildProblemResponse(payload: ProblemPayload) {
	return new Response(JSON.stringify(payload), {
		status: payload.status,
		headers: { "content-type": "application/problem+json" }
	});
}

export function respondWithProblem(error: unknown) {
	if (error instanceof BffProblem) return buildProblemResponse(error.payload);
	console.error(
		JSON.stringify({
			event: "bff-error",
			error: String(error),
			stack: (error as Error)?.stack
		})
	);
	return buildProblemResponse({
		type: "internal-error",
		title: "Something went wrong in the portal",
		status: 500
	});
}
