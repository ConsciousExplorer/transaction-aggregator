import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { TransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { notFound } from "#src/problems.ts";
import { sourceSchema } from "#src/schemas/common.ts";
import {
	listResponseSchema,
	transactionItemSchema
} from "#src/schemas/transactions.ts";

export default async (
	fastify: FastifyInstance,
	// Narrowed slice of RouteOptions: this route declares it only knows about
	// the transaction repository — and tests can register it with exactly this.
	opts: {
		transactionRepository: TransactionRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			tags: ["transactions"],
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
				source: z.union([sourceSchema, sourceSchema.array()]).optional(),
				category: z
					.union([z.coerce.string(), z.coerce.string().array()])
					.optional(),
				direction: z
					.union([
						z.enum(["debit", "credit"]),
						z.enum(["debit", "credit"]).array()
					])
					.optional(),
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
			const result = await opts.transactionRepository.getUserTransactions({
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

			if (!result) throw notFound();

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
				data,
				nextCursor: cursor
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/:transactionId",
		schema: {
			tags: ["transactions"],
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
			const row = await opts.transactionRepository.getUserTransactionDetail({
				userId: request.params.userId,
				transactionId: request.params.transactionId
			});

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
