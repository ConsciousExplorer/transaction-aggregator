import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { notFoundError, validationError } from "#src/errors/http-problem.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { categoryIdSchema, problemSchema } from "#src/schemas/common.ts";
import { buildTransactionOverride } from "./transaction-overrides.mappers.ts";
import { transactionOverrideSchema } from "./transaction-overrides.schemas.ts";

export default async function registerPutTransactionOverrideRoute(
	fastify: FastifyInstance,
	options: { transactionRepository: UserTransactionRepository }
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:transactionId",
		config: {
			authConfig: {
				requiredScope: ["tx:write"]
			}
		},
		schema: {
			tags: ["transactions"],
			hide: false,
			params: z.object({ userId: z.uuid(), transactionId: z.uuid() }),
			body: z.object({ categoryId: categoryIdSchema }),
			response: {
				200: transactionOverrideSchema,
				400: problemSchema,
				404: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, transactionId } = request.params;
			const { categoryId } = request.body;

			const transaction =
				await options.transactionRepository.getTransactionDetail({
					userId,
					transactionId
				});
			if (!transaction) throw notFoundError();

			const override =
				await options.transactionRepository.setTransactionCategory({
					userId,
					transactionId,
					occurredAt: transaction.occurredAt,
					categoryId
				});
			if (!override)
				throw validationError([
					{ path: ["categoryId"], message: `unknown categoryId ${categoryId}` }
				]);

			return reply.send(buildTransactionOverride(override));
		}
	});
}
