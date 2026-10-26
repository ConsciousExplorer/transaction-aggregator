import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { QueryWindowConfig } from "#src/config.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import type { SummaryRepository } from "#src/integrations/database/repositories/summary-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";
import {
	buildTransactionFilterQuerySchema,
	summaryIntervalSchema
} from "#src/schemas/transactions.ts";
import { assertKnownCategories } from "#src/utils/category-filter.ts";
import { buildLink } from "#src/utils/paging.ts";
import { assertWindowWithin } from "#src/utils/time-window.ts";
import { buildSummaryItem, sumTotals } from "./summary.mappers.ts";
import { summaryResponseSchema } from "./summary.schemas.ts";

export default async function registerSummaryRoute(
	fastify: FastifyInstance,
	options: {
		summaryRepository: Pick<SummaryRepository, "getUserSummary">;
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
			tags: ["summary"],
			params: z.object({
				userId: z.uuid()
			}),
			querystring: buildTransactionFilterQuerySchema(maxWindowDays).extend({
				interval: summaryIntervalSchema
					.optional()
					.describe("Left out, the whole window is one bucket")
			}),
			response: {
				200: summaryResponseSchema,
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

			const rows = await options.summaryRepository.getUserSummary({
				userId: request.params.userId,
				fromDateTime: request.query.fromDateTime,
				toDateTime: request.query.toDateTime,
				accountId: request.query.accountId,
				transactionType: request.query.transactionType,
				category: request.query.category,
				creditDebitIndicator: request.query.creditDebitIndicator,
				amountMin: request.query.amountMin,
				amountMax: request.query.amountMax,
				interval: request.query.interval
			});

			const data = [];
			for (const row of rows) {
				data.push(buildSummaryItem(row, request.query.interval));
			}

			return reply.send({
				totals: sumTotals(rows),
				data,
				// The window as parsed, so a future toDateTime shows as now
				links: {
					self: buildLink(request.url, {
						fromDateTime: request.query.fromDateTime,
						toDateTime: request.query.toDateTime
					})
				},
				meta: {
					count: rows.length,
					fromDateTime: request.query.fromDateTime,
					toDateTime: request.query.toDateTime,
					groupBy: ["Category"],
					interval: request.query.interval
				}
			});
		}
	});
}
