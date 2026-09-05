import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { notFound, validationError } from "#src/errors/problems.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";

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
		transactionRepository: UserTransactionRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:transactionId",
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

			const originalTransaction =
				await opts.transactionRepository.getTransactionDetail({
					userId,
					transactionId
				});
			if (!originalTransaction) throw notFound();

			const overrideTransaction =
				await opts.transactionRepository.setTransactionCategory({
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
				isOverridden: originalTransaction.categoryId !== categoryId,
				updatedAt: new Date(overrideTransaction.updatedAt).toISOString()
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
		url: "/:transactionId",
		schema: {
			tags: ["transactions"],
			hide: false,
			params: paramsSchema,
			response: {
				204: z.undefined(),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, transactionId } = request.params;

			await opts.transactionRepository.archiveTransactionCategory(
				userId,
				transactionId
			);

			return reply.code(204).send(undefined);
		}
	});
};
