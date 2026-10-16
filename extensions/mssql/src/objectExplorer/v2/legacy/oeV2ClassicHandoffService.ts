/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Explicit legacy handoff (oe_view_design §12): the ONLY door through which
 * OE v2 creates STS v1 state, and only after a user invokes a policy-listed
 * legacy command. H1 = a lazily-connected owner URI through the classic
 * ConnectionManager (injected seam); H2 adds a synthesized TreeNodeInfo.
 * The handoff is silent — v1/v2 connections coexisting is the normal state
 * for legacy features, so there is no user-facing confirmation; the Debug
 * Console shows both connections via the handoff/legacyConnection events
 * below plus the classic connection's own STS diag spans. Guardrails:
 * closed on v2 disconnect/remove/deactivation, one handoff connection per
 * v2 connection, every use measured; browse paths cannot reach this module
 * (lint + spies). There is deliberately no idle timer: classic dialogs may
 * retain the owner URI for longer than an arbitrary timeout.
 */

import { diag } from "../../../diagnostics/diagnosticsCore";
import { IConnectionProfile } from "../../../models/interfaces";
import { randomUUID } from "crypto";
import type { HandoffLevel } from "../commands/oeV2LegacyCommandPolicy";

export interface HandoffConnectionSeam {
    connect(ownerUri: string, profile: IConnectionProfile): Promise<boolean>;
    disconnect(ownerUri: string): Promise<boolean>;
}

interface HandoffEntry {
    ownerUri: string;
    fingerprint: string;
}

export interface OeV2HandoffOptions {
    /** Owner-URI suffix source (tests inject deterministic values). */
    uriNonce?: () => string;
}

export class OeV2ClassicHandoffService {
    private disposed = false;
    private generations = new Map<string, number>();
    private entries = new Map<string, HandoffEntry>();
    /** Coalesces simultaneous legacy commands for one v2 connection. */
    private pending = new Map<
        string,
        { fingerprint: string; creation: Promise<HandoffEntry | undefined> }
    >();

    constructor(
        private readonly connections: HandoffConnectionSeam,
        private readonly options: OeV2HandoffOptions = {},
    ) {}

    /**
     * H1: ensure a connected classic owner URI for this v2 connection.
     * Returns undefined when connect fails.
     */
    async ensureOwnerUri(
        connectionId: string,
        fingerprint: string,
        profile: IConnectionProfile,
        feature: string,
        level: Exclude<HandoffLevel, "h0"> = "h1",
    ): Promise<string | undefined> {
        if (this.disposed) {
            return undefined;
        }
        const existing = this.entries.get(connectionId);
        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                // The saved profile changed while v2 remained active. Never
                // reuse a classic connection that targets the old profile.
                return this.replaceOwner(connectionId, fingerprint, profile, feature, level);
            } else {
                this.emitHandoff(feature, "reused", level);
                return existing.ownerUri;
            }
        }
        const pending = this.pending.get(connectionId);
        if (pending) {
            if (pending.fingerprint !== fingerprint) {
                return this.replaceOwner(connectionId, fingerprint, profile, feature, level);
            }
            const joined = await pending.creation;
            this.emitHandoff(feature, joined ? "reused" : "connectFailed", level);
            return joined?.ownerUri;
        }
        const attempt = {
            fingerprint,
            creation: this.createEntry(fingerprint, profile, feature, level).then(async (entry) => {
                if (this.disposed || this.pending.get(connectionId) !== attempt) {
                    if (entry) {
                        await this.connections.disconnect(entry.ownerUri).catch(() => undefined);
                    }
                    return undefined;
                }
                if (entry) {
                    this.entries.set(connectionId, entry);
                }
                return entry;
            }),
        };
        this.pending.set(connectionId, attempt);
        try {
            return (await attempt.creation)?.ownerUri;
        } finally {
            if (this.pending.get(connectionId) === attempt) {
                this.pending.delete(connectionId);
            }
        }
    }

    private async replaceOwner(
        connectionId: string,
        fingerprint: string,
        profile: IConnectionProfile,
        feature: string,
        level: Exclude<HandoffLevel, "h0">,
    ): Promise<string | undefined> {
        const closing = this.close(connectionId);
        const generation = this.generations.get(connectionId);
        await closing;
        // An explicit disconnect while replacement waits must cancel the replacement too.
        if (this.generations.get(connectionId) !== generation) {
            return undefined;
        }
        return this.ensureOwnerUri(connectionId, fingerprint, profile, feature, level);
    }

    private async createEntry(
        fingerprint: string,
        profile: IConnectionProfile,
        feature: string,
        level: Exclude<HandoffLevel, "h0">,
    ): Promise<HandoffEntry | undefined> {
        const nonce = this.options.uriNonce?.() ?? randomUUID();
        const ownerUri = `objectexplorerv2://handoff/${fingerprint.slice(0, 12)}/${nonce}`;
        // ConnectionManager normalizes credentials in place (including a
        // resolved password), so it must never receive the profile-tree's
        // cached object by reference.
        const connected = await this.connections
            .connect(ownerUri, { ...profile })
            .catch(() => false);
        if (!connected) {
            this.emitHandoff(feature, "connectFailed", level);
            return undefined;
        }
        const entry: HandoffEntry = { ownerUri, fingerprint };
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.legacyConnection.created",
            fields: {
                fingerprint: { raw: fingerprint.slice(0, 12), cls: "diagnostic.metadata" },
            },
        });
        this.emitHandoff(feature, "created", level);
        return entry;
    }

    hasHandoff(connectionId: string): boolean {
        return this.entries.has(connectionId);
    }

    /** Close the handoff connection for a v2 connection (disconnect path). */
    async close(connectionId: string): Promise<void> {
        this.generations.set(connectionId, (this.generations.get(connectionId) ?? 0) + 1);
        // If connect is still in flight, join it so an immediately-following
        // disconnect/deactivate cannot leave the newly-opened URI unowned.
        const pending = this.pending.get(connectionId);
        this.pending.delete(connectionId);
        const entry = this.entries.get(connectionId);
        this.entries.delete(connectionId);
        await Promise.all([
            pending?.creation.catch(() => undefined),
            entry ? this.connections.disconnect(entry.ownerUri).catch(() => undefined) : undefined,
        ]);
    }

    dispose(): void {
        this.disposed = true;
        for (const connectionId of new Set([...this.entries.keys(), ...this.pending.keys()])) {
            void this.close(connectionId);
        }
    }

    private emitHandoff(
        feature: string,
        outcome: string,
        level: Exclude<HandoffLevel, "h0">,
    ): void {
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.command.handoff",
            fields: {
                handoffFeature: { raw: feature, cls: "diagnostic.metadata" },
                level: { raw: level, cls: "diagnostic.metadata" },
                outcome: { raw: outcome, cls: "diagnostic.metadata" },
            },
        });
    }
}
