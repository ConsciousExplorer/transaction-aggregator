import {
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";
import {
	SchemaRegistryError,
	UnknownSchemaIdError
} from "#src/errors/consumer-errors.ts";
import { createFileLogger } from "#src/logger.ts";

const logger = createFileLogger(import.meta.url);

/**
 * A message whose schema could not be loaded has nothing wrong with it that is
 * known yet: the registry was unreachable, or didn't have the id. Either
 * error means the schema is not there to decode with.
 */
function isMissingSchema(error: unknown) {
	return (
		error instanceof SchemaRegistryError ||
		error instanceof UnknownSchemaIdError
	);
}

/**
 * FAIL destroys the stream with the error, so the process exits without
 * committing. That is right only when the message's schema could not be
 * loaded: the restart asks the registry again and reads the message again.
 * Every other message that cannot be decoded continues as poison to the DLQ.
 *
 * This is the only place that knows the message's position, because the error
 * the stream ends with doesn't carry it. The same offset after every restart
 * is a corrupt frame naming an id the registry doesn't have, to be skipped by
 * hand.
 */
export function handleDeserialisationError(
	context: DeserializationErrorContext
) {
	if (isMissingSchema(context.error)) {
		logger.warn(
			{
				err: context.error,
				topic: context.topic,
				partition: context.partition,
				offset: context.offset.toString()
			},
			"Stopping on a message whose schema could not be loaded"
		);
		return DeserializationErrorActions.FAIL;
	}

	return DeserializationErrorActions.CONTINUE;
}
