import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { SummaryRepository } from "#src/integrations/database/repositories/summary-repository.ts";

const summaryTotalSchema = z.object({
	currency: z.string(),
	transactionCount: z.number(),
	netAmount: z.number(),
	debit: z.object({ count: z.number(), total: z.number() }),
	credit: z.object({ count: z.number(), total: z.number() })
});

const summaryItemSchema = z.object({
	group: z.object({
		category: z.string().optional(),
		month: z.string().optional(),
		week: z.string().optional(),
		day: z.string().optional()
	}),
	currency: z.string(),
	count: z.number(),
	netAmount: z.number(),
	debit: z.object({ count: z.number(), total: z.number() }),
	credit: z.object({ count: z.number(), total: z.number() })
});

const metaSchema = z.object({
	fromDateTime: z.iso.datetime(),
	toDateTime: z.iso.datetime(),
	groupBy: z.string().array(),
	interval: z.enum(["day", "week", "month"]).optional()
});

type SummaryRow = Awaited<
	ReturnType<SummaryRepository["getUserSummary"]>
>[number];
type SummaryTotal = z.infer<typeof summaryTotalSchema>;

/** Grand totals over all rows. Assumes a single currency (current spec). */
function sumTotals(rows: SummaryRow[]): SummaryTotal {
	const totals: SummaryTotal = {
		currency: rows[0]?.currency ?? "ZAR",
		transactionCount: 0,
		netAmount: 0,
		debit: { count: 0, total: 0 },
		credit: { count: 0, total: 0 }
	};

	for (const row of rows) {
		totals.transactionCount += row.count;
		totals.netAmount += row.creditAmount - row.debitAmount;
		totals.debit.count += row.debitCount;
		totals.debit.total += row.debitAmount;
		totals.credit.count += row.creditCount;
		totals.credit.total += row.creditAmount;
	}

	return totals;
}

export default async (
	fastify: FastifyInstance,
	opts: { summaryRepository: SummaryRepository }
) => {
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
				category: z.union([z.string(), z.string().array()]).optional(),
				interval: z.enum(["day", "week", "month"]).optional()
			}),
			response: {
				200: z.object({
					totals: summaryTotalSchema,
					data: summaryItemSchema.array(),
					meta: metaSchema
				})
			}
		},
		handler: async (request, reply) => {
			const result = await opts.summaryRepository.getUserSummary({
				userId: request.params.userId,
				fromDate: request.query.fromDateTime,
				toDate: request.query.toDateTime,
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
					currency: row.currency,
					count: row.count,
					netAmount: Number(row.creditAmount) - Number(row.debitAmount),
					debit: {
						count: Number(row.debitCount),
						total: Number(row.debitAmount)
					},
					credit: {
						count: Number(row.creditCount),
						total: Number(row.creditAmount)
					}
				})),
				meta: {
					fromDateTime: request.query.fromDateTime,
					toDateTime: request.query.toDateTime,
					groupBy: ["Category"],
					interval: request.query.interval
				}
			});
		}
	});
};
