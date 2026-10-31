/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryResultWebviewState } from "../../../../sharedInterfaces/queryResult";

/**
 * Holds the state of each result the multi-results view shows, so that each results pane can
 * read its own result the way a lone results view reads the webview state.
 */
export class MultiResultsStore {
    private _states = new Map<string, QueryResultWebviewState>();
    private _listeners = new Map<string, Set<() => void>>();

    public get(uri: string): QueryResultWebviewState | undefined {
        return this._states.get(uri);
    }

    public set(uri: string, state: QueryResultWebviewState): void {
        this._states.set(uri, state);
        this._listeners.get(uri)?.forEach((listener) => listener());
    }

    /**
     * Drops the states of results that are no longer shown. They are sent again when shown.
     */
    public retainOnly(uris: readonly string[]): void {
        for (const uri of [...this._states.keys()]) {
            if (!uris.includes(uri)) {
                this._states.delete(uri);
            }
        }
    }

    public subscribe(uri: string, listener: () => void): () => void {
        let listeners = this._listeners.get(uri);
        if (!listeners) {
            listeners = new Set();
            this._listeners.set(uri, listeners);
        }
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this._listeners.delete(uri);
            }
        };
    }
}
