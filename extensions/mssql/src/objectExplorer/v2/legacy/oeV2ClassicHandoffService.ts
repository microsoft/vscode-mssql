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

export interface HandoffConnectionSeam {
    connect(ownerUri: string, profile: IConnectionProfile): Promise<boolean>;
    disconnect(ownerUri: string): Promise<boolean>;
}

interface HandoffEntry {
    ownerUri: string;
}

export interface OeV2HandoffOptions {
    /** Owner-URI suffix source (tests inject deterministic values). */
    uriNonce?: () => string;
}

export class OeV2ClassicHandoffService {
    private entries = new Map<string, HandoffEntry>();

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
    ): Promise<string | undefined> {
        const existing = this.entries.get(connectionId);
        if (existing) {
            this.emitHandoff(feature, "reused");
            return existing.ownerUri;
        }
        const nonce = this.options.uriNonce?.() ?? randomUUID();
        const ownerUri = `objectexplorerv2://handoff/${fingerprint.slice(0, 12)}/${nonce}`;
        // ConnectionManager normalizes credentials in place (including a
        // resolved password), so it must never receive the profile-tree's
        // cached object by reference.
        const connected = await this.connections
            .connect(ownerUri, { ...profile })
            .catch(() => false);
        if (!connected) {
            this.emitHandoff(feature, "connectFailed");
            return undefined;
        }
        const entry: HandoffEntry = { ownerUri };
        this.entries.set(connectionId, entry);
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
        await this.connections.disconnect(entry.ownerUri).catch(() => undefined);
    }

    dispose(): void {
        for (const connectionId of [...this.entries.keys()]) {
            void this.close(connectionId);
        }
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
