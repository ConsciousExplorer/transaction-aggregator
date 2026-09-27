import { fileLogger } from "#src/runtime.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";

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
	// ingestTransactions: IngestTransactions
): BatchHandler {
	return async function transactionBatchHandler(messages) {
		console.info(messages);
	};
}
