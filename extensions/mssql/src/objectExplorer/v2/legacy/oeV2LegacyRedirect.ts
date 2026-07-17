/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The STS v1 connection-redirect library (OE_V1_PARITY_PLAN §2.5, K4): the
 * ONE code path that launches a legacy command from an OE v2 node. It
 * resolves the policy, opens (or reuses) the handoff connection through
 * OeV2ClassicHandoffService — silent handoff with idle TTL —
 * adapts the node per handoff level, and invokes the classic command. The
 * legacy handlers never learn how they were launched, and OE v2 never
 * touches the v1 connection object directly.
 */

import * as vscode from "vscode";
import { IConnectionProfile } from "../../../models/interfaces";
import { diag } from "../../../diagnostics/diagnosticsCore";
import { LEGACY_COMMAND_POLICIES, LegacyCommandPolicy } from "../commands/oeV2LegacyCommandPolicy";
import { OeV2Node } from "../tree/oeV2Node";
import { OeV2ClassicHandoffService } from "./oeV2ClassicHandoffService";
import { toLegacyTreeNode } from "./oeV2LegacyNodeAdapter";

export interface RedirectFactsSource {
    handoffFacts(
        connectionId: string,
    ): Promise<{ stored: unknown; fingerprint: string } | undefined>;
}

export interface RedirectOutcome {
    readonly ok: boolean;
    readonly error?: string;
}

/**
 * K4 special case: a DB-scoped top-level connection IS its database — a
 * database-scoped feature invoked on it targets the profile's database.
 */
function effectiveNode(policy: LegacyCommandPolicy, node: OeV2Node): OeV2Node {
    if (
        policy.databaseScoped &&
        node.kind === "connectedServer" &&
        node.database !== undefined &&
        node.connectionId !== undefined
    ) {
        const path = {
            kind: "database" as const,
            connectionId: node.connectionId,
            database: node.database,
        };
        return { ...node, kind: "database", path, label: node.database };
    }
    return node;
}

export async function redirectToClassic(
    feature: string,
    node: OeV2Node,
    deps: { facts: RedirectFactsSource; handoff: OeV2ClassicHandoffService },
): Promise<RedirectOutcome> {
    const policy = LEGACY_COMMAND_POLICIES.find((entry) => entry.feature === feature);
    if (!policy || !node.connectionId) {
        return { ok: false, error: "This action is not available here." };
    }
    if (!policy.nodeKinds.includes(node.kind)) {
        return { ok: false, error: "This action is not available on this node." };
    }
    // Defense in depth behind the menu gating: a database-scoped feature on
    // a top-level connection needs the connection to BE a database (K4).
    if (policy.databaseScoped && node.kind === "connectedServer" && node.database === undefined) {
        return { ok: false, error: "This action needs a database — use a database node." };
    }
    const facts = await deps.facts.handoffFacts(node.connectionId);
    if (!facts) {
        return { ok: false, error: "Connect this profile in Object Explorer v2 first." };
    }
    const profile = facts.stored as unknown as IConnectionProfile;
    const ownerUri = await deps.handoff.ensureOwnerUri(
        node.connectionId,
        facts.fingerprint,
        profile,
        feature,
    );
    if (!ownerUri) {
        return { ok: false }; // declined or connect failed (already surfaced)
    }
    diag.emit({
        feature: "objectExplorer",
        kind: "event",
        type: "objectExplorerV2.command.invoke",
        fields: {
            commandId: { raw: feature, cls: "diagnostic.metadata" },
            route: { raw: "legacyRedirect", cls: "diagnostic.metadata" },
            nodeKind: { raw: node.kind, cls: "diagnostic.metadata" },
        },
    });
    try {
        if (policy.level === "h1") {
            await vscode.commands.executeCommand(policy.classicCommand, ownerUri);
        } else {
            const adapted = toLegacyTreeNode(effectiveNode(policy, node), ownerUri, profile);
            if (!adapted) {
                throw new Error("node kind not adaptable");
            }
            await vscode.commands.executeCommand(policy.classicCommand, adapted);
        }
        return { ok: true };
    } catch (error) {
        // Guarded route: synthetic nodes are best-effort (§12.3).
        return {
            ok: false,
            error: `The legacy feature could not run with an Object Explorer v2 node (${
                error instanceof Error ? error.message : String(error)
            }). Use Classic Object Explorer for this command.`,
        };
    }
}
