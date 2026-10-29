"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";
import {
	describeError,
	type PortalRequestError,
	readJson,
	sendJson
} from "@/lib/bff-client.ts";
import type { Category } from "@/lib/types.ts";

type CategoriesState =
	| { status: "loading" }
	| { status: "ready"; categories: Category[] }
	| { status: "failed"; error: PortalRequestError };

async function remapCategory(categoryId: number, toCategoryId: number) {
	await sendJson("PUT", `/bff/categories/${categoryId}/mapping`, {
		toCategoryId
	});
}

async function removeRemap(categoryId: number) {
	await sendJson("DELETE", `/bff/categories/${categoryId}/mapping`);
}

function buildTargetOptions(categories: Category[], source: Category) {
	const options: ReactNode[] = [];
	for (const category of categories) {
		if (category.categoryId === source.categoryId) continue;
		options.push(
			<option key={category.categoryId} value={category.categoryId}>
				{category.label}
			</option>
		);
	}
	return options;
}

type CategoryRowProps = {
	category: Category;
	categories: Category[];
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

function CategoryRow({
	category,
	categories,
	onChanged,
	onFailed
}: CategoryRowProps) {
	const [saving, setSaving] = useState(false);
	const selectId = `remap-${category.categoryId}`;

	return (
		<li className="category-row" aria-busy={saving}>
			<div className="category-name">
				<span className="category-label">{category.label}</span>
				<span className="muted small">
					{category.mappedTo ? (
						<>
							Shown as <strong>{category.mappedTo.label}</strong>
						</>
					) : (
						"Shown as itself"
					)}
				</span>
			</div>
			<label className="visually-hidden" htmlFor={selectId}>
				Show {category.label} as
			</label>
			<select
				id={selectId}
				value={category.mappedTo ? String(category.mappedTo.categoryId) : ""}
				disabled={saving}
				onChange={(event) => {
					setSaving(true);
					remapCategory(category.categoryId, Number(event.target.value))
						.then(onChanged, onFailed)
						.finally(() => setSaving(false));
				}}
			>
				<option value="" disabled>
					Show as another category
				</option>
				{buildTargetOptions(categories, category)}
			</select>
			{category.mappedTo ? (
				<button
					type="button"
					className="button button-quiet button-small"
					disabled={saving}
					onClick={() => {
						setSaving(true);
						removeRemap(category.categoryId)
							.then(onChanged, onFailed)
							.finally(() => setSaving(false));
					}}
				>
					Remove remap
				</button>
			) : (
				<span />
			)}
		</li>
	);
}

export function CategoriesView() {
	const [state, setState] = useState<CategoriesState>({ status: "loading" });
	const [reloadCount, setReloadCount] = useState(0);
	const [writeError, setWriteError] = useState<PortalRequestError | undefined>(
		undefined
	);

	// reloadCount is a dependency on purpose: a write bumps it to read the list again
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount triggers the reload
	useEffect(() => {
		const controller = new AbortController();
		readJson("/bff/categories", controller.signal).then(
			(body) =>
				setState({
					status: "ready",
					categories: (body as { categories: Category[] }).categories
				}),
			(error) => {
				if (!controller.signal.aborted)
					setState({ status: "failed", error: describeError(error) });
			}
		);
		return () => controller.abort();
	}, [reloadCount]);

	const rows: ReactNode[] = [];
	if (state.status === "ready") {
		for (const category of state.categories) {
			rows.push(
				<CategoryRow
					key={category.categoryId}
					category={category}
					categories={state.categories}
					onChanged={() => {
						setWriteError(undefined);
						setReloadCount((count) => count + 1);
					}}
					onFailed={(error) => setWriteError(describeError(error))}
				/>
			);
		}
	}

	return (
		<>
			<div className="page-heading">
				<h1>Categories</h1>
			</div>
			<p className="lead">
				Remap a category to see all of its transactions under another one,
				everywhere in the portal. The bank&rsquo;s own categorisation stays as
				it is, and you can remove a remap at any time.
			</p>
			{writeError ? <ErrorNotice error={writeError} /> : null}
			{state.status === "loading" ? (
				<p className="loading">Loading your categories…</p>
			) : null}
			{state.status === "failed" ? <ErrorNotice error={state.error} /> : null}
			{state.status === "ready" ? <ul className="categories">{rows}</ul> : null}
		</>
	);
}
