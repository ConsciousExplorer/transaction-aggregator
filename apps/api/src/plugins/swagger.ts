import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";
import { fastifyPlugin } from "fastify-plugin";
import type { AppInfoConfig } from "#src/config.ts";

export default fastifyPlugin<{
	appInfo: AppInfoConfig;
	enableSwagger?: boolean;
}>(async (server, opts) => {
	console.log("Swagger plugin loaded with options:", opts);
	if (!opts.enableSwagger) return;
	await server.register(swagger, {
		transform: jsonSchemaTransform,
		openapi: {
			info: {
				title: opts.appInfo.name,
				version: opts.appInfo.version
			}
		}
	});

	await server.register(swaggerUi, {
		routePrefix: "/docs"
	});
});
