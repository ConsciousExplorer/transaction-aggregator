import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";
import type { FastifyPluginAsync } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import { config } from "#src/runtime.ts";

export const swaggerPlugin: FastifyPluginAsync = fastifyPlugin(
	async (server) => {
		await server.register(swagger, {
			transform: jsonSchemaTransform,
			openapi: {
				info: {
					title: config.info.title,
					version: config.info.version
				}
			}
		});

		await server.register(swaggerUi, {
			routePrefix: "/docs"
		});
	}
);
