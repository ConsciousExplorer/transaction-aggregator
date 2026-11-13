export interface ErrorContext {
	cause?: unknown;
	details?: Record<string, unknown>;
}

export class RetryableError extends Error {
	details: Record<string, unknown>;

	constructor(message: string, context: ErrorContext = {}) {
		super(message, { cause: context.cause });
		this.name = "RetryableError";
		this.details = context.details ?? {};
	}
}

export class NonRetryableError extends Error {
	readonly details: Record<string, unknown>;

	constructor(message: string, context: ErrorContext = {}) {
		super(message, { cause: context.cause });
		this.name = "NonRetryableError";
		this.details = context.details ?? {};
	}
}

/**
 * A message names a schema id that is not among the loaded schemas. The
 * missing-schema loader fetches an unknown id before the message is decoded,
 * so this is only thrown when that loader did not run.
 */
export class UnknownSchemaIdError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnknownSchemaIdError";
	}
}

/**
 * The registry could not give a usable answer. The message says why: it was
 * unreachable, it answered with an HTTP error status, or the body was not
 * what was asked for.
 */
export class SchemaRegistryError extends Error {
	constructor(message: string, options: { cause: unknown }) {
		super(message, options);
		this.name = "SchemaRegistryError";
	}
}
