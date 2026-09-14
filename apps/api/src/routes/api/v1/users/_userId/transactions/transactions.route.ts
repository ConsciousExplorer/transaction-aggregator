import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { notFound } from "#src/errors/http-problem.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";
import {
	listResponseSchema,
	mapSourceDetail,
	sourceSchema,
	transactionDetailSchema,
	transactionItemSchema
} from "#src/schemas/transactions.ts";

export default async (
	fastify: FastifyInstance,
	opts: {
		transactionRepository: UserTransactionRepository;
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
				200: listResponseSchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const result = await opts.transactionRepository.getTransactions({
				userId: request.params.userId,
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime,
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
				transactionId: row.transactionId,
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
				200: transactionDetailSchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const row = await opts.transactionRepository.getTransactionDetail({
				userId: request.params.userId,
				transactionId: request.params.transactionId
			});

			if (!row) throw notFound();

			return reply.send({
				transactionId: row.transactionId,
				accountId: row.accountId,
				externalId: row.externalId,
				occurredAt: new Date(row.occurredAt).toISOString(),
				direction: row.direction,
				amount: {
					amountMinor: row.amountMinor,
					currency: row.currency
				},
				description: row.description,
				mcc: row.mcc,
				merchantName: row.merchantName,
				category: row.category,
				source: mapSourceDetail(row.source, row.metadata)
			});
		}
	});
};
