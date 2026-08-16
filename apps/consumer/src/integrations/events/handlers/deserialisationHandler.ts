import {
	type DeserializationErrorAction,
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";

export function deserializationErrorHandler(
	_context: DeserializationErrorContext
): DeserializationErrorAction {
	// Platformatic version 2.9 added CONTINUE
	// Previously only the following actions existed
	// FAIL - crash the consumer
	// SKIP - losses data
	return DeserializationErrorActions.CONTINUE;
}
