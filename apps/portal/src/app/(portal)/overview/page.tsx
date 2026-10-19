import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewView } from "@/components/OverviewView.tsx";

export const metadata: Metadata = { title: "Overview" };

// OverviewView reads the period from the URL, which needs a Suspense boundary
export default function OverviewPage() {
	return (
		<Suspense fallback={<p className="loading">Loading your overview…</p>}>
			<OverviewView />
		</Suspense>
	);
}
