import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { loadConfig } from "@/bff/config.ts";
import { readCursor } from "@/bff/paging.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { buildApiQuery } from "@/bff/query.ts";
import { requireCustomer } from "@/bff/session.ts";
import type { ApiTransactionPage, TransactionPage } from "@/lib/types.ts";

const LIST_PARAMETERS = [
	"fromDateTime",
	"toDateTime",
	"transactionType",
	"category",
	"creditDebitIndicator",
	"sort",
	"limit",
	"cursor"
];

// One page of the customer's transactions. The API's next/prev links become cursors the
// browser sends back as `cursor`.
export async function GET(request: Request) {
	try {
		const config = loadConfig();
		const customer = await requireCustomer(config);
		const query = buildApiQuery(
			new URL(request.url).searchParams,
			LIST_PARAMETERS
		);
		const page = (await callApi(config, {
			method: "GET",
			path: buildCustomerPath(customer.customerId, "/transactions"),
			query
		})) as ApiTransactionPage;
		const body: TransactionPage = {
			transactions: page.data,
			meta: page.meta,
			nextCursor: readCursor(page.links.next),
			previousCursor: readCursor(page.links.prev)
		};
		return Response.json(body);
	} catch (error) {
		return respondWithProblem(error);
	}
}
