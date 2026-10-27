import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { loadConfig } from "@/bff/config.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { buildApiQuery } from "@/bff/query.ts";
import { requireCustomer } from "@/bff/session.ts";
import type { Summary } from "@/lib/types.ts";

const SUMMARY_PARAMETERS = ["fromDateTime", "toDateTime", "interval"];

// Totals by category for the window, or by category and month with interval=month
export async function GET(request: Request) {
	try {
		const config = loadConfig();
		const customer = await requireCustomer(config);
		const query = buildApiQuery(
			new URL(request.url).searchParams,
			SUMMARY_PARAMETERS
		);
		const summary = (await callApi(config, {
			method: "GET",
			path: buildCustomerPath(customer.customerId, "/summary"),
			query
		})) as Summary;
		return Response.json({ data: summary.data, totals: summary.totals });
	} catch (error) {
		return respondWithProblem(error);
	}
}
