/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 connection sessions (oe_view_design §7): connect = open an
 * ISqlSession through the data plane (applicationName vscode-mssql-oe-v2).
 * NO ConnectionManager, NO classic OE RPCs — ever (lint + spy enforced).
 * The connection service is INJECTED (the activation edge owns singletons).
 * Metadata hydration does not ride this session — the MetadataStore opens
 * its own dedicated sessions; this one exists to prove the profile opens,
 * carry server facts, and (B19) run table-preview queries.
 */

import { diag } from "../../../diagnostics/diagnosticsCore";
import { PreparedConnection } from "../../../services/metadata/profileAuthAdapter";
import { ISqlConnectionService, ISqlSession } from "../../../services/sqlDataPlane/api";

export type OeV2ConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "lost"
    | "disconnecting"
    | "failed";

export interface OeV2ConnectionSession {
    readonly connectionId: string;
    readonly prepared: PreparedConnection;
    readonly state: OeV2ConnectionState;
    readonly session?: ISqlSession;
    readonly serverVersion?: string;
    readonly databaseAtOpen?: string;
    readonly failureReason?: string;
}

interface Entry {
    connectionId: string;
    prepared: PreparedConnection;
    state: OeV2ConnectionState;
    session: ISqlSession | undefined;
    failureReason: string | undefined;
    stateSubscription: { dispose(): void } | undefined;
}

export class OeV2SessionRegistry {
    private entries = new Map<string, Entry>();
    private listeners = new Set<(connectionId: string) => void>();

    constructor(private readonly service: () => Promise<ISqlConnectionService>) {}

    onDidChange(listener: (connectionId: string) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private notify(connectionId: string): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(connectionId);
            } catch {
                /* listener isolation */
            }
        }
    }

    get(connectionId: string): OeV2ConnectionSession | undefined {
        const entry = this.entries.get(connectionId);
        return entry ? snapshotOf(entry) : undefined;
    }

    stateOf(connectionId: string): OeV2ConnectionState {
        return this.entries.get(connectionId)?.state ?? "disconnected";
    }

    /** Explicit user connect (no auto-connect-on-expand in preview). */
    async connect(
        connectionId: string,
        prepared: PreparedConnection,
    ): Promise<OeV2ConnectionSession> {
        let entry = this.entries.get(connectionId);
        if (entry && (entry.state === "connected" || entry.state === "connecting")) {
            return snapshotOf(entry);
        }
        entry = {
            connectionId,
            prepared,
            state: "connecting",
            session: undefined,
            failureReason: undefined,
            stateSubscription: undefined,
        };
        this.entries.set(connectionId, entry);
        this.notify(connectionId);
        const span = diag.startSpan({
            feature: "objectExplorer",
            kind: "span",
            type: "objectExplorerV2.connection.open",
            fields: {
                fingerprint: {
                    raw: prepared.serverFingerprint.slice(0, 12),
                    cls: "diagnostic.metadata",
                },
            },
        });
        try {
            const service = await this.service();
            const session = await service.openSession({
                profile: prepared.profileRef,
                applicationName: "vscode-mssql-oe-v2",
                auth: prepared.auth,
            });
            entry.session = session;
            entry.state = "connected";
            entry.stateSubscription = session.onDidChangeState((change) => {
                if (change.current === "lost") {
                    entry!.state = "lost";
                    entry!.failureReason = change.reason;
                    diag.emit({
                        feature: "objectExplorer",
                        kind: "event",
                        type: "objectExplorerV2.connection.lost",
                        fields: {},
                    });
                    this.notify(connectionId);
                } else if (change.current === "closed" && entry!.state !== "lost") {
                    entry!.state = "disconnected";
                    this.notify(connectionId);
                }
            });
            span.end("ok");
            this.notify(connectionId);
            return snapshotOf(entry);
        } catch (error) {
            entry.state = "failed";
            entry.failureReason = error instanceof Error ? error.message : String(error);
            span.fail(error);
            this.notify(connectionId);
            return snapshotOf(entry);
        }
    }

    async disconnect(connectionId: string): Promise<void> {
        const entry = this.entries.get(connectionId);
        if (!entry || entry.state === "disconnected" || entry.state === "disconnecting") {
            return;
        }
        entry.state = "disconnecting";
        this.notify(connectionId);
        entry.stateSubscription?.dispose();
        entry.stateSubscription = undefined;
        await entry.session?.close().catch(() => undefined);
        entry.session = undefined;
        entry.state = "disconnected";
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.connection.close",
            fields: {},
        });
        this.notify(connectionId);
    }

    dispose(): void {
        for (const entry of this.entries.values()) {
            entry.stateSubscription?.dispose();
            void entry.session?.close().catch(() => undefined);
        }
        this.entries.clear();
        this.listeners.clear();
    }
}

function snapshotOf(entry: Entry): OeV2ConnectionSession {
    const info = entry.session?.info;
    return {
        connectionId: entry.connectionId,
        prepared: entry.prepared,
        state: entry.state,
        ...(entry.session ? { session: entry.session } : {}),
        ...(info?.serverVersion ? { serverVersion: info.serverVersion } : {}),
        ...(info?.database ? { databaseAtOpen: info.database } : {}),
        ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
    };
}
