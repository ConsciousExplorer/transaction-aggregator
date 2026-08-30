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
	originalCategory: z.string(),
	overrideCategory: z.string(),
	isOverridden: z.boolean(),
	updatedAt: z.string()
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
				200: responseSchema,
				201: responseSchema
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

				const row = await getUserTransactionDetail(client, {
					userId,
					transactionId
				});
				if (!row) throw notFound(); // missing OR other-user → same 404

				const overrideTransaction = await upsertUserTransactionCategory(
					client,
					{
						userId,
						transactionId,
						occurredAt: row.occurredAt, // from the owned row — D28
						categoryId
					}
				);
				return overrideTransaction;
			});

			if (!owned) throw notFound();

			return reply.send({
				transactionId: owned.transactionId,
				originalCategory: category,
				overrideCategory: String(owned.categoryId),
				isOverridden: category === String(owned.categoryId),
				updatedAt: owned.updatedAt
			});
		}
	});
};
