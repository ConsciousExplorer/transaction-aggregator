import type { ValidMessage } from "#src/integrations/events/handlers/transactionBatchHandler.ts";
import type { CardTransaction } from "#src/schemas/card.ts";
import { castToDomainTransaction } from "#src/services/test-records.ts";

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

/**
 * A card record as the Kafka adapter hands it to the batch handler: decoded,
 * with the bytes it arrived as, so a dead letter can be compared with them.
 */
export function buildValidMessage(record: CardTransaction, offset: bigint) {
	return {
		kind: "valid",
		topic: "transactions.card",
		partition: 0,
		offset,
		headers: new Map([["traceparent", TRACEPARENT]]),
		value: castToDomainTransaction(record),
		raw: Buffer.from(`raw bytes of ${record.transactionId}`),
		recordTimestamp: Date.now()
	} satisfies ValidMessage;
}
