// RFC 9457 (titled Problem Details for HTTP APIs)

export class Problem extends Error {
	payload: {
		type: string;
		title: string;
		status: number;
		detail?: string;
		errors?: unknown[];
		traceId?: string;
		retryAfter?: number;
	};
	constructor(payload: Problem["payload"]) {
		super(payload.title);
		this.payload = payload;
	}
}

export function validationError(issues: unknown[]) {
	return new Problem({
		type: "validation-error",
		title: "Request validation failed",
		status: 400,
		errors: issues
	});
}

export function invalidCursor() {
	return new Problem({
		type: "invalid-cursor",
		title: "Malformed pagination cursor",
		status: 400
	});
}

export function windowTooLarge() {
	return new Problem({
		type: "window-too-large",
		title: "Time window exceeds 18 months",
		status: 400
	});
}

export function unauthorized() {
	return new Problem({
		type: "unauthorized",
		title: "Authentication required",
		status: 401
	});
}

export function forbidden() {
	return new Problem({
		type: "forbidden",
		title: "Insufficient scope",
		status: 403
	});
}

export function notFound() {
	return new Problem({
		type: "not-found",
		title: "Resource not found",
		status: 404
	});
}

export function rateLimited(retryAfter: number) {
	return new Problem({
		type: "rate-limited",
		title: "Rate limit exceeded",
		status: 429,
		retryAfter: retryAfter
	});
}

export function internal(traceId: string) {
	return new Problem({
		type: "internal",
		title: "Internal server error",
		status: 500,
		traceId: traceId
	});
}

/** Generic 4xx fallback for errors that carry a Fastify statusCode but aren't
 *  one of the named Problem factories above (e.g. a framework-thrown 413). */
export function fromStatus(status: number, detail?: string) {
	return new Problem({
		type: "client-error",
		title: "Request could not be processed",
		status,
		...(detail !== undefined && { detail })
	});
}
