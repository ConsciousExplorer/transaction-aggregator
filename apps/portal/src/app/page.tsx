import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { loadConfig } from "@/bff/config.ts";
import { readCustomer } from "@/bff/session.ts";

// What each ?error= from the BFF's auth routes means to the person reading it
const SIGN_IN_MESSAGES: Record<string, string> = {
	"login-expired": "That sign-in expired or was already used. Sign in again.",
	"login-failed":
		"Sign-in didn't complete. Try again; if it keeps failing, check the portal's logs.",
	"not-a-customer":
		"That account has no banking profile. Sign in as one of the demo customers below.",
	"session-expired": "Your session expired. Sign in again to continue."
};

const DEMO_CUSTOMERS = [
	{ username: "john.doe", name: "John Doe" },
	{ username: "jane.doe", name: "Jane Doe" },
	{ username: "richard.roe", name: "Richard Roe" }
];

type SignInPageProps = { searchParams: Promise<{ error?: string }> };

export default async function SignInPage({ searchParams }: SignInPageProps) {
	// Rendered per request, never prerendered at build: it reads the session, and the build
	// has no runtime environment for loadConfig
	await connection();
	const customer = await readCustomer(loadConfig());
	if (customer !== undefined) redirect("/overview");

	const { error } = await searchParams;
	const message = error === undefined ? undefined : SIGN_IN_MESSAGES[error];
	const rows: ReactNode[] = [];
	for (const demoCustomer of DEMO_CUSTOMERS) {
		rows.push(
			<tr key={demoCustomer.username}>
				<td>{demoCustomer.name}</td>
				<td>
					<code>{demoCustomer.username}</code>
				</td>
			</tr>
		);
	}

	return (
		<main className="sign-in">
			<div className="sign-in-card">
				<p className="brand">
					Transaction portal <span className="demo-pill">Demo</span>
				</p>
				<h1>Sign in to see your money</h1>
				<p className="lead">
					This portal exists to show the transaction API at work. You sign in
					through Keycloak; the portal&rsquo;s server then calls the API on your
					behalf, so your browser never holds a token the API accepts.
				</p>
				{message ? (
					<div className="notice notice-error" role="alert">
						<p className="notice-title">{message}</p>
					</div>
				) : null}
				<a className="button button-primary button-wide" href="/bff/auth/login">
					Sign in with Keycloak
				</a>
				<table className="demo-logins">
					<caption>
						Demo customers. The password for each is{" "}
						<code>portal-password</code>.
					</caption>
					<thead>
						<tr>
							<th scope="col">Customer</th>
							<th scope="col">Username</th>
						</tr>
					</thead>
					<tbody>{rows}</tbody>
				</table>
			</div>
		</main>
	);
}
