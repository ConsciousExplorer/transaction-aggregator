import type { BffConfig } from "./config.ts";
import { foreignOriginError } from "./problems.ts";

// SameSite=Lax already keeps the session cookie off other sites' POSTs; checking Origin on every
// write as well means a write only ever comes from the portal's own pages
export function rejectForeignOrigin(request: Request, config: BffConfig) {
	const origin = request.headers.get("origin");
	if (origin !== new URL(config.publicBaseUrl).origin) throw foreignOriginError();
}
