import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import { notFoundError } from "#src/errors/http-problem.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import {
	type CursorDirection,
	problemSchema,
	windowDateTimeSchema
} from "#src/schemas/common.ts";
import {
	listResponseSchema,
	parseFundingSource,
	type TransactionPageCursor,
	type TransactionSort,
	transactionDetailSchema,
	transactionPageCursorSchema,
	transactionSortSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
import {
	buildKeysetPage,
	buildPageLinks,
	decodeCursor,
	encodeCursor
} from "#src/utils/paging.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";

/** The cursor a page boundary row hands to the next or previous page */
function buildPageCursor(
	boundaryRow: { cursorOccurredAt: string; transactionId: string },
	direction: CursorDirection
): TransactionPageCursor {
	return {
		direction,
		position: {
			occurredAt: boundaryRow.cursorOccurredAt,
			transactionId: boundaryRow.transactionId
		}
	};
}

/**
 * The order the repository reads a page in. next continues in the requested
 * sort order. prev reads against it from the cursor, so that LIMIT keeps the
 * rows nearest the cursor rather than the furthest; buildKeysetPage flips them
 * back.
 */
function chooseReadSort(
	requestedSort: TransactionSort,
	cursorDirection: CursorDirection
): TransactionSort {
	if (cursorDirection === "next") {
		return requestedSort;
	}
	if (requestedSort === "occurredAt") {
		return "-occurredAt";
	}
	return "occurredAt";
}

export default async (
	fastify: FastifyInstance,
	opts: {
		transactionRepository: UserTransactionRepository;
		queryWindow: QueryWindowConfig;
	}
) => {
	const maxWindowDays = opts.queryWindow.maxDays;

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
				200: listResponseSchema,
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

			const limit = request.query.limit;
			const pageCursor =
				request.query.cursor === undefined
					? undefined
					: decodeCursor(request.query.cursor, transactionPageCursorSchema);
			const cursorDirection = pageCursor?.direction ?? "next";

			// One extra row tells us whether another page exists in that direction
			const rows = await opts.transactionRepository.getTransactions({
				userId: request.params.userId,
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime,
				accountId: request.query.accountId,
				transactionType: request.query.transactionType,
				category: request.query.category,
				direction: request.query.direction,
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

			const data = page.rows.map((row) => ({
				transactionId: row.transactionId,
				occurredAt: new Date(row.occurredAt).toISOString(),
				transactionType: row.transactionType,
				direction: row.direction,
				status: row.status,
				amount: {
					amountMinor: row.amountMinor,
					currency: row.currency
				},
				category: row.category,
				shortDescription: row.shortDescription
			}));

			const nextParams = page.nextFrom
				? { cursor: encodeCursor(buildPageCursor(page.nextFrom, "next")) }
				: null;
			const prevParams = page.prevFrom
				? { cursor: encodeCursor(buildPageCursor(page.prevFrom, "prev")) }
				: null;

			// The window as parsed, so a future toDateTime is already now. Every
			// link carries it, and the whole walk reads the same window.
			const windowParams = {
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime
			};
			const links = buildPageLinks(
				request.url,
				windowParams,
				nextParams,
				prevParams
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

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/:transactionId",
		config: {
			authConfig: {
				requiredScope: ["tx:read"]
			}
		},
		schema: {
			tags: ["transactions"],
			hide: false,
			params: z.object({
				userId: z.uuid(),
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

			if (!row) throw notFoundError();

			return reply.send({
				transactionId: row.transactionId,
				accountId: row.accountId,
				externalId: row.externalId,
				occurredAt: new Date(row.occurredAt).toISOString(),
				direction: row.direction,
				status: row.status,
				amount: {
					amountMinor: row.amountMinor,
					currency: row.currency
				},
				longDescription: row.longDescription,
				shortDescription: row.shortDescription,
				category: row.category,
				fundingSource: parseFundingSource(
					row.transactionType,
					row.metadata,
					row.currency
				)
			});
		}
	});
};
