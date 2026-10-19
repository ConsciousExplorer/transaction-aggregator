// The browser's side of the BFF: same-origin fetches, so the session cookie rides along and the
// browser never holds a token the API accepts. Problems come back as one error type a page can show.

export class PortalRequestError extends Error {
	status: number;
	detail: string | undefined;
	traceId: string | undefined;
	constructor(
		title: string,
		status: number,
		detail?: string,
		traceId?: string
	) {
		super(title);
		this.status = status;
		this.detail = detail;
		this.traceId = traceId;
	}
}

type ProblemBody = { title?: string; detail?: string; trace_id?: string };

// 401 means the session is gone (expired, or signed out in another tab): back to sign-in
async function readResponse(response: Response) {
	if (response.status === 401) {
		window.location.assign("/?error=session-expired");
		throw new PortalRequestError("Your session expired", 401);
	}
	if (response.status === 204) return undefined;
	const body: unknown = await response.json();
	if (!response.ok) {
		const problem = body as ProblemBody;
		throw new PortalRequestError(
			problem.title ?? "The request failed",
			response.status,
			problem.detail,
			problem.trace_id
		);
	}
	return body;
}

export async function readJson(path: string, signal?: AbortSignal) {
	const response = await fetch(path, {
		headers: { accept: "application/json" },
		cache: "no-store",
		signal
	});
	return readResponse(response);
}

export async function sendJson(
	method: "PUT" | "DELETE",
	path: string,
	body?: unknown
) {
	const response = await fetch(path, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return readResponse(response);
}

// Anything a load can throw, as the one error type pages show
export function describeError(error: unknown) {
	if (error instanceof PortalRequestError) return error;
	return new PortalRequestError("The portal couldn't reach its server", 0);
}
