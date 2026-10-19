import { z } from "zod";
import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { loadConfig } from "@/bff/config.ts";
import { rejectForeignOrigin } from "@/bff/origin.ts";
import { problemResponse } from "@/bff/problems.ts";
import { readRequestBody } from "@/bff/request-body.ts";
import { requireCustomer } from "@/bff/session.ts";

type TransactionRouteContext = { params: Promise<{ transactionId: string }> };

const recategoriseSchema = z.object({ categoryId: z.number().int() });

function buildOverridePath(customerId: string, transactionId: string) {
	return buildCustomerPath(customerId, `/transaction-overrides/${encodeURIComponent(transactionId)}`);
}

// Shows one transaction under another category, for this customer only
export async function PUT(request: Request, context: TransactionRouteContext) {
	try {
		const config = loadConfig();
		rejectForeignOrigin(request, config);
		const customer = await requireCustomer(config);
		const { transactionId } = await context.params;
		const body = await readRequestBody(request, recategoriseSchema);
		const override = await callApi(config, {
			method: "PUT",
			path: buildOverridePath(customer.customerId, transactionId),
			body: { categoryId: body.categoryId }
		});
		return Response.json(override);
	} catch (error) {
		return problemResponse(error);
	}
}

// Back to the system's category
export async function DELETE(request: Request, context: TransactionRouteContext) {
	try {
		const config = loadConfig();
		rejectForeignOrigin(request, config);
		const customer = await requireCustomer(config);
		const { transactionId } = await context.params;
		await callApi(config, { method: "DELETE", path: buildOverridePath(customer.customerId, transactionId) });
		return new Response(null, { status: 204 });
	} catch (error) {
		return problemResponse(error);
	}
}
