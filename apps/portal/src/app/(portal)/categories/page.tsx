import type { Metadata } from "next";
import { CategoriesView } from "@/components/CategoriesView.tsx";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
	return <CategoriesView />;
}
