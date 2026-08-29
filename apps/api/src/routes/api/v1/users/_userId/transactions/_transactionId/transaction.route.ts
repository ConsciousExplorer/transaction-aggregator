import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { Queryable } from "#src/integrations/database/pool.ts";
import { getUserTransactionDetail } from "#src/integrations/database/repositories/transaction-repository.ts";
import { listResponseSchema } from "#src/schemas/transactions.ts";

// import { transactionListItemSchema } from "#src/schemas/transactions.ts";

const routeParamsSchema = z.object({
	userId: z.string(),
	transactionId: z.uuid()
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
			response: {
				200: listResponseSchema
			}
		},
		handler: async (request, reply) => {
			console.log(request.params);
			const result = await getUserTransactionDetail(opts.database, {
				userId: request.params.userId,
				transactionId: request.params.transactionId
			});

			const data = result.map((row) => ({
				id: row.transactionId,
				occurredAt: row.occurredAt,
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
