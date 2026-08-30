import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";
import {
	getUserTransactionDetail,
	getUserTransactions
} from "#src/integrations/database/repositories/transaction-repository.ts";
import { notFound } from "#src/problems.ts";
import { sourceSchema } from "#src/schemas/common.ts";
import {
	listResponseSchema,
	transactionItemSchema
} from "#src/schemas/transactions.ts";

// import { transactionListItemSchema } from "#src/schemas/transactions.ts";

export default async (fastify: FastifyInstance, opts: { database: Pool }) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			hide: false,
			params: z.object({
				userId: z.string()
			}),
			querystring: z.object({
				fromDateTime: z.iso.datetime(),
				toDateTime: z.iso.datetime(),
				accountId: z
					.union([z.string(), z.string().array()])
					.describe("The accountId")
					.optional(),
				source: sourceSchema.optional(),
				category: z.coerce.string().optional(),
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
				category: request.query.category,
				direction: request.query.direction,
				amountMin: request.query.amountMin,
				amountMax: request.query.amountMax,
				cursorOccurredAt: request.query.cursorOccurredAt,
				cursorTransactionId: request.query.cursorTransactionId,
				limit: request.query.limit
			});

			const data = result.map((row) => ({
				id: row.transactionId,
				occurredAt: new Date(row.occurredAt).toISOString(),
				source: row.source,
				direction: row.direction,
				amountMinor: row.amountMinor,
				currency: row.currency,
				category: row.category,
				merchantName: row.merchantName
			}));

			const cursor = null;

			return reply.send({
				data: data,
				nextCursor: cursor
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/:transactionId",
		schema: {
			hide: false,
			params: z.object({
				userId: z.string(),
				transactionId: z.uuid()
			}),
			response: {
				200: transactionItemSchema
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
				occurredAt: new Date(row.occurredAt).toISOString(),
				source: row.source,
				direction: row.direction,
				amountMinor: row.amountMinor,
				currency: row.currency,
				category: row.category,
				merchantName: row.merchantName
			});
		}
	});
};
