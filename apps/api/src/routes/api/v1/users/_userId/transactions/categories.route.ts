import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import type { TransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { notFound, validationError } from "#src/problems.ts";

const paramsSchema = z.object({ userId: z.uuid(), transactionId: z.uuid() });
const bodySchema = z.object({ category: z.string() });
const responseSchema = z.object({
	transactionId: z.uuid(),
	category: z.string(),
	isOverridden: z.boolean(),
	updatedAt: z.iso.datetime()
});

/**
 * PUT /:transactionId/category — set a per-user category override.
 */
export default async (
	fastify: FastifyInstance,
	opts: {
		categoryRepository: CategoryRepository;
		transactionRepository: TransactionRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:transactionId/category",
		schema: {
			hide: false,
			params: paramsSchema,
			body: bodySchema,
			response: {
				200: responseSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, transactionId } = request.params;
			const { category } = request.body;

			// No DB transaction: the upsert is a single atomic statement, and the
			// reads before it are precondition checks against immutable data
			// (ownership and occurredAt never change). Concurrent PUTs are
			// last-writer-wins with or without BEGIN/COMMIT.

			// D32: slug on the wire → smallint internal, resolved at the edge.
			const resolvedCategory =
				await opts.categoryRepository.resolveCategory(category);
			if (!resolvedCategory)
				throw validationError([
					{ path: ["category"], message: `unknown category "${category}"` }
				]);

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
					categoryId: resolvedCategory.categoryId
				});
			if (!overrideTransaction) throw notFound();

			return reply.send({
				transactionId: overrideTransaction.transactionId,
				category: category,
				isOverridden: originalTransaction.category !== category,
				updatedAt: new Date(overrideTransaction.updatedAt).toISOString()
			});
		}
	});
};
