import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { notFoundError } from "#src/errors/http-problem.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";
import { buildTransactionDetail } from "./transactions.mappers.ts";
import { transactionDetailSchema } from "./transactions.schemas.ts";

export default async function registerGetTransactionRoute(
	fastify: FastifyInstance,
	options: {
		transactionRepository: Pick<
			UserTransactionRepository,
			"getTransactionDetail"
		>;
	}
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/:transactionId",
		config: {
			authConfig: {
				requiredScope: ["tx:read"]
			}
		},
		schema: {
			tags: ["transactions"],
			hide: false,
			params: z.object({
				userId: z.uuid(),
				transactionId: z.uuid()
			}),
			response: {
				200: transactionDetailSchema,
				400: problemSchema,
				404: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const row = await options.transactionRepository.getTransactionDetail({
				userId: request.params.userId,
				transactionId: request.params.transactionId
			});

			if (!row) throw notFoundError();

			return reply.send(buildTransactionDetail(row));
		}
	});
}
