import { z } from "zod";
import { buildCustomerPath, callApi } from "@/bff/api-client.ts";
import { loadConfig } from "@/bff/config.ts";
import { rejectForeignOrigin } from "@/bff/origin.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { readRequestBody } from "@/bff/request-body.ts";
import { requireCustomer } from "@/bff/session.ts";

type CategoryRouteContext = { params: Promise<{ categoryId: string }> };

const remapSchema = z.object({ toCategoryId: z.number().int() });

function buildMappingPath(customerId: string, categoryId: string) {
	return buildCustomerPath(
		customerId,
		`/category-overrides/${encodeURIComponent(categoryId)}`
	);
}

// Shows every transaction in one category under another, for this customer only
export async function PUT(request: Request, context: CategoryRouteContext) {
	try {
		const config = loadConfig();
		rejectForeignOrigin(request, config);
		const customer = await requireCustomer(config);
		const { categoryId } = await context.params;
		const body = await readRequestBody(request, remapSchema);
		const category = await callApi(config, {
			method: "PUT",
			path: buildMappingPath(customer.customerId, categoryId),
			body: { toCategoryId: body.toCategoryId }
		});
		return Response.json(category);
	} catch (error) {
		return respondWithProblem(error);
	}
}

// Removes the remap
export async function DELETE(request: Request, context: CategoryRouteContext) {
	try {
		const config = loadConfig();
		rejectForeignOrigin(request, config);
		const customer = await requireCustomer(config);
		const { categoryId } = await context.params;
		await callApi(config, {
			method: "DELETE",
			path: buildMappingPath(customer.customerId, categoryId)
		});
		return new Response(null, { status: 204 });
	} catch (error) {
		return respondWithProblem(error);
	}
}
