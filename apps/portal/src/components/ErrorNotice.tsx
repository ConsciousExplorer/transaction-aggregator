import type { ReactNode } from "react";
import type { PortalRequestError } from "@/lib/bff-client.ts";

// The trace id is the same one the BFF sent the API, so it finds the request in the API's
// logs and in Tempo
export function ErrorNotice({
	error,
	children
}: {
	error: PortalRequestError;
	children?: ReactNode;
}) {
	return (
		<div className="notice notice-error" role="alert">
			<p className="notice-title">{error.message}</p>
			{error.detail ? <p>{error.detail}</p> : null}
			{error.traceId ? (
				<p className="notice-reference">
					Reference <code>{error.traceId}</code>, the trace id in the
					API&rsquo;s logs
				</p>
			) : null}
			{children}
		</div>
	);
}

// A block's failed read, inside the block: one sentence saying what failed and a Retry text
// button. The negative colour is only on the small mark before the sentence, so a failed
// block never turns into a banner. The write notice above keeps the full ErrorNotice.
export function BlockError({
	sentence,
	onRetry
}: {
	sentence: string;
	onRetry?: () => void;
}) {
	return (
		<div className="block-error" role="alert">
			<span className="block-error-mark" aria-hidden="true" />
			<p>{sentence}</p>
			{onRetry === undefined ? null : (
				<button type="button" className="button button-text" onClick={onRetry}>
					Retry
				</button>
			)}
		</div>
	);
}
