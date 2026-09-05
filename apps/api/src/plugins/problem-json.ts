import { hasZodFastifySchemaValidationErrors } from "@fastify/type-provider-zod";
import type { FastifyReply } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import {
	internal,
	notFound,
	Problem,
	validationError
} from "#src/errors/problems.ts";

export default fastifyPlugin(async (server) => {
	server.setErrorHandler((err, req, reply) => {
		if (err instanceof Problem) return send(reply, err);
		if (hasZodFastifySchemaValidationErrors(err))
			return send(reply, validationError(err.validation));
		req.log.error({ err }, "unhandled"); // stack stays in logs,
		return send(reply, internal(req.id)); // ZERO internals leak to the wire
	});
	server.setNotFoundHandler((_req, reply) => send(reply, notFound()));
});
const send = (reply: FastifyReply, p: Problem) =>
	reply.code(p.payload.status).type("application/problem+json").send(p.payload);
