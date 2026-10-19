import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "Portal (demo)",
	description: "A demo banking portal that showcases the transaction API"
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en-ZA">
			<body>{children}</body>
		</html>
	);
}
