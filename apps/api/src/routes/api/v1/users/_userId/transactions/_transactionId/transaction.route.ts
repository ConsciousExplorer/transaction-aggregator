import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { Queryable } from "#src/integrations/database/pool.ts";
import { getUserTransactionDetail } from "#src/integrations/database/repositories/transaction-repository.ts";
import { notFound } from "#src/problems.ts";
import { transactionListItemSchema } from "#src/schemas/transactions.ts";

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
				200: transactionListItemSchema
			}
		},
		handler: async (request, reply) => {
			const row = await getUserTransactionDetail(opts.database, {
				userId: request.params.userId,
				transactionId: request.params.transactionId
			});

			// Problem instances are turned into RFC 9457 responses by the problemJson plugin
			if (!row) throw notFound();

			return reply.send({
				id: row.transactionId,
				occurredAt: row.occurredAt,
				source: row.source,
				direction: row.direction,
				amountMinor: row.amountMinor,
				currency: row.currency,
				categoryId: row.categoryId,
				merchantName: row.merchantName
			});
		}
	});
};
