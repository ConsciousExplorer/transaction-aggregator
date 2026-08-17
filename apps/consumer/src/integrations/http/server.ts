import http, { type Server } from "node:http";
import os from "node:os";

export async function createServer(options?: {
	appName?: string;
	description?: string;
}): Promise<Server> {
	return http.createServer((req, res) => {
		if (req.method === "GET" && ["/alive", "/alivez"].includes(req.url ?? "")) {
			return res.end("ok");
		}

		if (
			req.method === "GET" &&
			["/health", "/healthz"].includes(req.url ?? "")
		) {
			res.setHeader("Content-Type", "application/json");
			return res.end(JSON.stringify({ status: "ok" }));
		}

		// Donlt register a ready endpoint. We are not serving traffic

		if (req.method === "GET" && req.url === "/info") {
			res.setHeader("Content-Type", "application/json");
			return res.end(
				JSON.stringify({
					application: options?.appName || "Kafka Consumer",
					description:
						options?.description || "Kafka Consumer App for transactions",
					node: process.version,
					platform: process.platform,
					arch: process.arch,

					hostname: os.hostname(),
					pid: process.pid,

					uptime: Math.floor(process.uptime()),
					startedAt: new Date(
						Date.now() - process.uptime() * 1000
					).toISOString()
				})
			);
		}

		res.statusCode = 404;
		res.end();
	});
}
