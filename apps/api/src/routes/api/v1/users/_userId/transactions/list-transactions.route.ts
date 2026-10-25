import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema, windowDateTimeSchema } from "#src/schemas/common.ts";
import {
	creditDebitIndicatorSchema,
	transactionPageCursorSchema,
	transactionSortSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
import { assertKnownCategories } from "#src/utils/category-filter.ts";
import {
	buildKeysetPage,
	buildPageLinks,
	decodeCursor,
	encodeCursor
} from "#src/utils/paging.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";
import {
	buildPageCursor,
	buildTransactionItem,
	chooseReadSort
} from "./transactions.mappers.ts";
import { transactionListResponseSchema } from "./transactions.schemas.ts";

export default async function registerListTransactionsRoute(
	fastify: FastifyInstance,
	options: {
		transactionRepository: Pick<UserTransactionRepository, "getTransactions">;
		categoryRepository: Pick<CategoryRepository, "findUnknownCategories">;
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
			hide: false,
			params: z.object({
				userId: z.uuid()
			}),
			querystring: z.object({
				fromDateTime: windowDateTimeSchema,
				toDateTime: windowDateTimeSchema.describe(
					`Exclusive. At most ${maxWindowDays} days after fromDateTime`
				),
				accountId: z
					.union([z.uuid(), z.uuid().array()])
					.describe(
						"One or more of the user's accounts; all accounts when left out"
					)
					.optional(),
				transactionType: z
					.union([transactionTypeSchema, transactionTypeSchema.array()])
					.optional(),
				category: z.union([z.string(), z.string().array()]).optional(),
				creditDebitIndicator: z
					.union([
						creditDebitIndicatorSchema,
						creditDebitIndicatorSchema.array()
					])
					.optional(),
				amountMin: z.coerce.number().int().optional(),
				amountMax: z.coerce.number().int().optional(),
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
			await assertKnownCategories(
				options.categoryRepository,
				request.query.category
			);

			const limit = request.query.limit;
			const pageCursor =
				request.query.cursor === undefined
					? undefined
					: decodeCursor(request.query.cursor, transactionPageCursorSchema);
			const cursorDirection = pageCursor?.direction ?? "next";

			// One extra row tells us whether another page exists in that direction
			const rows = await options.transactionRepository.getTransactions({
				userId: request.params.userId,
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime,
				accountId: request.query.accountId,
				transactionType: request.query.transactionType,
				category: request.query.category,
				creditDebitIndicator: request.query.creditDebitIndicator,
				amountMin: request.query.amountMin,
				amountMax: request.query.amountMax,
				sort: chooseReadSort(request.query.sort, cursorDirection),
				cursor: pageCursor?.position,
				limit: limit + 1
			});

			const page = buildKeysetPage(
				rows,
				limit,
				cursorDirection,
				pageCursor !== undefined
			);

			const data = [];
			for (const row of page.rows) {
				data.push(buildTransactionItem(row));
			}

			const nextPageQuery = page.nextFrom
				? { cursor: encodeCursor(buildPageCursor(page.nextFrom, "next")) }
				: null;
			const previousPageQuery = page.prevFrom
				? { cursor: encodeCursor(buildPageCursor(page.prevFrom, "prev")) }
				: null;

			// The window as parsed, so a future toDateTime is already now. Every
			// link carries it, and the whole walk reads the same window.
			const windowQuery = {
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime
			};
			const links = buildPageLinks(
				request.url,
				windowQuery,
				nextPageQuery,
				previousPageQuery
			);

			return reply.send({
				data,
				links,
				meta: {
					count: data.length,
					limit,
					sort: request.query.sort,
					fromDateTime: request.query.fromDateTime,
					toDateTime: request.query.toDateTime
				}
			});
		}
	});
}
