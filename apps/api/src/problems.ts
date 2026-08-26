// RFC 9457 (titled Problem Details for HTTP APIs)

// TODO: Check this again!! NB! I don't know what this is

export class Problem extends Error {
	payload: {
		type: string;
		title: string;
		status: number;
		detail?: string;
		errors?: unknown[];
		trace_id?: string;
		retry_after?: number;
	};
	constructor(payload: Problem["payload"]) {
		super(payload.title);
		this.payload = payload;
	}
}

const urn = (slug: string) => `urn:api:problem:${slug}`;

export const validationError = (issues: unknown[]) =>
	new Problem({
		type: urn("validation-error"),
		title: "Request validation failed",
		status: 400,
		errors: issues
	});

export const invalidCursor = () =>
	new Problem({
		type: urn("invalid-cursor"),
		title: "Malformed pagination cursor",
		status: 400
	});

export const windowTooLarge = () =>
	new Problem({
		type: urn("window-too-large"),
		title: "Time window exceeds 18 months",
		status: 400
	});

export const unauthorized = () =>
	new Problem({
		type: urn("unauthorized"),
		title: "Authentication required",
		status: 401
	});

export const forbidden = () =>
	new Problem({
		type: urn("forbidden"),
		title: "Insufficient scope",
		status: 403
	});

export const notFound = () =>
	new Problem({
		type: urn("not-found"),
		title: "Resource not found",
		status: 404
	});

export const rateLimited = (retryAfter: number) =>
	new Problem({
		type: urn("rate-limited"),
		title: "Rate limit exceeded",
		status: 429,
		retry_after: retryAfter
	});

export const internal = (traceId: string) =>
	new Problem({
		type: urn("internal"),
		title: "Internal server error",
		status: 500,
		trace_id: traceId
	});
