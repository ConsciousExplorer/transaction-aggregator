import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance, RouteOptions } from "fastify";
import { buildServer } from "#src/server.ts";

// Loads the real route table the way the app does, then checks every route's
// auth config. A new route that forgets its scope fails here instead of
// being reachable by any valid token.

const READ_METHODS = ["GET", "HEAD"];

function methodsOf(route: RouteOptions): string[] {
	return Array.isArray(route.method) ? route.method : [route.method];
}

suite("route auth config", () => {
	let app: FastifyInstance;
	const routes: RouteOptions[] = [];

	before(async () => {
		app = buildServer({
			routeAutoLoadParameters: {
				dir: import.meta.dirname,
				dirNameRoutePrefix: true,
				routeParams: true,
				matchFilter: /route\.(ts|js)$/
			}
		});
		app.addHook("onRoute", (route) => {
			routes.push(route);
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	test("every /api/v1 read requires tx:read and every write requires tx:write", () => {
		const apiRoutes = routes.filter((route) => route.url.startsWith("/api/v1"));
		assert.ok(apiRoutes.length > 0, "the route table loaded");

		for (const route of apiRoutes) {
			const scopes = route.config?.authConfig?.requiredScope ?? [];

			for (const method of methodsOf(route)) {
				const expected = READ_METHODS.includes(method) ? "tx:read" : "tx:write";
				assert.deepStrictEqual(
					scopes,
					[expected],
					`${method} ${route.url} must require ${expected}`
				);
			}
		}
	});

	test("the health checks are public", () => {
		for (const url of ["/health", "/ready"]) {
			const route = routes.find((candidate) => candidate.url === url);
			assert.ok(route, `${url} is registered`);
			assert.strictEqual(route.config?.authConfig?.public, true, url);
		}
	});
});
