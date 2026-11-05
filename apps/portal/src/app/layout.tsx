import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { readThemeChoice, THEME_COOKIE } from "@/lib/theme.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/shell.css";
import "./styles/dashboard.css";
import "./styles/transactions.css";

// Self-hosted at build time by next/font: no request to Google from the browser.
// It sets --font-sans on <html>, which base.css reads.
// Manrope has tabular figures, so amounts line up in columns the way a statement's do.
// The four weights are the ones the stylesheets set: 400 body, 500 labels, 600 headings,
// 700 money.
const manrope = Manrope({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	variable: "--font-sans",
	display: "swap"
});

export const metadata: Metadata = {
	title: {
		default: "Transaction portal (demo)",
		template: "%s | Transaction portal (demo)"
	},
	description: "A demo banking portal that showcases the transaction API"
};

// The customer's day or night choice is read here, so the first paint is already in that mode
// with no script to flash past. No choice means no attribute, and the system's mode decides.
export default async function RootLayout({
	children
}: {
	children: ReactNode;
}) {
	const cookieStore = await cookies();
	const theme = readThemeChoice(cookieStore.get(THEME_COOKIE)?.value);
	return (
		<html lang="en-ZA" className={manrope.variable} data-theme={theme}>
			<body>{children}</body>
		</html>
	);
}
