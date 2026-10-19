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
