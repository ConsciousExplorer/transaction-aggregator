import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { loadConfig } from "@/bff/config.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { requireCustomer } from "@/bff/session.ts";
import type { TransactionDetail } from "@/lib/types.ts";

interface TransactionRouteContext {
	params: Promise<{ transactionId: string }>;
}

// One of the customer's transactions with its merchant, beneficiary, mandate or transfer fields
export async function GET(_request: Request, context: TransactionRouteContext) {
	try {
		const config = loadConfig();
		const customer = await requireCustomer(config);
		const { transactionId } = await context.params;
		const detail = (await callApi(config, {
			method: "GET",
			path: buildCustomerPath(
				customer.customerId,
				`/transactions/${encodeURIComponent(transactionId)}`
			)
		})) as TransactionDetail;
		return Response.json(detail);
	} catch (error) {
		return respondWithProblem(error);
	}
}
