import type { Metadata } from "next";
import { Suspense } from "react";
import { TransactionsView } from "@/components/TransactionsView.tsx";

export const metadata: Metadata = { title: "Transactions" };

// TransactionsView keeps its filters and page in the URL, which needs a Suspense boundary
export default function TransactionsPage() {
	return (
		<Suspense fallback={<p className="loading">Loading your transactions…</p>}>
			<TransactionsView />
		</Suspense>
	);
}
