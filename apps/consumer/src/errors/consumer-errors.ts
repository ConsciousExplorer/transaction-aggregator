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
 * The registry could not give a usable answer. `status` is the HTTP status, or
 * undefined when the registry was unreachable or timed out.
 */
export class SchemaRegistryError extends Error {
	readonly status: number | undefined;

	constructor(
		message: string,
		context: { cause?: unknown; status: number | undefined }
	) {
		super(message, { cause: context.cause });
		this.name = "SchemaRegistryError";
		this.status = context.status;
	}
}
