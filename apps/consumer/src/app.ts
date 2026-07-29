/**
 * App main entrypoint
 *
 *
 */

export async function startupCheck<T>(
	name: string,
	action: () => Promise<T>,
): Promise<T> {
	const start = performance.now();

	try {
		const result = await action();

		console.log(`✓ ${name} (${Math.round(performance.now() - start)}ms)`);

		return result;
	} catch (err) {
		console.log({ err }, `✗ ${name}`);
		process.exit(1);
	}
}

await startupCheck(
	"test",
	() => new Promise((resolve) => setTimeout(resolve, 2000)),
);
