/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Capability-driven menu contexts (oe_view_design §9.5): a command appears
 * because a tested route exists, NOT because a node's type string matches a
 * classic regex. The context value is a stable serialization of capability
 * flags that package.json `when` clauses match with word-boundary tests
 * (e.g. `viewItem =~ /\boe2:canRefresh\b/`).
 */

import { OeV2NodeCapabilities, OeV2NodeKind } from "./oeV2Node";

const FLAG_ORDER: readonly (keyof OeV2NodeCapabilities & string)[] = [
    "canConnect",
    "canDisconnect",
    "canCancelConnect",
    "canRefresh",
    "canFilter",
    "canSearch",
    "canCopyName",
    "canCopyQualifiedName",
    "canOpenQuery",
    "canSelectTop",
    "canGenerateScript",
    "canScriptExecute",
];

/** Serialize capabilities (+node kind) into the tree-item context value. */
export function contextValueFor(
    kind: OeV2NodeKind,
    caps: OeV2NodeCapabilities,
    extraFlags: readonly string[] = [],
): string {
    const parts: string[] = [`oe2:kind=${kind}`];
    for (const flag of FLAG_ORDER) {
        if (caps[flag] === true) {
            parts.push(`oe2:${flag}`);
        }
    }
    for (const feature of caps.legacyHandoff ?? []) {
        parts.push(`oe2:handoff=${feature}`);
    }
    parts.push(...extraFlags);
    return parts.join(",");
}

/** Capabilities for the B17 shell node kinds (browse caps land in B18+). */
export function capabilitiesFor(kind: OeV2NodeKind): OeV2NodeCapabilities {
    switch (kind) {
        case "disconnectedConnection":
            return { canConnect: true };
        case "connectingConnection":
            return { canCancelConnect: true };
        case "connectedServer":
            return { canDisconnect: true, canRefresh: true, canOpenQuery: true };
        case "lostConnection":
            return { canConnect: true, canDisconnect: true };
        case "connectionGroup":
            return {};
        default:
            return {};
    }
}
