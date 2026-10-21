import assert from "node:assert/strict";
import { mock, suite, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { asFunction, createContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { pino } from "pino";
import { endPool } from "#src/integrations/database/pool.ts";
import { shutDownGracefully } from "./shutdown.ts";

// Each step takes a while and records when it has finished, so the order of
// the events shows whether a step was awaited before the next one began.

function buildSlowClosingServer(events: string[]) {
	return {
		close: mock.fn(async () => {
			await wait(10);
			events.push("server closed");
		})
	} as unknown as FastifyInstance;
}

function buildFailingServer() {
	return {
		close: mock.fn(async () => {
			throw new Error("close failed");
		})
	} as unknown as FastifyInstance;
}

function buildSlowEndingPool(events: string[]) {
	return {
		end: mock.fn(async () => {
			await wait(10);
			events.push("pool ended");
		})
	} as unknown as Pool;
}

/** A logger that keeps every line it writes, parsed */
function buildRecordingLogger(lines: Record<string, unknown>[]) {
	return pino(
		{ level: "info" },
		{
			write(line: string) {
				lines.push(JSON.parse(line));
			}
		}
	);
}

/**
 * The pool registered with the disposer container.ts gives it, and resolved:
 * dispose() runs the disposers of what has been resolved.
 */
function buildContainerHoldingPool(pool: Pool) {
	const container = createContainer();
	container.register({
		database: asFunction(() => pool)
			.singleton()
			.disposer(endPool)
	});
	container.resolve("database");
	return container;
}

suite("shutDownGracefully", () => {
	test("closes the server, then ends the pool, and exits only after both have finished", async (context) => {
		const events: string[] = [];
		context.mock.method(process, "exit", (code: number) => {
			events.push(`exit ${code}`);
		});

		await shutDownGracefully(
			buildSlowClosingServer(events),
			buildContainerHoldingPool(buildSlowEndingPool(events)),
			pino({ level: "silent" }),
			0
		);

		assert.deepStrictEqual(events, ["server closed", "pool ended", "exit 0"]);
	});

	test("exits with 1 when the server fails to close, and logs why", async (context) => {
		const exit = context.mock.method(process, "exit", () => {});
		const lines: Record<string, unknown>[] = [];

		await shutDownGracefully(
			buildFailingServer(),
			createContainer(),
			buildRecordingLogger(lines),
			0
		);

		assert.strictEqual(exit.mock.callCount(), 1);
		assert.deepStrictEqual(exit.mock.calls[0]?.arguments, [1]);
		// pino writes an Error's message and stack only under err; under any
		// other key both are dropped
		const failure = lines.at(-1)?.err as { message?: string } | undefined;
		assert.strictEqual(failure?.message, "close failed");
	});
});
