import { z } from "zod";

const configSchema = z.object({
	PUBLIC_BASE_URL: z.url(),
	API_BASE_URL: z.url(),
	KEYCLOAK_PUBLIC_URL: z.url(),
	KEYCLOAK_INTERNAL_URL: z.url(),
	KEYCLOAK_REALM: z.string().min(1),
	PORTAL_CLIENT_ID: z.string().min(1),
	PORTAL_CLIENT_SECRET: z.string().min(1),
	SERVICE_CLIENT_ID: z.string().min(1),
	SERVICE_CLIENT_SECRET: z.string().min(1),
	SESSION_SECRET: z.string().min(32)
});

export type BffConfig = ReturnType<typeof loadConfig>;

// Read per request, not when the module loads: `next build` imports every route module and has
// no runtime environment. Parsing a dozen variables costs microseconds.
export function loadConfig() {
	const environment = configSchema.parse(process.env);
	return Object.freeze({
		publicBaseUrl: environment.PUBLIC_BASE_URL,
		apiBaseUrl: environment.API_BASE_URL,
		keycloakPublicUrl: environment.KEYCLOAK_PUBLIC_URL,
		keycloakInternalUrl: environment.KEYCLOAK_INTERNAL_URL,
		realm: environment.KEYCLOAK_REALM,
		portalClient: {
			id: environment.PORTAL_CLIENT_ID,
			secret: environment.PORTAL_CLIENT_SECRET
		},
		serviceClient: {
			id: environment.SERVICE_CLIENT_ID,
			secret: environment.SERVICE_CLIENT_SECRET
		},
		sessionSecret: environment.SESSION_SECRET
	});
}
