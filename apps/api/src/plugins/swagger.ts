import swagger, { type SwaggerTransform } from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";
import { fastifyPlugin } from "fastify-plugin";
import type { AppInfoConfig } from "#src/config.ts";

export default fastifyPlugin<{
	appInfo: AppInfoConfig;
	enableSwagger?: boolean;
}>(async (fastify, opts) => {
	if (!opts.enableSwagger) return;
	await fastify.register(swagger, {
		// Every route requires a bearer token unless its own schema says
		// otherwise (e.g. security: [] on /ready, /health).
		transform: ((...args: Parameters<SwaggerTransform>) => {
			const { schema, url } = jsonSchemaTransform(...args);
			return {
				url,
				schema: { security: [{ bearerAuth: [] }], ...schema }
			};
		}) satisfies SwaggerTransform,
		openapi: {
			info: {
				title: opts.appInfo.name,
				description: opts.appInfo.description,
				version: opts.appInfo.version
			},
			components: {
				securitySchemes: {
					bearerAuth: {
						type: "http",
						scheme: "bearer",
						bearerFormat: "JWT"
					}
				}
			},
			security: [{ bearerAuth: [] }]
		}
	});

	await fastify.register(swaggerUi, {
		routePrefix: "/docs"
	});
});
