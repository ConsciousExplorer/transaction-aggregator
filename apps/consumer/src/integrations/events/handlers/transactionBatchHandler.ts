import { fileLogger } from "#src/runtime.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type { IngestTransactions } from "#src/services/ingestion.ts";

const logger = fileLogger(import.meta.url);

interface MessageOrigin {
	topic: string;
	partition: number;
	offset: bigint;
}

export type ClassifiedMessage =
	| (MessageOrigin & { kind: "valid"; value: DomainTransactionSchema })
	| (MessageOrigin & { kind: "tombstone" })
	| (MessageOrigin & { kind: "poison"; raw: Buffer | null; error: unknown });

export interface DlqFailure {
	message: Exclude<ClassifiedMessage, { kind: "tombstone" }>;
	error: unknown;
}

export type BatchHandler = (messages: ClassifiedMessage[]) => Promise<void>;
export type SendToDlq = (failures: DlqFailure[]) => Promise<void>;

export function createTransactionBatchHandler(
	ingestTransactions: IngestTransactions,
	sendToDlq: SendToDlq
): BatchHandler {
	return async function transactionBatchHandler(messages) {
		const transactions: DomainTransactionSchema[] = [];
		const failures: DlqFailure[] = [];
		let tombstones = 0;

		for (const message of messages) {
			if (message.kind === "valid") {
				transactions.push(message.value);
			} else if (message.kind === "poison") {
				// Already unreadable upstream — straight to the DLQ, never ingestion.
				failures.push({ message, error: message.error });
			} else {
				tombstones++;
			}
		}

		// Poison first: the caller commits offsets once this resolves, so the
		// bad records must be durably on the DLQ topic before that happens.
		if (failures.length > 0) {
			await sendToDlq(failures);
			logger.warn({ size: failures.length }, "Dead-lettered poison messages");
		}

		if (transactions.length === 0) {
			logger.debug({ tombstones }, "No valid transactions in batch");
			return;
		}

		const outcome = await ingestTransactions(transactions);

		const duplicates = outcome.attempted - outcome.inserted;
		if (duplicates > 0) {
			logger.warn(
				{
					attempted: outcome.attempted,
					inserted: outcome.inserted,
					duplicates
				},
				"Batch contained duplicates"
			);
		}

		logger.info(
			{
				inserted: outcome.inserted,
				tombstones,
				poison: failures.length
			},
			"Batch ingested"
		);
	};
}
