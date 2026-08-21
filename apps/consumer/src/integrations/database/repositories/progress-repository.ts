import { z } from "zod";
import type { Queryable } from "../pool.ts";

const countSchema = z.number().int().min(0);

export const progressCountsSchema = z.object({
	messagesTotal: countSchema,
	rowsInsertedTotal: countSchema,
	duplicatesTotal: countSchema,
	dlqTotal: countSchema,
	tombstonesTotal: countSchema,
	filteredTotal: countSchema,
	lastOccurredAt: z.iso.datetime().nullable()
});

export const progressReportSchema = z.object({
	topic: z.string().min(1),
	partition: z.number().int().min(0),
	lastOffset: z.number().int().min(0),
	counts: progressCountsSchema
});

export type ProgressCounts = z.infer<typeof progressCountsSchema>;
export type ProgressReport = z.infer<typeof progressReportSchema>;

export async function updateProgressReport(
	db: Queryable,
	input: ProgressReport
): Promise<{ inserted: number }> {
	// The data boundary is validated here, not by the caller's types.
	const report = progressReportSchema.parse(input);

	const result = await db.query(
		`
                INSERT INTO ingest_progress (
                    topic,
                    partition,
                    last_offset,
                    messages_total,
                    rows_inserted_total,
                    duplicates_total,
                    dlq_total,
                    tombstones_total,
                    filtered_total,
                    last_occurred_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (topic, partition) DO UPDATE SET
                    last_offset = GREATEST(
                        ingest_progress.last_offset,
                        EXCLUDED.last_offset
                    ),
                    messages_total =
                        ingest_progress.messages_total + EXCLUDED.messages_total,
                    rows_inserted_total =
                        ingest_progress.rows_inserted_total + EXCLUDED.rows_inserted_total,
                    duplicates_total =
                        ingest_progress.duplicates_total + EXCLUDED.duplicates_total,
                    dlq_total =
                        ingest_progress.dlq_total + EXCLUDED.dlq_total,
                    tombstones_total =
                        ingest_progress.tombstones_total + EXCLUDED.tombstones_total,
                    filtered_total =
                        ingest_progress.filtered_total + EXCLUDED.filtered_total,
                    last_occurred_at = GREATEST(
                        ingest_progress.last_occurred_at,
                        EXCLUDED.last_occurred_at
                    ),
                    updated_at = now()
                `,
		[
			report.topic,
			report.partition,
			report.lastOffset,
			report.counts.messagesTotal,
			report.counts.rowsInsertedTotal,
			report.counts.duplicatesTotal,
			report.counts.dlqTotal,
			report.counts.tombstonesTotal,
			report.counts.filteredTotal,
			report.counts.lastOccurredAt
		]
	);

	return { inserted: result.rowCount ?? 0 };
}
