import {
	type DeserializationErrorAction,
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";
import { SchemaRegistryError } from "#src/errors/consumer-errors.ts";

/**
 * FAIL destroys the stream with the error, so the process exits without
 * committing and the container restart retries the registry read on boot.
 * That is only right while the registry cannot answer. A 404 is a definite
 * answer that no retry changes, so that message continues as poison to the DLQ,
 * like every other message that cannot be decoded.
 */
export function handleDeserialisationError(
	context: DeserializationErrorContext
): DeserializationErrorAction {
	const registryUnavailable =
		context.error instanceof SchemaRegistryError &&
		context.error.status !== 404;

	if (registryUnavailable) {
		return DeserializationErrorActions.FAIL;
	}

	return DeserializationErrorActions.CONTINUE;
}
