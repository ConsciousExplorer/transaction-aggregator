import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { type BffConfig, loadConfig } from "@/bff/config.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { buildApiQuery } from "@/bff/query.ts";
import { requireCustomer } from "@/bff/session.ts";
import { buildTypeRows, TRANSACTION_TYPES } from "@/lib/type-summary.ts";
import type { Summary, TransactionType } from "@/lib/types.ts";

// No transactionType: every read sets its own
const BY_TYPE_PARAMETERS = [
	"fromDateTime",
	"toDateTime",
	"category",
	"creditDebitIndicator",
	"amountMin",
	"amountMax"
];

// One type's summary over the shared query, carried with the type it was read for
async function readTypeSummary(
	config: BffConfig,
	customerId: string,
	query: URLSearchParams,
	transactionType: TransactionType
) {
	const typeQuery = new URLSearchParams(query);
	typeQuery.set("transactionType", transactionType);
	const body = (await callApi(config, {
		method: "GET",
		path: buildCustomerPath(customerId, "/summary"),
		query: typeQuery
	})) as Summary;
	return { transactionType, body };
}

// The window's totals for each transaction type, for the spending card's Type tab: one summary
// read per type, all four at once, answered as one row per type in TRANSACTION_TYPES order
export async function GET(request: Request) {
	try {
		const config = loadConfig();
		const customer = await requireCustomer(config);
		const query = buildApiQuery(
			new URL(request.url).searchParams,
			BY_TYPE_PARAMETERS
		);
		const pendingReads = [];
		for (const transactionType of TRANSACTION_TYPES) {
			pendingReads.push(
				readTypeSummary(config, customer.customerId, query, transactionType)
			);
		}
		const typeSummaries = await Promise.all(pendingReads);
		return Response.json({ data: buildTypeRows(typeSummaries) });
	} catch (error) {
		return respondWithProblem(error);
	}
}
