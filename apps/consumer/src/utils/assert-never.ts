/**
 * Exhaustiveness guard for a discriminated union. Every case handled means the
 * argument narrows to `never` here, so adding a variant without handling it is
 * a compile error rather than a silently skipped message.
 */
export function assertNever(value: never): never {
	throw new Error(`Unhandled union member: ${JSON.stringify(value)}`);
}
