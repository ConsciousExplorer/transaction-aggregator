import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useEffect,
	useState
} from "react";
import { BlockError } from "@/components/ErrorNotice.tsx";
import { readJson } from "@/lib/bff-client.ts";
import { formatTransactionDateTime } from "@/lib/dates.ts";
import {
	buildFundingSourceFields,
	buildReferenceFields,
	type DetailField
} from "@/lib/detail.ts";
import { STATUS_LABELS } from "@/lib/labels.ts";
import { formatSignedMoney } from "@/lib/money.ts";
import type { TransactionDetail as TransactionDetailBody } from "@/lib/types.ts";

type DetailState =
	| { status: "loading" }
	| { status: "ready"; detail: TransactionDetailBody }
	| { status: "failed" };

// The long description earns a place only when it says more than the row already does
function hasDistinctLongDescription(detail: TransactionDetailBody) {
	return (
		detail.longDescription !== null &&
		detail.longDescription !== detail.shortDescription
	);
}

// The facts read as label over value
function buildFactElements(fields: DetailField[]) {
	const elements: ReactNode[] = [];
	for (const field of fields) {
		elements.push(
			<div key={field.label}>
				<dt>{field.label}</dt>
				<dd>{field.value}</dd>
			</div>
		);
	}
	return elements;
}

// Ids are set in code style, so they read as values to copy rather than as words
function buildReferenceElements(fields: DetailField[]) {
	const elements: ReactNode[] = [];
	for (const field of fields) {
		elements.push(
			<div key={field.label}>
				<dt>{field.label}</dt>
				<dd>
					<code>{field.value}</code>
				</dd>
			</div>
		);
	}
	return elements;
}

// A line for the summary, then four for the facts, in the inset the detail will fill
function DetailSkeleton() {
	return (
		<div
			className="inset detail skeleton-detail"
			role="status"
			aria-busy="true"
			aria-label="Loading"
		>
			<span className="skeleton-line skeleton-line-medium" />
			<div className="detail-facts">
				<span className="skeleton-line" />
				<span className="skeleton-line" />
				<span className="skeleton-line" />
				<span className="skeleton-line" />
			</div>
		</div>
	);
}

function createDetailRetry(setRetryCount: Dispatch<SetStateAction<number>>) {
	return function retryDetail() {
		setRetryCount((count) => count + 1);
	};
}

function DetailContent({ detail }: { detail: TransactionDetailBody }) {
	const isCredit = detail.creditDebitIndicator === "credit";
	return (
		<div className="inset detail">
			<div className="detail-summary">
				{hasDistinctLongDescription(detail) ? (
					<span className="detail-description">{detail.longDescription}</span>
				) : null}
				<span className="muted small">
					{formatTransactionDateTime(detail.occurredAt)}
				</span>
				<span className="muted small">{STATUS_LABELS[detail.status]}</span>
				<span className={isCredit ? "amount amount-in" : "amount"}>
					{formatSignedMoney(detail.amount, detail.creditDebitIndicator)}
				</span>
			</div>
			<dl className="detail-facts">
				{buildFactElements(buildFundingSourceFields(detail.fundingSource))}
			</dl>
			<dl className="detail-references">
				{buildReferenceElements(buildReferenceFields(detail))}
			</dl>
		</div>
	);
}

// The open row's detail, read when the row opens. It has its own loading and failed
// states, so a detail that cannot be read leaves the rest of the table as it is.
export function TransactionDetail({
	transactionId
}: {
	transactionId: string;
}) {
	const [state, setState] = useState<DetailState>({ status: "loading" });
	const [retryCount, setRetryCount] = useState(0);

	// retryCount is a dependency on purpose: bumping it reads again
	// biome-ignore lint/correctness/useExhaustiveDependencies: retryCount triggers the read
	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		readJson(
			`/bff/transactions/${encodeURIComponent(transactionId)}`,
			controller.signal
		).then(
			(body) => {
				if (!controller.signal.aborted)
					setState({ status: "ready", detail: body as TransactionDetailBody });
			},
			() => {
				if (!controller.signal.aborted) setState({ status: "failed" });
			}
		);
		return () => controller.abort();
	}, [transactionId, retryCount]);

	const retryDetail = createDetailRetry(setRetryCount);

	if (state.status === "loading") return <DetailSkeleton />;
	if (state.status === "failed") {
		return (
			<div className="inset detail">
				<BlockError
					sentence="Couldn't load this transaction's detail."
					onRetry={retryDetail}
				/>
			</div>
		);
	}
	return <DetailContent detail={state.detail} />;
}
