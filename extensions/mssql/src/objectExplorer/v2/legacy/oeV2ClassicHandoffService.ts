/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Explicit legacy handoff (oe_view_design §12): the ONLY door through which
 * OE v2 creates STS v1 state, and only after a user invokes a policy-listed
 * legacy command. H1 = a lazily-connected owner URI through the classic
 * ConnectionManager (injected seam); H2 adds a synthesized TreeNodeInfo.
 * Guardrails: first-use confirmation (setting-gated), idle TTL disposal,
 * closed on v2 disconnect, one handoff connection per v2 connection,
 * every use measured; browse paths cannot reach this module (lint + spies).
 */

import { diag } from "../../../diagnostics/diagnosticsCore";
import { IConnectionProfile } from "../../../models/interfaces";

export interface HandoffConnectionSeam {
    connect(ownerUri: string, profile: IConnectionProfile): Promise<boolean>;
    disconnect(ownerUri: string): Promise<boolean>;
}

export interface HandoffPrompt {
    (message: string): Promise<boolean>;
}

interface HandoffEntry {
    ownerUri: string;
    profile: IConnectionProfile;
    idleTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface OeV2HandoffOptions {
    /** Idle ms before the handoff connection is dropped (default 10 min). */
    idleTtlMs?: number;
    /** Confirmation gate; wired to the confirmLegacyHandoff setting. */
    confirm?: HandoffPrompt;
    /** Owner-URI suffix source (tests inject deterministic values). */
    uriNonce?: () => string;
}

export class OeV2ClassicHandoffService {
    private entries = new Map<string, HandoffEntry>();
    private confirmed = false;

    constructor(
        private readonly connections: HandoffConnectionSeam,
        private readonly options: OeV2HandoffOptions = {},
    ) {}

    /**
     * H1: ensure a connected classic owner URI for this v2 connection.
     * Returns undefined when the user declines or connect fails.
     */
    async ensureOwnerUri(
        connectionId: string,
        fingerprint: string,
        profile: IConnectionProfile,
        feature: string,
    ): Promise<string | undefined> {
        const existing = this.entries.get(connectionId);
        if (existing) {
            this.touch(existing, connectionId);
            this.emitHandoff(feature, "reused");
            return existing.ownerUri;
        }
        if (!this.confirmed && this.options.confirm) {
            const approved = await this.options.confirm(
                "This command uses a legacy SQL Tools Service connection alongside Object Explorer v2. Continue?",
            );
            if (!approved) {
                this.emitHandoff(feature, "declined");
                return undefined;
            }
            this.confirmed = true;
        }
        const nonce = this.options.uriNonce?.() ?? Math.random().toString(36).slice(2, 10);
        const ownerUri = `objectexplorerv2://handoff/${fingerprint.slice(0, 12)}/${nonce}`;
        const connected = await this.connections.connect(ownerUri, profile).catch(() => false);
        if (!connected) {
            this.emitHandoff(feature, "connectFailed");
            return undefined;
        }
        const entry: HandoffEntry = { ownerUri, profile, idleTimer: undefined };
        this.entries.set(connectionId, entry);
        this.touch(entry, connectionId);
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.legacyConnection.created",
            fields: {
                fingerprint: { raw: fingerprint.slice(0, 12), cls: "diagnostic.metadata" },
            },
        });
        this.emitHandoff(feature, "created");
        return ownerUri;
    }

    hasHandoff(connectionId: string): boolean {
        return this.entries.has(connectionId);
    }

    /** Close the handoff connection for a v2 connection (disconnect path). */
    async close(connectionId: string): Promise<void> {
        const entry = this.entries.get(connectionId);
        if (!entry) {
            return;
        }
        this.entries.delete(connectionId);
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
        }
        await this.connections.disconnect(entry.ownerUri).catch(() => undefined);
    }

    dispose(): void {
        for (const connectionId of [...this.entries.keys()]) {
            void this.close(connectionId);
        }
    }

    private touch(entry: HandoffEntry, connectionId: string): void {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
        }
        const ttl = this.options.idleTtlMs ?? 600_000;
        entry.idleTimer = setTimeout(() => void this.close(connectionId), ttl);
        (entry.idleTimer as { unref?: () => void }).unref?.();
    }

    private emitHandoff(feature: string, outcome: string): void {
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.command.handoff",
            fields: {
                handoffFeature: { raw: feature, cls: "diagnostic.metadata" },
                level: { raw: "h1", cls: "diagnostic.metadata" },
                outcome: { raw: outcome, cls: "diagnostic.metadata" },
            },
        });
    }
}
