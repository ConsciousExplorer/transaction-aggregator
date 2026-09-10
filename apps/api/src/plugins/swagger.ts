import swagger from "@fastify/swagger";
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
		transform: jsonSchemaTransform,
		openapi: {
			info: {
				title: opts.appInfo.name,
				version: opts.appInfo.version
			}
		}
	});

	await fastify.register(swaggerUi, {
		routePrefix: "/docs"
	});
});
