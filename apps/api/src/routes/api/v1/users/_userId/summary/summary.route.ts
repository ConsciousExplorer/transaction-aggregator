import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import type { SummaryRepository } from "#src/integrations/database/repositories/summary-repository.ts";
import {
	amountSchema,
	collectionMetaSchema,
	linksSchema,
	problemSchema,
	signedAmountSchema,
	windowDateTimeSchema
} from "#src/schemas/common.ts";
import { linkWith } from "#src/utils/paging.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";

// Every amount is a money object. debit and credit totals are positive;
// netAmount is the one signed figure.
const directionTotalSchema = z.object({
	count: z.number(),
	total: amountSchema
});

const netAmountSchema = signedAmountSchema.describe(
	"credit − debit: negative when more went out than came in"
);

const summaryTotalSchema = z.object({
	transactionCount: z.number(),
	netAmount: netAmountSchema,
	debit: directionTotalSchema,
	credit: directionTotalSchema
});

const summaryItemSchema = z.object({
	group: z.object({
		category: z.string().optional(),
		month: z.string().optional(),
		week: z.string().optional(),
		day: z.string().optional()
	}),
	count: z.number(),
	netAmount: netAmountSchema,
	debit: directionTotalSchema,
	credit: directionTotalSchema
});

const metaSchema = collectionMetaSchema.extend({
	fromDateTime: z.iso.datetime(),
	toDateTime: z.iso.datetime(),
	groupBy: z.string().array(),
	interval: z.enum(["day", "week", "month", "total"]).optional()
});

type SummaryRow = Awaited<
	ReturnType<SummaryRepository["getUserSummary"]>
>[number];
type SummaryTotal = z.infer<typeof summaryTotalSchema>;

function money(amountMinor: number, currency: string) {
	return { amountMinor, currency };
}

/** Grand totals over all rows. */
function sumTotals(rows: SummaryRow[]): SummaryTotal {
	// The database holds one currency; an empty window has no row to read it from
	const currency = rows[0]?.currency ?? "ZAR";

	let transactionCount = 0;
	let debitCount = 0;
	let debitTotal = 0;
	let creditCount = 0;
	let creditTotal = 0;

	for (const row of rows) {
		transactionCount += row.count;
		debitCount += row.debitCount;
		debitTotal += row.debitAmount;
		creditCount += row.creditCount;
		creditTotal += row.creditAmount;
	}

	return {
		transactionCount,
		netAmount: money(creditTotal - debitTotal, currency),
		debit: { count: debitCount, total: money(debitTotal, currency) },
		credit: { count: creditCount, total: money(creditTotal, currency) }
	};
}

export default async (
	fastify: FastifyInstance,
	opts: { summaryRepository: SummaryRepository; queryWindow: QueryWindowConfig }
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
			tags: ["summary"],
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
				category: z.union([z.string(), z.string().array()]).optional(),
				interval: z.enum(["day", "week", "month"]).optional()
			}),
			response: {
				200: z.object({
					totals: summaryTotalSchema,
					data: summaryItemSchema.array(),
					links: linksSchema,
					meta: metaSchema
				}),
				400: problemSchema
			}
		},
		handler: async (request, reply) => {
			assertWindowWithin(
				request.query.fromDateTime,
				request.query.toDateTime,
				maxWindowDays
			);

			const result = await opts.summaryRepository.getUserSummary({
				userId: request.params.userId,
				fromDate: request.query.fromDateTime,
				toDate: request.query.toDateTime,
				accountId: request.query.accountId,
				category: request.query.category,
				interval: request.query.interval
			});

			return reply.send({
				totals: sumTotals(result),
				data: result.map((row) => ({
					group: {
						category: row.category,
						day: request.query.interval === "day" ? row.bucketStart : undefined,
						week:
							request.query.interval === "week" ? row.bucketStart : undefined,
						month:
							request.query.interval === "month" ? row.bucketStart : undefined
					},
					count: row.count,
					netAmount: money(row.creditAmount - row.debitAmount, row.currency),
					debit: {
						count: row.debitCount,
						total: money(row.debitAmount, row.currency)
					},
					credit: {
						count: row.creditCount,
						total: money(row.creditAmount, row.currency)
					}
				})),
				// The window as parsed, so a future toDateTime shows as now
				links: {
					self: linkWith(request.url, {
						fromDateTime: request.query.fromDateTime,
						toDateTime: request.query.toDateTime
					})
				},
				meta: {
					count: result.length,
					fromDateTime: request.query.fromDateTime,
					toDateTime: request.query.toDateTime,
					groupBy: ["Category"],
					interval: request.query.interval
				}
			});
		}
	});
};
