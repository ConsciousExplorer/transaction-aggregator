import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";
import { fastifyPlugin } from "fastify-plugin";

export const swaggerPlugin: FastifyPluginAsync = fastifyPlugin(
	async (server) => {
		await server.register(swagger, {
			openapi: {
				info: {
					title: "Transaction Aggregator API",
					version: "1.0.0"
				}
			}
		});

		await server.register(swaggerUi, {
			routePrefix: "/docs"
		});
	}
);
