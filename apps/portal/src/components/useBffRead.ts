import { useCallback, useEffect, useState } from "react";
import {
	describeError,
	type PortalRequestError,
	readJson
} from "@/lib/bff-client.ts";

// A read before its first body is loading. Once a body has landed it stays on screen: a new
// read marks it busy (the block dims) rather than swapping it for a skeleton, and a failed
// read keeps it beside the error.
export type ReadState<Body> =
	| { status: "loading"; body: undefined }
	| { status: "ready"; body: Body; isBusy: boolean }
	| {
			status: "failed";
			body: Body | undefined;
			error: PortalRequestError;
			isBusy: false;
	  };

// A new read starts: with a body to keep, show it busy; without one, show the skeleton
function markReadStarted<Body>(previous: ReadState<Body>): ReadState<Body> {
	if (previous.body === undefined)
		return { status: "loading", body: undefined };
	return { status: "ready", body: previous.body, isBusy: true };
}

function markReadFailed<Body>(
	previous: ReadState<Body>,
	error: unknown
): ReadState<Body> {
	return {
		status: "failed",
		body: previous.body,
		error: describeError(error),
		isBusy: false
	};
}

// One read through the BFF, run again whenever the path changes, the screen bumps
// reloadCount after a write, or retry is called. Each read has its own AbortController and is
// aborted when the next one starts or the block unmounts, so a slow answer to an old path
// never lands over a newer one. An undefined path means there is nothing to read yet.
export function useBffRead<Body>(
	path: string | undefined,
	reloadCount: number
) {
	const [state, setState] = useState<ReadState<Body>>({
		status: "loading",
		body: undefined
	});
	const [retryCount, setRetryCount] = useState(0);

	// reloadCount and retryCount are dependencies on purpose: bumping either reads again
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount and retryCount trigger the read
	useEffect(() => {
		if (path === undefined) return;
		const controller = new AbortController();
		setState((previous) => markReadStarted(previous));
		readJson(path, controller.signal).then(
			(body) => {
				if (!controller.signal.aborted)
					setState({ status: "ready", body: body as Body, isBusy: false });
			},
			(error) => {
				if (!controller.signal.aborted)
					setState((previous) => markReadFailed(previous, error));
			}
		);
		return () => controller.abort();
	}, [path, reloadCount, retryCount]);

	const retry = useCallback(() => setRetryCount((count) => count + 1), []);

	return { ...state, retry };
}
