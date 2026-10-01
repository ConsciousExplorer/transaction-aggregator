import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import { notFound } from "#src/errors/http-problem.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { problemSchema, windowDateTimeSchema } from "#src/schemas/common.ts";
import {
	listResponseSchema,
	mapFundingSource,
	transactionDetailSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
import {
	type CursorDirection,
	pageLinks,
	toKeysetPage
} from "#src/utils/paging.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";

interface Cursor {
	occurredAt: string;
	transactionId: string;
}

function cursorOf(row: {
	cursorOccurredAt: string;
	transactionId: string;
}): Cursor {
	return { occurredAt: row.cursorOccurredAt, transactionId: row.transactionId };
}

/** The query params that ask for the page on the other side of a cursor */
function cursorParams(
	cursor: Cursor,
	cursorDirection: CursorDirection
): Record<string, string> {
	return {
		cursorOccurredAt: cursor.occurredAt,
		cursorTransactionId: cursor.transactionId,
		cursorDirection
	};
}

export default async (
	fastify: FastifyInstance,
	opts: {
		transactionRepository: UserTransactionRepository;
		queryWindow: QueryWindowConfig;
	}
) => {
	const maxWindowDays = opts.queryWindow.transactionsMaxDays;

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
			querystring: z
				.object({
					fromDateTime: windowDateTimeSchema,
					toDateTime: windowDateTimeSchema.describe(
						`Exclusive. At most ${maxWindowDays} days after fromDateTime`
					),
					accountId: z
						.union([z.string(), z.string().array()])
						.describe("The accountId")
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
					// A page boundary from meta.nextCursor or meta.prevCursor; links.next
					// and links.prev already carry them. next reads older rows, prev newer.
					cursorOccurredAt: z.iso.datetime().optional(),
					cursorTransactionId: z.uuid().optional(),
					cursorDirection: z.enum(["next", "prev"]).default("next"),
					limit: z.coerce.number().int().min(1).max(100).default(50)
				})
				.refine(
					(query) =>
						(query.cursorOccurredAt === undefined) ===
						(query.cursorTransactionId === undefined),
					{
						message:
							"cursorOccurredAt and cursorTransactionId must be sent together",
						path: ["cursorTransactionId"]
					}
				),
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
			const cursorDirection = request.query.cursorDirection;
			const hasCursor = request.query.cursorOccurredAt !== undefined;

			// One extra row tells us whether another page exists in that direction
			const rows = await opts.transactionRepository.getTransactions({
				userId: request.params.userId,
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime,
				transactionType: request.query.transactionType,
				category: request.query.category,
				direction: request.query.direction,
				amountMin: request.query.amountMin,
				amountMax: request.query.amountMax,
				cursorOccurredAt: request.query.cursorOccurredAt,
				cursorTransactionId: request.query.cursorTransactionId,
				cursorDirection,
				limit: limit + 1
			});

			const page = toKeysetPage(rows, limit, cursorDirection, hasCursor);

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

			const nextCursor = page.nextFrom ? cursorOf(page.nextFrom) : null;
			const prevCursor = page.prevFrom ? cursorOf(page.prevFrom) : null;

			// The window as parsed, so a future toDateTime is already now. Every
			// link carries it, and the whole walk reads the same window.
			const windowParams = {
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime
			};
			const links = pageLinks(
				request.url,
				windowParams,
				nextCursor ? cursorParams(nextCursor, "next") : null,
				prevCursor ? cursorParams(prevCursor, "prev") : null
			);

			return reply.send({
				data,
				links,
				meta: {
					count: data.length,
					limit,
					fromDateTime: request.query.fromDateTime,
					toDateTime: request.query.toDateTime,
					nextCursor,
					prevCursor
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

			if (!row) throw notFound();

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
				fundingSource: mapFundingSource(
					row.transactionType,
					row.metadata,
					row.currency
				)
			});
		}
	});
};
