import "server-only";
import { requestServiceToken } from "./keycloak.ts";
import { createServiceTokenProvider } from "./service-token.ts";

// The BFF's one piece of state: its cached service token. Next.js has no boot step to build it
// in, so it is built when this module loads. That needs no environment; each call passes the
// request's config.
export const getServiceToken = createServiceTokenProvider(
	requestServiceToken,
	Date.now
);
