import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { loadConfig } from "@/bff/config.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { requireCustomer } from "@/bff/session.ts";
import type { ApiCategoryList } from "@/lib/types.ts";

// Every category, each with the customer's remap if they set one
export async function GET() {
	try {
		const config = loadConfig();
		const customer = await requireCustomer(config);
		const list = (await callApi(config, {
			method: "GET",
			path: buildCustomerPath(customer.customerId, "/categories")
		})) as ApiCategoryList;
		return Response.json({ categories: list.data });
	} catch (error) {
		return respondWithProblem(error);
	}
}
