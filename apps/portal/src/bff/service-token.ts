export type ServiceToken = { accessToken: string; expiresInSeconds: number };

// Thirty seconds of slack, so a token never expires between the check and the API call
const EXPIRY_MARGIN_SECONDS = 30;

// Caches the BFF's own client-credentials token until shortly before it expires, so an API call
// doesn't cost a Keycloak round trip. It's a cache, not state: a restart fetches a new token.
export function createServiceTokenProvider<Config>(
	fetchToken: (config: Config) => Promise<ServiceToken>,
	now: () => number
) {
	const cached = { accessToken: "", expiresAt: 0 };
	return async function getServiceToken(config: Config) {
		if (cached.accessToken !== "" && now() < cached.expiresAt)
			return cached.accessToken;
		const token = await fetchToken(config);
		cached.accessToken = token.accessToken;
		cached.expiresAt =
			now() + (token.expiresInSeconds - EXPIRY_MARGIN_SECONDS) * 1000;
		return token.accessToken;
	};
}
