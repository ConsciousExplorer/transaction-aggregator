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

export class SchemaRegistryError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "SchemaRegistryError";
	}
}
