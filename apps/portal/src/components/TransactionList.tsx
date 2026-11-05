import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useRef,
	useState
} from "react";
import { BlockError } from "@/components/ErrorNotice.tsx";
import { SkeletonRows } from "@/components/Skeleton.tsx";
import { TransactionTable } from "@/components/TransactionTable.tsx";
import { readJson } from "@/lib/bff-client.ts";
import { formatCount } from "@/lib/money.ts";
import {
	buildClearAllHref,
	buildListQuery,
	buildOpenHref,
	buildToggleHref,
	hasFilters,
	hasFiltersBesideBucket,
	readOpenTransactionId
} from "@/lib/transaction-query.ts";
import type { Category, Transaction, TransactionPage } from "@/lib/types.ts";

// Which read failed under rows already on screen: a "Show more", or a re-read after a write
type FootFailure = "append" | "reload";

// The first read shows the skeleton, and its failure the block's error. Once pages have
// landed they stay on screen: a re-read after a write marks them busy, "Show more" marks them
// appending, and either failing keeps them beside an error in the foot.
type ListState =
	| { status: "loading" }
	| {
			status: "ready";
			pages: TransactionPage[];
			isAppending: boolean;
			isBusy: boolean;
			footFailure: FootFailure | undefined;
	  }
	| { status: "failed" };

const FOOT_FAILURE_SENTENCES: Record<FootFailure, string> = {
	append: "Couldn't load more transactions.",
	reload: "Couldn't refresh the transactions."
};

