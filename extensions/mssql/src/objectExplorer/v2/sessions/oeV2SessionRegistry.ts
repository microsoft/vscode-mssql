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

import { diag, diagnosticErrorClass } from "../../../diagnostics/diagnosticsCore";
import { PreparedConnection } from "../../../services/metadata/profileAuthAdapter";
import { ISqlSession, OpenSessionParams } from "../../../services/sqlDataPlane/api";
import { FallbackDecision } from "../../../services/sqlDataPlane/providerSuggestions";

/**
 * Opens a data-plane session applying the shared capability-fallback policy
 * (TSQ2 §8.2) — e.g. a Windows-auth profile that ts-native can't open prompts
 * and falls back to SQL Tools Service. Injected so this module stays free of
 * the registry singleton (the activation edge owns it).
 */
export type OeV2SessionOpener = (
    params: OpenSessionParams,
) => Promise<{ session: ISqlSession; decision?: FallbackDecision }>;

export type OeV2ConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "lost"
    | "disconnecting"
    | "failed";

export interface OeV2ConnectionSession {
    readonly connectionId: string;
    readonly prepared?: PreparedConnection;
    readonly state: OeV2ConnectionState;
    readonly session?: ISqlSession;
    readonly serverVersion?: string;
    readonly databaseAtOpen?: string;
    readonly failureReason?: string;
    /** Milliseconds spent connecting so far (B27 slow-connect surfacing). */
    readonly connectingForMs?: number;
}

interface Entry {
    connectionId: string;
    prepared: PreparedConnection | undefined;
    state: OeV2ConnectionState;
    session: ISqlSession | undefined;
    failureReason: string | undefined;
    stateSubscription: { dispose(): void } | undefined;
    connectingSince: number | undefined;
}

export class OeV2SessionRegistry {
    private entries = new Map<string, Entry>();
    private listeners = new Set<(connectionId: string) => void>();

    constructor(private readonly openSession: OeV2SessionOpener) {}

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

    /** B27: drives the slow-connect re-render tick. */
    anyConnecting(): boolean {
        for (const entry of this.entries.values()) {
            if (entry.state === "connecting" || entry.state === "disconnecting") {
                return true;
            }
        }
        return false;
    }

    /** Open or reuse the OE v2 data-plane session for a saved profile. */
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
            connectingSince: Date.now(),
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
            if (this.entries.get(connectionId) !== entry || entry.state !== "connecting") {
                span.end("info", {
                    result: { raw: "superseded", cls: "diagnostic.metadata" },
                });
                return snapshotOf(this.entries.get(connectionId) ?? entry);
            }
            // Capability-routed open: a profile the default backend can't handle
            // (e.g. Windows integrated auth on ts-native) prompts and falls back
            // to SQL Tools Service via the shared policy — same UX as Query
            // Studio. session.info.backendKind carries the actual provider.
            const { session } = await this.openSession({
                profile: prepared.profileRef,
                applicationName: "vscode-mssql-oe-v2",
                auth: prepared.auth,
            });
            if (this.entries.get(connectionId) !== entry || entry.state !== "connecting") {
                await session.close().catch(() => undefined);
                span.end("info", {
                    result: { raw: "superseded", cls: "diagnostic.metadata" },
                });
                return snapshotOf(this.entries.get(connectionId) ?? entry);
            }
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
            if (this.entries.get(connectionId) !== entry || entry.state !== "connecting") {
                span.end("info", {
                    result: { raw: "superseded", cls: "diagnostic.metadata" },
                });
                return snapshotOf(this.entries.get(connectionId) ?? entry);
            }
            entry.state = "failed";
            entry.failureReason = error instanceof Error ? error.message : String(error);
            span.end("error", {
                errorClass: {
                    raw: diagnosticErrorClass(error),
                    cls: "diagnostic.metadata",
                },
            });
            this.notify(connectionId);
            return snapshotOf(entry);
        }
    }

    /**
     * Cancel an in-flight connect: the node returns to disconnected
     * immediately. The pending open settles under its backend deadline and
     * hits the superseded branch, which closes any late-arriving session.
     */
    cancelConnect(connectionId: string): boolean {
        const entry = this.entries.get(connectionId);
        if (!entry || entry.state !== "connecting") {
            return false;
        }
        entry.state = "disconnected";
        entry.failureReason = undefined;
        entry.connectingSince = undefined;
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.connection.openCanceled",
            fields: {},
        });
        this.notify(connectionId);
        return true;
    }

    /** Records a profile/auth preparation failure so command UI can show its reason. */
    recordPreparationFailure(connectionId: string, failureReason: string, error: unknown): void {
        const previous = this.entries.get(connectionId);
        previous?.stateSubscription?.dispose();
        void previous?.session?.close().catch(() => undefined);
        this.entries.set(connectionId, {
            connectionId,
            prepared: undefined,
            state: "failed",
            session: undefined,
            failureReason,
            stateSubscription: undefined,
            connectingSince: undefined,
        });
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.connection.openRejected",
            status: "error",
            fields: {
                errorClass: {
                    raw: diagnosticErrorClass(error),
                    cls: "diagnostic.metadata",
                },
            },
        });
        this.notify(connectionId);
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
        ...(entry.prepared ? { prepared: entry.prepared } : {}),
        state: entry.state,
        ...(entry.session ? { session: entry.session } : {}),
        ...(info?.serverVersion ? { serverVersion: info.serverVersion } : {}),
        ...(info?.database ? { databaseAtOpen: info.database } : {}),
        ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
        ...(entry.state === "connecting" && entry.connectingSince !== undefined
            ? { connectingForMs: Date.now() - entry.connectingSince }
            : {}),
    };
}
