import {
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
import { createFileLogger } from "#src/logger.ts";

const logger = createFileLogger(import.meta.url);

/**
 * FAIL destroys the stream with the error, so the process exits without
 * committing. That is right only for a schema id this consumer did not load at
 * startup: a producer is writing a version registered since, and the restart
 * loads it and reads the message again. Every other message that cannot be
 * decoded continues as poison to the DLQ.
 *
 * This is the only place that knows the message's position, because the error
 * the stream ends with doesn't carry it. A rollout logs this once per instance.
 * The same offset after every restart is a corrupt frame, to be skipped by hand.
 */
export function handleDeserialisationError(
	context: DeserializationErrorContext
) {
	if (context.error instanceof UnknownSchemaIdError) {
		logger.warn(
			{
				err: context.error,
				topic: context.topic,
				partition: context.partition,
				offset: context.offset.toString()
			},
			"Stopping on a schema id not loaded at startup"
		);
		return DeserializationErrorActions.FAIL;
	}

	return DeserializationErrorActions.CONTINUE;
}
