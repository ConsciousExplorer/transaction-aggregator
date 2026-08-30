import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";
import { getUserSummary } from "#src/integrations/database/repositories/summary-repository.ts";
import { notFound } from "#src/problems.ts";
import { sourceSchema } from "#src/schemas/common.ts";

const summaryItemSchema = z.object({
	category: z.string(),
	currency: z.string(),
	amount: z.number()
});

export default async (fastify: FastifyInstance, opts: { database: Pool }) => {
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
				source: sourceSchema.optional(),
				category: z.coerce.string().optional(),
				direction: z.enum(["debit", "credit"]).optional(),
				amountMin: z.coerce.number().int().optional(),
				amountMax: z.coerce.number().int().optional()
			}),
			response: {
				200: z.object({
					data: summaryItemSchema.array(),
					metadata: z.unknown()
				})
			}
		},
		handler: async (request, reply) => {
			const result = await getUserSummary(opts.database, {
				userId: request.params.userId,
				fromDate: request.query.fromDateTime,
				toDate: request.query.toDateTime,
				category: request.query.category,
				direction: request.query.direction,
				amountMin: request.query.amountMin,
				amountMax: request.query.amountMax
			});

			if (!result) throw notFound();

			return reply.send({
				data: result.map((row) => ({
					category: row.category,
					currency: row.currency,
					amount: Number(row.amount ?? 0)
				})),
				metadata: {}
			});
		}
	});
};
