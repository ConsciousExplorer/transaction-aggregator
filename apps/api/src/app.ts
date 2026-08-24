import { baseLogger, config } from "./runtime.ts";
import { buildServer } from "./server.ts";

console.log("Reached the main app. Now run");

console.log(config);

const server = await buildServer({
	config: config,
	logger: baseLogger
});

server.listen({ port: config.app.port });
