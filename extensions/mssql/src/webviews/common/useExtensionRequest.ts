/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from "react";
import { RequestType } from "vscode-jsonrpc/browser";
import { useVscodeWebview } from "./vscodeWebviewProvider";

export interface ExtensionRequestState<TResult> {
    readonly loading: boolean;
    /** The last result. It stays while the request runs again. */
    readonly result?: TResult;
    /** The error text of the last request, when it failed. */
    readonly errorMessage?: string;
    /**
     * True when the result or error is of other parameters or another key than the current
     * ones, for example of the previous category while the new one loads.
     */
    readonly stale?: boolean;
}

interface StoredState<TResult> extends ExtensionRequestState<TResult> {
    /** The request that the result or error is of. */
    readonly requestKey?: string;
}

/*
 * The results of the requests, shared by the views of the webview, so that a view that opens
 * again shows its data at once. A result older than the maximum age shows while the request runs
 * again. Errors are not kept. The oldest results go when the cache is full.
 */
const cacheLimit = 100;
const cacheMaxAgeMs = 5 * 60_000;

interface CacheEntry {
    readonly result: unknown;
    readonly storedAt: number;
}

const resultCache = new Map<string, CacheEntry>();

function cachedResult(cacheKey: string): CacheEntry | undefined {
    const entry = resultCache.get(cacheKey);
    if (entry) {
        // The most recently used result goes last, so the oldest is first to go.
        resultCache.delete(cacheKey);
        resultCache.set(cacheKey, entry);
    }
    return entry;
}

function cacheResult(cacheKey: string, result: unknown): void {
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, { result, storedAt: Date.now() });
    while (resultCache.size > cacheLimit) {
        resultCache.delete(resultCache.keys().next().value as string);
    }
}

/** Drops the cached results, for example when the user refreshes. */
export function clearExtensionRequestCache(): void {
    resultCache.clear();
}

/**
 * Sends a request to the extension when the component mounts, and again when the parameters or
 * `key` change. A cached result of the same request shows at once, and the request runs again
 * only when the result is older than the maximum age. A newer request replaces the result of an
 * older one that finishes later. While `enabled` is false, nothing is sent and the state is not
 * loading. A change of `poll` sends the request again but keeps the result current, for a view
 * that reads the same data on a timer.
 */
export function useExtensionRequest<TParams, TResult>(
    type: RequestType<TParams, TResult, void>,
    params: TParams,
    key?: unknown,
    enabled: boolean = true,
    poll?: unknown,
): ExtensionRequestState<TResult> {
    const { extensionRpc } = useVscodeWebview<unknown, unknown>();
    const requestKey = JSON.stringify([params ?? null, key ?? null]);
    const cacheKey = `${type.method}:${requestKey}`;
    const [state, setState] = useState<StoredState<TResult>>(() => {
        const entry = enabled ? cachedResult(cacheKey) : undefined;
        return entry
            ? { loading: false, result: entry.result as TResult, requestKey }
            : { loading: true };
    });
    const paramsRef = useRef(params);
    paramsRef.current = params;
    const lastPoll = useRef(poll);

    useEffect(() => {
        if (!enabled) {
            setState((previous) => (previous.loading ? { ...previous, loading: false } : previous));
            return;
        }
        const polled = lastPoll.current !== poll;
        lastPoll.current = poll;
        const entry = polled ? undefined : cachedResult(cacheKey);
        if (entry) {
            setState((previous) =>
                previous.requestKey === requestKey && previous.result === entry.result
                    ? previous
                    : { loading: false, result: entry.result as TResult, requestKey },
            );
            // A live view, which polls, reads again at once; it shows the cached result meanwhile.
            if (poll === undefined && Date.now() - entry.storedAt < cacheMaxAgeMs) {
                return;
            }
        }
        let current = true;
        setState((previous) => ({ ...previous, loading: true }));
        extensionRpc.sendRequest(type, paramsRef.current).then(
            (result) => {
                cacheResult(cacheKey, result);
                if (current) {
                    setState({ loading: false, result, requestKey });
                }
            },
            (error: unknown) => {
                if (current) {
                    setState({
                        loading: false,
                        errorMessage: error instanceof Error ? error.message : String(error),
                        requestKey,
                    });
                }
            },
        );
        return () => {
            current = false;
        };
    }, [extensionRpc, type, requestKey, cacheKey, enabled, poll]);

    const { requestKey: resultKey, ...rest } = state;
    const hasOutcome = rest.result !== undefined || rest.errorMessage !== undefined;
    return { ...rest, stale: enabled && hasOutcome && resultKey !== requestKey };
}

/**
 * True while a request has no current result to show: the first load, or a load after the
 * parameters or the key changed, so the view does not show data of other parameters.
 */
export function isFirstLoad(state: ExtensionRequestState<unknown>): boolean {
    return (
        state.loading &&
        (!!state.stale || (state.result === undefined && state.errorMessage === undefined))
    );
}
