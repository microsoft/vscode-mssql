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
}

/**
 * Sends a request to the extension when the component mounts, and again when the parameters or
 * `key` change. Keeps the result in component state, not in the shared webview state. A newer
 * request replaces the result of an older one that finishes later. While `enabled` is false,
 * nothing is sent and the state is not loading.
 */
export function useExtensionRequest<TParams, TResult>(
    type: RequestType<TParams, TResult, void>,
    params: TParams,
    key?: unknown,
    enabled: boolean = true,
): ExtensionRequestState<TResult> {
    const { extensionRpc } = useVscodeWebview<unknown, unknown>();
    const [state, setState] = useState<ExtensionRequestState<TResult>>({ loading: true });
    const paramsRef = useRef(params);
    paramsRef.current = params;
    const requestKey = JSON.stringify([params ?? null, key ?? null]);

    useEffect(() => {
        if (!enabled) {
            setState((previous) => (previous.loading ? { ...previous, loading: false } : previous));
            return;
        }
        let current = true;
        setState((previous) => ({ ...previous, loading: true }));
        extensionRpc.sendRequest(type, paramsRef.current).then(
            (result) => {
                if (current) {
                    setState({ loading: false, result });
                }
            },
            (error: unknown) => {
                if (current) {
                    setState({
                        loading: false,
                        errorMessage: error instanceof Error ? error.message : String(error),
                    });
                }
            },
        );
        return () => {
            current = false;
        };
    }, [extensionRpc, type, requestKey, enabled]);

    return state;
}
