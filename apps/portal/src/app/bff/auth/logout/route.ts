import { NextResponse } from "next/server";
import { loadConfig } from "@/bff/config.ts";
import { buildLogoutUrl } from "@/bff/keycloak.ts";
import { rejectForeignOrigin } from "@/bff/origin.ts";
import { respondWithProblem } from "@/bff/problems.ts";
import { openSession } from "@/bff/session.ts";

// A POST, so another site can't sign a customer out with a link. 303 turns it into a GET.
export async function POST(request: Request) {
	const config = loadConfig();
	try {
		rejectForeignOrigin(request, config);
	} catch (error) {
		return respondWithProblem(error);
	}
	const session = await openSession(config);
	const idToken = session.idToken;
	session.destroy();
	if (idToken === undefined)
		return NextResponse.redirect(new URL("/", config.publicBaseUrl), 303);
	return NextResponse.redirect(buildLogoutUrl(config, idToken, "/"), 303);
}
