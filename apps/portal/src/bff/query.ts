// Copies only the named parameters from the browser's query string, so the browser can't add
// one the BFF doesn't expect. The user id is never one of them: it comes from the session.
export function buildApiQuery(source: URLSearchParams, allowedNames: readonly string[]) {
	const query = new URLSearchParams();
	for (const name of allowedNames) {
		for (const value of source.getAll(name)) {
			if (value !== "") query.append(name, value);
		}
	}
	return query;
}
