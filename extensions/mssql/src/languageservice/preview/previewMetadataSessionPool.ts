/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    MetadataProvider,
    SimpleQueryExecutor,
    SimpleQueryResult,
} from "@vscode-mssql/tsql-language-service";

export interface PreviewMetadataSessionLease {
    readonly key: string;
    readonly provider: MetadataProvider;
    dispose(): void;
}

interface SessionEntry {
    readonly provider: MetadataProvider;
    readonly routes: Map<string, number>;
    leases: number;
    lastUsed: number;
}

/**
 * Shares immutable catalog generations across documents connected to the same logical database.
 *
 * The executor routes each query through a currently attached document URI. It never captures the
 * first document permanently, so closing that editor cannot strand a catalog still used elsewhere.
 * Only inactive sessions participate in the bounded LRU cache; an active document is never evicted.
 */
export class PreviewMetadataSessionPool {
    private readonly _sessions = new Map<string, SessionEntry>();
    private _clock = 0;

    public constructor(
        private readonly _createProvider: (executor: SimpleQueryExecutor) => MetadataProvider,
        private readonly _execute: (
            connectionUri: string,
            query: string,
            signal?: AbortSignal,
        ) => Promise<SimpleQueryResult>,
        private readonly _inactiveCapacity: number,
    ) {
        if (!Number.isSafeInteger(_inactiveCapacity) || _inactiveCapacity <= 0) {
            throw new RangeError("Metadata session cache size must be a positive integer.");
        }
    }

    public get size(): number {
        return this._sessions.size;
    }

    public acquire(key: string, connectionUri: string): PreviewMetadataSessionLease {
        let entry = this._sessions.get(key);
        if (!entry) {
            const routes = new Map<string, number>();
            const executor: SimpleQueryExecutor = {
                execute: (query, signal) => {
                    const route = [...routes.keys()].at(-1);
                    if (!route) {
                        throw new Error(
                            "No connected document is attached to this metadata session.",
                        );
                    }
                    return this._execute(route, query, signal);
                },
            };
            entry = {
                provider: this._createProvider(executor),
                routes,
                leases: 0,
                lastUsed: ++this._clock,
            };
            this._sessions.set(key, entry);
        }

        entry.leases++;
        entry.lastUsed = ++this._clock;
        entry.routes.delete(connectionUri);
        entry.routes.set(connectionUri, (entry.routes.get(connectionUri) ?? 0) + 1);
        this.trimInactiveSessions();
        let disposed = false;
        const leased = entry;
        return {
            key,
            provider: entry.provider,
            dispose: () => {
                if (disposed) return;
                disposed = true;
                const count = leased.routes.get(connectionUri) ?? 0;
                if (count <= 1) leased.routes.delete(connectionUri);
                else leased.routes.set(connectionUri, count - 1);
                leased.leases = Math.max(0, leased.leases - 1);
                leased.lastUsed = ++this._clock;
                this.trimInactiveSessions();
            },
        };
    }

    public clear(): void {
        this._sessions.clear();
    }

    private trimInactiveSessions(): void {
        const inactive = [...this._sessions.entries()]
            .filter(([, entry]) => entry.leases === 0)
            .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
        while (this._sessions.size > this._inactiveCapacity && inactive.length > 0) {
            const oldest = inactive.shift();
            if (oldest) this._sessions.delete(oldest[0]);
        }
    }
}

export interface PreviewMetadataSessionIdentity {
    readonly server: string;
    readonly port?: number;
    readonly database: string;
    readonly user?: string;
    readonly authenticationType?: string;
    readonly accountId?: string;
    readonly tenantId?: string;
    readonly engineProfile: string;
}

/** Creates an in-memory-only logical identity; secret-bearing fields are absent by construction. */
export function previewMetadataSessionKey(identity: PreviewMetadataSessionIdentity): string {
    return JSON.stringify([
        normalize(identity.server),
        identity.port ?? 0,
        normalize(identity.database),
        normalize(identity.user),
        normalize(identity.authenticationType),
        normalize(identity.accountId),
        normalize(identity.tenantId),
        normalize(identity.engineProfile),
    ]);
}

function normalize(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
}
