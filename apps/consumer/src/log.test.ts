import assert from "node:assert";
import { suite, test } from "node:test";
import { pino } from "pino";

/**
 * `log.ts` keeps module state (the root logger and the child-created guard),
 * so every case needs its own instance. A unique query string defeats the
 * module cache without touching the module itself.
 */
let instance = 0;
async function freshLog() {
	instance += 1;
	return await import(`./log.ts?case=${instance}`);
}

/** Collects what pino writes, so a test can assert on real emitted records. */
function capture() {
	const lines: Record<string, unknown>[] = [];

	const logger = pino(
		{ level: "info" },
		{
			write(chunk: string) {
				lines.push(JSON.parse(chunk));
			}
		}
	);

	return { logger, lines };
}

suite("log", () => {
	test("fileLogger works with no configuration", async () => {
		const { fileLogger } = await freshLog();

		const logger = fileLogger(import.meta.url);

		// Silent by default: usable, but writes nothing until configured.
		assert.equal(logger.level, "silent");
		assert.doesNotThrow(() => logger.error("no configuration yet"));
	});

	test("children write through the configured logger with a module binding", async () => {
		const { configureLogging, fileLogger } = await freshLog();
		const { logger, lines } = capture();

		configureLogging(logger);
		fileLogger("file:///srv/app/src/services/ingestion.ts").info("ingested");

		assert.equal(lines.length, 1);
		assert.equal(lines[0]?.msg, "ingested");
		assert.equal(lines[0]?.module, "ingestion");
	});

	test("configureLogging throws once a module logger exists", async () => {
		const { configureLogging, fileLogger } = await freshLog();
		const { logger } = capture();

		fileLogger(import.meta.url);

		// The child already copied the silent root; a later swap would leave it
		// writing nowhere, so this must fail loudly at startup instead.
		assert.throws(
			() => configureLogging(logger),
			/configureLogging\(\) ran after a module logger was created/
		);
	});
});
