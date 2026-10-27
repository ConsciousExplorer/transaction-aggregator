"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV_ITEMS = [
	{ href: "/overview", label: "Overview" },
	{ href: "/transactions", label: "Transactions" },
	{ href: "/categories", label: "Categories" }
];

export function NavLinks() {
	const pathname = usePathname();
	const links: ReactNode[] = [];
	for (const item of NAV_ITEMS) {
		links.push(
			<Link
				key={item.href}
				href={item.href}
				className="nav-link"
				aria-current={pathname === item.href ? "page" : undefined}
			>
				{item.label}
			</Link>
		);
	}
	return (
		<nav className="nav" aria-label="Portal">
			{links}
		</nav>
	);
}
