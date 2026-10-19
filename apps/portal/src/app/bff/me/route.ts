import { loadConfig } from "@/bff/config.ts";
import { problemResponse } from "@/bff/problems.ts";
import { requireCustomer } from "@/bff/session.ts";

export async function GET() {
	try {
		const config = loadConfig();
		const customer = await requireCustomer(config);
		return Response.json(customer);
	} catch (error) {
		return problemResponse(error);
	}
}
