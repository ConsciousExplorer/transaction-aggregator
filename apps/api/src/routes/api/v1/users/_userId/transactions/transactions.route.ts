import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import { notFound } from "#src/errors/http-problem.ts";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { type Links, problemSchema } from "#src/schemas/common.ts";
import {
	listResponseSchema,
	mapFundingSource,
	transactionDetailSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";

interface Cursor {
	occurredAt: string;
	transactionId: string;
}

type CursorDirection = "next" | "prev";

function cursorOf(row: { cursorOccurredAt: string; transactionId: string }) {
	return { occurredAt: row.cursorOccurredAt, transactionId: row.transactionId };
}

/**
 * The request's own path and query with the cursor replaced, so every filter
 * the caller sent carries over exactly as sent. Relative, so the API never has
 * to know the public host it is reached through.
 */
function pageLink(
	requestUrl: string,
	cursor: Cursor,
	cursorDirection: CursorDirection
): string {
	const queryStart = requestUrl.indexOf("?");
	const path = queryStart === -1 ? requestUrl : requestUrl.slice(0, queryStart);
	const params = new URLSearchParams(
		queryStart === -1 ? "" : requestUrl.slice(queryStart + 1)
	);

	params.set("cursorOccurredAt", cursor.occurredAt);
	params.set("cursorTransactionId", cursor.transactionId);
	params.set("cursorDirection", cursorDirection);

	return `${path}?${params.toString()}`;
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
				userId: z.string()
			}),
			querystring: z
				.object({
					fromDateTime: z.iso.datetime(),
					toDateTime: z.iso
						.datetime()
						.describe(
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

			const hasMore = rows.length > limit;
			const fetched = hasMore ? rows.slice(0, limit) : rows;
			// A prev page is read upwards, oldest first; every page is served newest first
			const page =
				cursorDirection === "prev" ? fetched.slice().reverse() : fetched;

			const data = page.map((row) => ({
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

			// Older rows exist when the page was read downwards and came back full,
			// or was read upwards from a cursor (the page it came from is older).
			// Newer rows are the mirror image.
			const hasOlder = cursorDirection === "next" ? hasMore : hasCursor;
			const hasNewer = cursorDirection === "prev" ? hasMore : hasCursor;

			const firstRow = page.at(0);
			const lastRow = page.at(-1);
			const nextCursor = hasOlder && lastRow ? cursorOf(lastRow) : null;
			const prevCursor = hasNewer && firstRow ? cursorOf(firstRow) : null;

			const links: Links = { self: request.url };
			if (nextCursor) links.next = pageLink(request.url, nextCursor, "next");
			if (prevCursor) links.prev = pageLink(request.url, prevCursor, "prev");

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
