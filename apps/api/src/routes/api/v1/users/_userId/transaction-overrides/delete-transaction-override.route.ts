import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";

export default async function registerDeleteTransactionOverrideRoute(
	fastify: FastifyInstance,
	options: {
		transactionRepository: Pick<
			UserTransactionRepository,
			"archiveTransactionCategory"
		>;
	}
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
		url: "/:transactionId",
		config: {
			authConfig: {
				requiredScope: ["tx:write"]
			}
		},
		schema: {
			tags: ["transactions"],
			params: z.object({ userId: z.uuid(), transactionId: z.uuid() }),
			response: {
				204: z.undefined(),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, transactionId } = request.params;

			await options.transactionRepository.archiveTransactionCategory(
				userId,
				transactionId
			);

			return reply.code(204).send(undefined);
		}
	});
}
