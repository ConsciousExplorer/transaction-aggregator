import assert from "node:assert/strict";
import { test } from "node:test";
import { createServiceTokenProvider } from "./service-token.ts";

function createFakeTokenFetcher(calls: { count: number }) {
	return async function fetchToken(config: { clientId: string }) {
		calls.count += 1;
		return { accessToken: `${config.clientId}-token-${calls.count}`, expiresInSeconds: 900 };
	};
}

test("reuses the token until thirty seconds before it expires", async () => {
	const calls = { count: 0 };
	const clock = { now: 0 };
	const getServiceToken = createServiceTokenProvider(createFakeTokenFetcher(calls), () => clock.now);
	const config = { clientId: "banking-portal" };

	assert.equal(await getServiceToken(config), "banking-portal-token-1");
	clock.now = 869_999;
	assert.equal(await getServiceToken(config), "banking-portal-token-1");
	clock.now = 870_000;
	assert.equal(await getServiceToken(config), "banking-portal-token-2");
	assert.equal(calls.count, 2);
});
