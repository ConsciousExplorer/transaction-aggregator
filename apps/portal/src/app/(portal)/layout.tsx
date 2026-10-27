import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { loadConfig } from "@/bff/config.ts";
import { readCustomer } from "@/bff/session.ts";
import { NavLinks } from "@/components/NavLinks.tsx";

// Every signed-in page shares this shell. No session, no shell: back to sign-in.
export default async function PortalLayout({
	children
}: {
	children: ReactNode;
}) {
	// Rendered per request, never prerendered at build: it reads the session, and the build
	// has no runtime environment for loadConfig
	await connection();
	const customer = await readCustomer(loadConfig());
	if (customer === undefined) redirect("/");

	return (
		<>
			<header className="site-header">
				<div className="header-inner">
					<Link href="/overview" className="brand">
						Transaction portal <span className="demo-pill">Demo</span>
					</Link>
					<NavLinks />
					<div className="account">
						<span className="account-name">{customer.displayName}</span>
						<form action="/bff/auth/logout" method="post">
							<button type="submit" className="button button-quiet">
								Sign out
							</button>
						</form>
					</div>
				</div>
			</header>
			<main className="page">{children}</main>
		</>
	);
}
