/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";
import { DashboardProvider, DashboardProviderError } from "./dashboardProvider";

type StateListener = (state: SqlDashboard.WebviewState) => void;

/**
 * VS Code-free dashboard state machine. The extension host owns route loads,
 * cancellation and refresh coalescing; the webview only renders snapshots.
 */
export class SqlDashboardSession {
    private requestId = 0;
    private current: SqlDashboard.WebviewState;
    private readonly listeners = new Set<StateListener>();
    private active:
        | {
              routeKey: string;
              abort: AbortController;
              promise: Promise<SqlDashboard.WebviewState>;
          }
        | undefined;
    private disposed = false;

    constructor(
        private readonly provider: DashboardProvider,
        initialRoute: SqlDashboard.Route,
    ) {
        this.current = {
            schemaVersion: SqlDashboard.schemaVersion,
            mode: provider.mode,
            ...(provider.scenario !== undefined ? { scenario: provider.scenario } : {}),
            connection: provider.connection,
            requestId: 0,
            route: initialRoute,
            status: "loading",
        };
    }

    state(): SqlDashboard.WebviewState {
        return this.current;
    }

    onDidChange(listener: StateListener): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    navigate(route: SqlDashboard.Route): Promise<SqlDashboard.WebviewState> {
        return this.load(route);
    }

    refresh(): Promise<SqlDashboard.WebviewState> {
        return this.load(this.current.route);
    }

    private load(route: SqlDashboard.Route): Promise<SqlDashboard.WebviewState> {
        if (this.disposed) {
            return Promise.reject(new Error("SQL Dashboard session is disposed"));
        }
        const routeKey = JSON.stringify(route);
        if (this.active?.routeKey === routeKey) {
            return this.active.promise;
        }

        this.active?.abort.abort();
        const abort = new AbortController();
        const requestId = ++this.requestId;
        this.current = {
            ...this.current,
            requestId,
            route,
            status: "loading",
            error: undefined,
        };
        this.emit();

        const promise = this.provider
            .load(route, abort.signal)
            .then((page) => {
                if (this.disposed || abort.signal.aborted || requestId !== this.requestId) {
                    return this.current;
                }
                this.current = {
                    ...this.current,
                    route,
                    requestId,
                    status: "ready",
                    page,
                    error: undefined,
                };
                this.emit();
                return this.current;
            })
            .catch((error: unknown) => {
                if (abort.signal.aborted || requestId !== this.requestId) {
                    return this.current;
                }
                const normalized =
                    error instanceof DashboardProviderError
                        ? {
                              code: error.code,
                              detail: error.message,
                              retryable: error.retryable,
                          }
                        : {
                              code: "dashboardLoadFailed",
                              detail: error instanceof Error ? error.message : String(error),
                              retryable: true,
                          };
                this.current = {
                    ...this.current,
                    requestId,
                    route,
                    status: "error",
                    error: normalized,
                };
                this.emit();
                return this.current;
            })
            .finally(() => {
                if (this.active?.abort === abort) {
                    this.active = undefined;
                }
            });
        this.active = { routeKey, abort, promise };
        return promise;
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener(this.current);
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.active?.abort.abort();
        this.active = undefined;
        this.listeners.clear();
        void this.provider.dispose();
    }
}
