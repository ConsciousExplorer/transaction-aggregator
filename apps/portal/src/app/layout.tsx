import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google from the browser.
// Manrope has tabular figures, so amounts line up in columns the way a statement's do.
const manrope = Manrope({
	subsets: ["latin"],
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

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en-ZA" className={manrope.variable}>
			<body>{children}</body>
		</html>
	);
}
