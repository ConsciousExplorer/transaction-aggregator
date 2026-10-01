// RFC 9457 (titled Problem Details for HTTP APIs)

export class HttpProblem extends Error {
	payload: {
		type: string;
		title: string;
		status: number;
		detail?: string;
		errors?: unknown[];
		traceId?: string;
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

export function invalidCursor() {
	return new HttpProblem({
		type: "invalid-cursor",
		title: "Malformed pagination cursor",
		status: 400
	});
}

export function windowTooLarge(maxDays: number) {
	return new HttpProblem({
		type: "window-too-large",
		title: "Time window too large",
		status: 400,
		detail: `fromDateTime to toDateTime may span at most ${maxDays} days`
	});
}

export function unauthorized() {
	return new HttpProblem({
		type: "unauthorized",
		title: "Authentication required",
		status: 401
	});
}

export function forbidden() {
	return new HttpProblem({
		type: "forbidden",
		title: "Insufficient scope",
		status: 403
	});
}

export function notFound() {
	return new HttpProblem({
		type: "not-found",
		title: "Resource not found",
		status: 404
	});
}

export function internal(traceId: string) {
	return new HttpProblem({
		type: "internal",
		title: "Internal server error",
		status: 500,
		traceId: traceId
	});
}

/** Generic 4xx fallback for errors that carry a Fastify statusCode but aren't
 *  one of the named HttpProblem factories above (e.g. a framework-thrown 413). */
export function fromStatus(status: number, detail?: string) {
	return new HttpProblem({
		type: "client-error",
		title: "Request could not be processed",
		status,
		...(detail !== undefined && { detail })
	});
}
