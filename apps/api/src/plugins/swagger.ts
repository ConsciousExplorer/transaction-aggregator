import swagger, { type SwaggerTransform } from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";
import type { FastifySchema, RouteOptions } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import type { AppInfoConfig } from "#src/config.ts";
import { problemSchema } from "#src/schemas/common.ts";

/**
 * The auth hook answers before a guarded route runs, so the route's own schema
 * never lists these: 401 without a valid token, 503 when the signing keys
 * can't be fetched, and 403 when the token lacks the route's scope.
 */
function addAuthResponses(schema: FastifySchema, route: RouteOptions) {
	const authConfig = route.config?.authConfig;
	if (authConfig?.public) return schema;

	const response: Record<string, unknown> = {
		...(schema.response as Record<string, unknown> | undefined),
		401: problemSchema,
		503: problemSchema
	};
	if (authConfig?.requiredScope) {
		response[403] = problemSchema;
	}

	return { ...schema, response };
}

// Every route requires a bearer token unless its own schema says otherwise
// (e.g. security: [] on /ready, /health).
function documentRoute(transformOptions: Parameters<SwaggerTransform>[0]) {
	const { schema, url } = jsonSchemaTransform({
		...transformOptions,
		schema: addAuthResponses(transformOptions.schema, transformOptions.route)
	});

	return {
		url,
		schema: { security: [{ bearerAuth: [] }], ...schema }
	};
}

export default fastifyPlugin<{
	appInfo: AppInfoConfig;
	enableSwagger?: boolean;
}>(async (fastify, options) => {
	if (!options.enableSwagger) return;
	await fastify.register(swagger, {
		transform: documentRoute satisfies SwaggerTransform,
		openapi: {
			info: {
				title: options.appInfo.name,
				description: options.appInfo.description,
				version: options.appInfo.version
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
