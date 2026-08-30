import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";
import { withTransaction } from "#src/integrations/database/pool.ts";
import { resolveCategoryId } from "#src/integrations/database/repositories/category-repository.ts";
import {
	getUserTransactionDetail,
	upsertUserTransactionCategory
} from "#src/integrations/database/repositories/transaction-repository.ts";
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
 * A basic info route
 */
export default async (fastify: FastifyInstance, opts: { database: Pool }) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:transactionId/category",
		schema: {
			params: paramsSchema,
			body: bodySchema,
			response: {
				200: responseSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, transactionId } = request.params;
			const { category } = request.body;

			const owned = await withTransaction(opts.database, async (client) => {
				const categoryId = await resolveCategoryId(client, category);
				if (categoryId === null)
					throw validationError([
						{ path: ["category"], message: `unknown category "${category}"` }
					]);

				const originalTransaction = await getUserTransactionDetail(client, {
					userId,
					transactionId
				});
				if (!originalTransaction) throw notFound();

				const overrideTransaction = await upsertUserTransactionCategory(
					client,
					{
						userId,
						transactionId,
						occurredAt: originalTransaction.occurredAt,
						categoryId
					}
				);
				return { originalTransaction, overrideTransaction };
			});

			if (!owned) throw notFound();

			if (!owned.overrideTransaction) throw notFound();

			return reply.send({
				transactionId: owned.overrideTransaction.transactionId,
				category: category,
				isOverridden: owned.originalTransaction.category !== category,
				updatedAt: new Date(owned.overrideTransaction.updatedAt).toISOString()
			});
		}
	});
};
