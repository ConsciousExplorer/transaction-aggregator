import {
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";

/**
 * FAIL destroys the stream with the error, so the process exits without
 * committing. That is right only for a schema id this consumer did not load at
 * startup: a producer is writing a version registered since, and the restart
 * loads it and reads the message again. Every other message that cannot be
 * decoded continues as poison to the DLQ.
 */
export function handleDeserialisationError(
	context: DeserializationErrorContext
) {
	if (context.error instanceof UnknownSchemaIdError) {
		return DeserializationErrorActions.FAIL;
	}

	return DeserializationErrorActions.CONTINUE;
}
