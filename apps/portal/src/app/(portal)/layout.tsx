import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { loadConfig } from "@/bff/config.ts";
import { readCustomer } from "@/bff/session.ts";
import { TopBar } from "@/components/TopBar.tsx";

// Every signed-in page shares this shell: the top bar, then the page. No session, no
// shell: back to sign-in.
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
			<TopBar customerName={customer.displayName} />
			<main className="page">{children}</main>
		</>
	);
}
