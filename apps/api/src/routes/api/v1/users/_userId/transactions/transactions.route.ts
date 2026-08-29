import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { Queryable } from "#src/integrations/database/pool.ts";
import { getUserTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import { sourceSchema } from "#src/schemas/common.ts";
import { listResponseSchema } from "#src/schemas/transactions.ts";

// import { transactionListItemSchema } from "#src/schemas/transactions.ts";

const routeParamsSchema = z.object({
	userId: z.string()
});

/**
 * A basic info route
 */
export default async (
	fastify: FastifyInstance,
	opts: { database: Queryable }
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			hide: false,
			params: routeParamsSchema,
			querystring: z.object({
				accountId: z
					.union([z.string(), z.string().array()])
					.describe("The accountId"),
				fromDateTime: z.iso.datetime(),
				toDateTime: z.iso.datetime(),
				source: sourceSchema.optional(),
				categoryId: z.coerce.number().int().optional(),
				direction: z.enum(["debit", "credit"]).optional(),
				amountMin: z.coerce.number().int().optional(),
				amountMax: z.coerce.number().int().optional(),
				cursorOccurredAt: z.iso.datetime().optional(),
				cursorTransactionId: z.uuid().optional(),
				limit: z.coerce.number().int().min(1).max(100).default(50)
			}),

			response: {
				200: listResponseSchema
			}
		},
		handler: async (request, reply) => {
			const result = await getUserTransactions(opts.database, {
				userId: request.params.userId,
				fromDate: request.query.fromDateTime,
				toDate: request.query.toDateTime,
				limit: request.query.limit
			});

			const data = result.map((row) => ({
				id: row.transactionId,
				occurredAt: new Date(row.occurredAt).toISOString(),
				source: row.source,
				direction: row.direction,
				amountMinor: row.amountMinor,
				currency: row.currency,
				categoryId: row.categoryId,
				merchantName: row.merchantName
			}));

			const cursor = null;

			return reply.send({
				data: data,
				nextCursor: cursor
			});
		}
	});
};
