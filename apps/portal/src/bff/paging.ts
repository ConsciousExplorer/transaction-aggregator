// links.next and links.prev are API URLs carrying an opaque cursor. The browser only ever sees
// the cursor value, which the BFF sends back unchanged, so API URLs never leave the server.
export function readCursor(link: string | undefined) {
	if (link === undefined) return undefined;
	const url = new URL(link, "http://api.invalid");
	return url.searchParams.get("cursor") ?? undefined;
}
