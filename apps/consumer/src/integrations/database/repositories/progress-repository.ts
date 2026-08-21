import type { PoolClient } from "pg";

export interface ProgressCounts {
	messagesTotal: number;
	rowsInsertedTotal: number;
	duplicatesTotal: number;
	dlqTotal: number;
	tombstonesTotal: number;
	filteredTotal: number;
	lastOccurredAt: Date | null;
}

export interface ProgressReport {
	topic: string;
	partition: number;
	lastOffset: number;
	counts: ProgressCounts;
}

export async function updateProgressReport(
	client: PoolClient,
	report: ProgressReport
): Promise<{ inserted: number }> {
	const result = await client.query(
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
