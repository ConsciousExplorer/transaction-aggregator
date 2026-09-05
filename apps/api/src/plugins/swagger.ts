import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";
import { fastifyPlugin } from "fastify-plugin";
import type { AppCradle } from "#src/container.ts";

export default fastifyPlugin<Pick<AppCradle, "appInfo">>(
	async (server, opts) => {
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
	}
);
