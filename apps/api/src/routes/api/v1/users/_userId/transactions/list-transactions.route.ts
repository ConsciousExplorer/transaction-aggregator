import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";
import {
	buildTransactionFilterQuerySchema,
	transactionPageCursorSchema,
	transactionSortSchema
} from "#src/schemas/transactions.ts";
import { buildPageLinks, decodeCursor } from "#src/utils/paging.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";
import { buildTransactionItem } from "./transactions.mappers.ts";
import { transactionListResponseSchema } from "./transactions.schemas.ts";

export default async function registerListTransactionsRoute(
	fastify: FastifyInstance,
	options: {
		transactionRepository: Pick<
			UserTransactionRepository,
			"seekTransactionPage"
		>;
		queryWindow: QueryWindowConfig;
	}
) {
	const maxWindowDays = options.queryWindow.maxDays;

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		config: {
			authConfig: {
				requiredScope: ["tx:read"]
			}
		},
		schema: {
			tags: ["transactions"],
			params: z.object({
				userId: z.uuid()
			}),
			querystring: buildTransactionFilterQuerySchema(maxWindowDays).extend({
				sort: transactionSortSchema
					.default("-occurredAt")
					.describe("-occurredAt is newest first, occurredAt oldest first"),
				cursor: z
					.string()
					.optional()
					.describe("Opaque. Follow links.next or links.prev; never build one"),
				limit: z.coerce.number().int().min(1).max(100).default(50)
			}),
			response: {
				200: transactionListResponseSchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			assertWindowWithin(
				request.query.fromDateTime,
				request.query.toDateTime,
				maxWindowDays
			);

			const page = await options.transactionRepository.seekTransactionPage({
				userId: request.params.userId,
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime,
				accountId: request.query.accountId,
				transactionType: request.query.transactionType,
				category: request.query.category,
				creditDebitIndicator: request.query.creditDebitIndicator,
				amountMin: request.query.amountMin,
				amountMax: request.query.amountMax,
				sort: request.query.sort,
				cursor: decodeCursor(request.query.cursor, transactionPageCursorSchema),
				limit: request.query.limit
			});

			const data = [];
			for (const row of page.rows) {
				data.push(buildTransactionItem(row));
			}

			// The window as parsed, so a future toDateTime is already now. Every
			// link carries it, and the whole walk reads the same window.
			const windowParams = {
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime
			};

			return reply.send({
				data,
				links: buildPageLinks(
					request.url,
					windowParams,
					page.nextCursor,
					page.previousCursor
				),
				meta: {
					count: data.length,
					limit: request.query.limit,
					sort: request.query.sort,
					...windowParams
				}
			});
		}
	});
}
