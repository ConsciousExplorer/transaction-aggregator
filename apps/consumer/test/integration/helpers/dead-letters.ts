import type { DeadLetterFailure } from "#src/integrations/events/handlers/transactionBatchHandler.ts";

/**
 * A DLQ sender that keeps what it is given instead of producing it to Kafka,
 * so a test can read exactly what would have been dead-lettered.
 */
export function createRecordingDeadLetterSender(
	deadLetters: DeadLetterFailure[]
) {
	return async function sendToDeadLetterQueue(failures: DeadLetterFailure[]) {
		for (const failure of failures) {
			deadLetters.push(failure);
		}
	};
}
