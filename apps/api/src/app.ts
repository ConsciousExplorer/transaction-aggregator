import { join } from "node:path";
import { baseLogger, config } from "./runtime.ts";
import { buildServer } from "./server.ts";

console.log("Reached the main app. Now run");

console.log(config);

const server = await buildServer({
	serverOptions: {},
	dependencies: {
		config: config,
		logger: baseLogger,
		autoLoadParameters: {
			dir: join(import.meta.dirname, "routes"),
			dirNameRoutePrefix: false,
			matchFilter: /route\.(ts|js)$/
		}
	}
});

server.listen({ port: config.app.port });
