// RFC 9457 (titled Problem Details for HTTP APIs)

export class HttpProblem extends Error {
	payload: {
		type: string;
		title: string;
		status: number;
		detail?: string;
		errors?: unknown[];
		trace_id?: string;
	};
	constructor(payload: HttpProblem["payload"]) {
		super(payload.title);
		this.payload = payload;
	}
}

export function validationError(issues: unknown[]) {
	return new HttpProblem({
		type: "validation-error",
		title: "Request validation failed",
		status: 400,
		errors: issues
	});
}

export function invalidCursorError() {
	return new HttpProblem({
		type: "invalid-cursor",
		title: "Malformed pagination cursor",
		status: 400
	});
}

export function windowTooLargeError(maxDays: number) {
	return new HttpProblem({
		type: "window-too-large",
		title: "Time window too large",
		status: 400,
		detail: `fromDateTime to toDateTime may span at most ${maxDays} days`
	});
}

export function unauthorizedError() {
	return new HttpProblem({
		type: "unauthorized",
		title: "Authentication required",
		status: 401
	});
}

// The identity provider's signing keys could not be fetched, so no token can be
// checked. A 401 would tell the caller its credentials are bad, and send it
// after new tokens from the same provider that is down.
export function authUnavailableError() {
	return new HttpProblem({
		type: "auth-unavailable",
		title: "Authentication unavailable",
		status: 503
	});
}

export function forbiddenError() {
	return new HttpProblem({
		type: "forbidden",
		title: "Insufficient scope",
		status: 403
	});
}

export function notFoundError() {
	return new HttpProblem({
		type: "not-found",
		title: "Resource not found",
		status: 404
	});
}

export function internalError(traceId: string) {
	return new HttpProblem({
		type: "internal",
		title: "Internal server error",
		status: 500,
		trace_id: traceId
	});
}

/** Generic 4xx fallback for errors that carry a Fastify statusCode but aren't
 *  one of the named HttpProblem factories above (e.g. a framework-thrown 413). */
export function clientError(status: number, detail?: string) {
	return new HttpProblem({
		type: "client-error",
		title: "Request could not be processed",
		status,
		...(detail !== undefined && { detail })
	});
}
