import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { TransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { notFound, validationError } from "#src/problems.ts";
import { problemSchema } from "#src/schemas/common.ts";

// D34: categoryId is the wire identifier; no slug resolution here.
const paramsSchema = z.object({ userId: z.uuid(), transactionId: z.uuid() });
const bodySchema = z.object({ categoryId: z.number().int().positive() });
const responseSchema = z.object({
	transactionId: z.uuid(),
	categoryId: z.number().int(),
	isOverridden: z.boolean(),
	updatedAt: z.iso.datetime()
});


export default async (
	fastify: FastifyInstance,
	opts: {
		transactionRepository: TransactionRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:transactionId/category",
		schema: {
			tags: ["transactions"],
			hide: false,
			params: paramsSchema,
			body: bodySchema,
			response: {
				200: responseSchema,
				400: problemSchema,
				404: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, transactionId } = request.params;
			const { categoryId } = request.body;

			// Ownership check + the immutable occurredAt the override key needs.
			const originalTransaction =
				await opts.transactionRepository.getUserTransactionDetail({
					userId,
					transactionId
				});
			if (!originalTransaction) throw notFound();

			const overrideTransaction =
				await opts.transactionRepository.upsertUserTransactionCategory({
					userId,
					transactionId,
					occurredAt: originalTransaction.occurredAt,
					categoryId
				});
			if (!overrideTransaction)
				throw validationError([
					{ path: ["categoryId"], message: `unknown categoryId ${categoryId}` }
				]);

			return reply.send({
				transactionId: overrideTransaction.transactionId,
				categoryId: overrideTransaction.categoryId,
				// Compared against the previous EFFECTIVE category id.
				isOverridden: originalTransaction.categoryId !== categoryId,
				updatedAt: new Date(overrideTransaction.updatedAt).toISOString()
			});
		}
	});
};
