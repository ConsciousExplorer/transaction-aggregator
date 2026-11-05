import type { Metadata } from "next";
import { Suspense } from "react";
import {
	DashboardScreen,
	DashboardSkeleton
} from "@/components/DashboardScreen.tsx";

export const metadata: Metadata = { title: "Spending" };

// The screen reads its period and selections from the URL, which needs a Suspense boundary;
// until it can read the URL, the page shows the title row and every block's skeleton at the
// default period
export default function OverviewPage() {
	return (
		<Suspense fallback={<DashboardSkeleton />}>
			<DashboardScreen />
		</Suspense>
	);
}