type TransactionListProps = {
	searchParams: URLSearchParams;
	now: Date;
	selectedBucket: string | undefined;
	selectedCategory: string | undefined;
	bucketLabel: string | undefined;
	categories: Category[];
	reloadCount: number;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

function buildPagePath(basePath: string, cursor: string | undefined) {
	if (cursor === undefined) return basePath;
	return `${basePath}&${new URLSearchParams({ cursor })}`;
}

function hasCursor(cursor: string | undefined): cursor is string {
	return cursor !== undefined && cursor !== "";
}

// Reads as many pages as are on screen, one after another, each through the cursor the one
// before it handed back. A cursor names a row, so after a write the old cursors may point
// past rows that moved; fresh ones keep the pages joined. Stops early when the list got
// shorter.
async function readShownPages(
	basePath: string,
	pageCount: number,
	signal: AbortSignal
) {
	const pages: TransactionPage[] = [];
	let cursor: string | undefined;
	for (let index = 0; index < pageCount; index += 1) {
		const page = (await readJson(
			buildPagePath(basePath, cursor),
			signal
		)) as TransactionPage;
		pages.push(page);
		if (!hasCursor(page.nextCursor)) break;
		cursor = page.nextCursor;
	}
	return pages;
}

// A new read starts: with pages to keep, show them busy; without any, show the skeleton. The
// read aborts any "Show more" in flight, so the list is no longer appending.
function markReadStarted(previous: ListState): ListState {
	if (previous.status !== "ready") return { status: "loading" };
	return {
		...previous,
		isAppending: false,
		isBusy: true,
		footFailure: undefined
	};
}

// A failed first read has nothing to keep; a failed re-read keeps the rows it was replacing
function markReadFailed(previous: ListState): ListState {
	if (previous.status !== "ready") return { status: "failed" };
	return { ...previous, isBusy: false, footFailure: "reload" };
}

function markAppendStarted(previous: ListState): ListState {
	if (previous.status !== "ready") return previous;
	return { ...previous, isAppending: true, footFailure: undefined };
}

function markAppendLanded(
	previous: ListState,
	page: TransactionPage
): ListState {
	if (previous.status !== "ready") return previous;
	return { ...previous, pages: [...previous.pages, page], isAppending: false };
}

function markAppendFailed(previous: ListState): ListState {
	if (previous.status !== "ready") return previous;
	return { ...previous, isAppending: false, footFailure: "append" };
}

// Retry from the foot runs again whichever read failed there
function createFootRetry(
	footFailure: FootFailure | undefined,
	showMore: () => void,
	setRetryCount: Dispatch<SetStateAction<number>>
) {
	return function retryFoot() {
		if (footFailure === "append") showMore();
		else setRetryCount((count) => count + 1);
	};
}

function createListRetry(setRetryCount: Dispatch<SetStateAction<number>>) {
	return function retryList() {
		setRetryCount((count) => count + 1);
	};
}

// "Show more" reads the page after the last one and adds it. Its read has its own
// AbortController, kept in a ref so a re-read or leaving the screen can abort it.
function createShowMoreHandler(
	basePath: string,
	cursor: string | undefined,
	appendControllerRef: RefObject<AbortController | undefined>,
	setState: Dispatch<SetStateAction<ListState>>
) {
	return function showMore() {
		if (!hasCursor(cursor)) return;
		const controller = new AbortController();
		appendControllerRef.current = controller;
		setState((previous) => markAppendStarted(previous));
		readJson(buildPagePath(basePath, cursor), controller.signal).then(
			(body) => {
				if (!controller.signal.aborted)
					setState((previous) =>
						markAppendLanded(previous, body as TransactionPage)
					);
			},
			() => {
				if (!controller.signal.aborted)
					setState((previous) => markAppendFailed(previous));
			}
		);
	};
}

// Opening a row's detail replaces the URL without a scroll; the open row's toggle closes it
function createDetailToggler(
	router: ReturnType<typeof useRouter>,
	searchParams: URLSearchParams,
	openTransactionId: string | undefined
) {
	return function toggleDetail(transactionId: string) {
		const nextOpenId =
			transactionId === openTransactionId ? undefined : transactionId;
		router.replace(buildOpenHref(searchParams, nextOpenId), { scroll: false });
	};
}

function listTransactions(pages: TransactionPage[]) {
	const transactions: Transaction[] = [];
	for (const page of pages) {
		for (const transaction of page.transactions) {
			transactions.push(transaction);
		}
	}
	return transactions;
}

function findCategory(categories: Category[], slug: string | undefined) {
	for (const category of categories) {
		if (category.category === slug) return category;
	}
	return undefined;
}

// No rows. A category remapped to another has none of its own any more, so the note points
// at the category its transactions now show under. A bucket picked on its own is a bar of
// the chart, not a filter to clear, so the note names it. Otherwise the filters matched
// nothing.
function EmptyList({
	searchParams,
	selectedCategory,
	bucketLabel,
	categories
}: {
	searchParams: URLSearchParams;
	selectedCategory: string | undefined;
	bucketLabel: string | undefined;
	categories: Category[];
}) {
	const category = findCategory(categories, selectedCategory);
	const target = category?.mappedTo;
	if (category !== undefined && target !== undefined) {
		return (
			<div className="empty">
				<p>
					Transactions the bank put in {category.label} show under{" "}
					{target.label}.
				</p>
				<Link
					href={buildToggleHref(searchParams, "category", target.category)}
					replace
					scroll={false}
				>
					Show {target.label}
				</Link>
			</div>
		);
	}
	if (bucketLabel !== undefined && !hasFiltersBesideBucket(searchParams)) {
		return (
			<div className="empty">
				<p>No transactions in {bucketLabel}.</p>
			</div>
		);
	}
	return (
		<div className="empty">
			<p>
				{hasFilters(searchParams)
					? "No transactions match these filters."
					: "No transactions in this period."}
			</p>
			{hasFilters(searchParams) ? (
				<Link href={buildClearAllHref(searchParams)} replace scroll={false}>
					Clear the filters
				</Link>
			) : null}
		</div>
	);
}

// The count of rows on screen, and "Show more" while the API has a page after the last.
// The API returns no total, so the foot counts only what is shown. "Show more" re-renders in
// place and is only marked aria-disabled while it reads, so it keeps focus; once the last page
// is in and it goes, focus moves to the count rather than falling back to the page.
function ListFoot({
	rowCount,
	isMoreAvailable,
	isAppending,
	isBusy,
	footFailure,
	onShowMore,
	onRetry
}: {
	rowCount: number;
	isMoreAvailable: boolean;
	isAppending: boolean;
	isBusy: boolean;
	footFailure: FootFailure | undefined;
	onShowMore: () => void;
	onRetry: () => void;
}) {
	const countRef = useRef<HTMLParagraphElement>(null);
	const wasMoreAvailableRef = useRef(isMoreAvailable);
	// Off while a re-read runs too: an append landing on replaced pages would double a page
	const isShowMoreOff = isAppending || isBusy;

	useEffect(() => {
		const isButtonGone = wasMoreAvailableRef.current && !isMoreAvailable;
		if (isButtonGone && document.activeElement === document.body)
			countRef.current?.focus();
		wasMoreAvailableRef.current = isMoreAvailable;
	}, [isMoreAvailable]);

	return (
		<div className="list-foot">
			{footFailure === undefined ? null : (
				<BlockError
					sentence={FOOT_FAILURE_SENTENCES[footFailure]}
					onRetry={onRetry}
				/>
			)}
			<div className="list-foot-row">
				<p ref={countRef} className="list-count" tabIndex={-1}>
					{isMoreAvailable
						? `${formatCount(rowCount)} shown`
						: `All ${formatCount(rowCount)} shown`}
				</p>
				{isMoreAvailable ? (
					<button
						type="button"
						className="button show-more"
						aria-disabled={isShowMoreOff}
						onClick={isShowMoreOff ? undefined : onShowMore}
					>
						{isAppending ? "Loading…" : "Show more"}
					</button>
				) : null}
			</div>
		</div>
	);
}

// The list's rows and foot. The screen keys it on the list's query, so a new filter or
// selection starts again from the skeleton, while opening a row or changing the bucket size
// reads nothing. A write bumps reloadCount: the pages on screen are read again, staying
// visible and busy until the new ones land.
export function TransactionList(props: TransactionListProps) {
	const router = useRouter();
	const [state, setState] = useState<ListState>({ status: "loading" });
	const [retryCount, setRetryCount] = useState(0);
	const appendControllerRef = useRef<AbortController | undefined>(undefined);
	// How many pages to read again; a ref so a re-read does not depend on the state it sets
	const pageCountRef = useRef(1);

	const basePath = `/bff/transactions?${buildListQuery(props.searchParams, props.now, props.selectedBucket)}`;
	const openTransactionId = readOpenTransactionId(props.searchParams);

	const shownPageCount = state.status === "ready" ? state.pages.length : 0;

	// The next re-read reads as many pages as are on screen now
	useEffect(() => {
		if (shownPageCount > 0) pageCountRef.current = shownPageCount;
	}, [shownPageCount]);

	// reloadCount and retryCount are dependencies on purpose: bumping either reads again
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount and retryCount trigger the read
	useEffect(() => {
		const controller = new AbortController();
		setState((previous) => markReadStarted(previous));
		readShownPages(basePath, pageCountRef.current, controller.signal).then(
			(pages) => {
				if (!controller.signal.aborted)
					setState({
						status: "ready",
						pages,
						isAppending: false,
						isBusy: false,
						footFailure: undefined
					});
			},
			() => {
				if (!controller.signal.aborted)
					setState((previous) => markReadFailed(previous));
			}
		);
		// A re-read replaces every page, so a "Show more" still in flight is dropped too
		return () => {
			controller.abort();
			appendControllerRef.current?.abort();
		};
	}, [basePath, props.reloadCount, retryCount]);

	const retryList = createListRetry(setRetryCount);

	if (state.status === "failed") {
		return (
			<div className="ledger">
				<BlockError
					sentence="Couldn't load the transactions."
					onRetry={retryList}
				/>
			</div>
		);
	}

	if (state.status === "loading") {
		return (
			<div className="ledger">
				<SkeletonRows rows={10} />
			</div>
		);
	}

	const transactions = listTransactions(state.pages);
	const lastPage = state.pages[state.pages.length - 1];
	const nextCursor = lastPage?.nextCursor;
	const isMoreAvailable = hasCursor(nextCursor);
	const showMore = createShowMoreHandler(
		basePath,
		nextCursor,
		appendControllerRef,
		setState
	);
	const toggleDetail = createDetailToggler(
		router,
		props.searchParams,
		openTransactionId
	);
	const retryFoot = createFootRetry(state.footFailure, showMore, setRetryCount);

	if (transactions.length === 0 && !isMoreAvailable) {
		return (
			<div className="ledger" aria-busy={state.isBusy}>
				{state.footFailure === undefined ? null : (
					<BlockError
						sentence={FOOT_FAILURE_SENTENCES[state.footFailure]}
						onRetry={retryList}
					/>
				)}
				<EmptyList
					searchParams={props.searchParams}
					selectedCategory={props.selectedCategory}
					bucketLabel={props.bucketLabel}
					categories={props.categories}
				/>
			</div>
		);
	}

	return (
		<div className="ledger" aria-busy={state.isBusy}>
			<TransactionTable
				transactions={transactions}
				categories={props.categories}
				openTransactionId={openTransactionId}
				onToggleDetail={toggleDetail}
				onChanged={props.onChanged}
				onFailed={props.onFailed}
			/>
			<ListFoot
				rowCount={transactions.length}
				isMoreAvailable={isMoreAvailable}
				isAppending={state.isAppending}
				isBusy={state.isBusy}
				footFailure={state.footFailure}
				onShowMore={showMore}
				onRetry={retryFoot}
			/>
		</div>
	);
}
