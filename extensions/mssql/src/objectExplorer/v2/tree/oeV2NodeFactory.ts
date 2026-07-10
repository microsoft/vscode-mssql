/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure node builders (oe_view_design §9): profile-tree records → OeV2Node.
 * No network calls, no vscode — icon NAMES only, resolved at the edge.
 * Ordering mirrors classic getRootNodes: groups first, then connections,
 * both alphabetical.
 */

import {
    OeV2GroupRecord,
    OeV2ProfileRecord,
    OeV2ProfileTree,
} from "../sessions/oeV2ProfileAdapter";
import { commandFlagsFor } from "../commands/oeV2CommandRegistry";
import { capabilitiesFor, contextValueFor } from "./oeV2Capabilities";
import {
    connectionTooltipLines,
    disambiguationLines,
    OeV2ConnectionLabelFacts,
} from "./oeV2ConnectionLabel";
import { NOT_APPLICABLE, OeV2Node } from "./oeV2Node";
import { encodePath } from "./oeV2Path";

export function connectionGroupNode(group: OeV2GroupRecord): OeV2Node {
    const path = { kind: "connectionGroup" as const, groupId: group.groupId };
    return {
        id: encodePath(path),
        path,
        kind: "connectionGroup",
        label: group.name,
        collapsible: true,
        readiness: NOT_APPLICABLE,
        capabilities: capabilitiesFor("connectionGroup"),
        ...(group.color ? { color: group.color } : {}),
    };
}

/** Session state as the factory needs it (registry type stays out of tree/). */
export type ConnectionNodeState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "lost"
    | "disconnecting"
    | "failed";

export interface ConnectionNodeFacts {
    readonly state: ConnectionNodeState;
    readonly serverVersion?: string;
    readonly failureReason?: string;
    /** B27: elapsed connect time — slow connects surface honestly. */
    readonly connectingForMs?: number;
}

export function connectionNode(
    profile: OeV2ProfileRecord,
    facts: ConnectionNodeFacts = { state: "disconnected" },
    tiedWith: readonly OeV2ConnectionLabelFacts[] = [],
): OeV2Node {
    const path = { kind: "connection" as const, connectionId: profile.profileId };
    const kind =
        facts.state === "connected"
            ? ("connectedServer" as const)
            : facts.state === "connecting" || facts.state === "disconnecting"
              ? ("connectingConnection" as const)
              : facts.state === "lost"
                ? ("lostConnection" as const)
                : ("disconnectedConnection" as const);
    // K6: database/auth already live in the v1-recipe label — description
    // carries connection STATE only.
    const description =
        facts.state === "connecting"
            ? facts.connectingForMs !== undefined && facts.connectingForMs >= 5000
                ? `connecting… (${Math.round(facts.connectingForMs / 1000)}s)`
                : "connecting…"
            : facts.state === "disconnecting"
              ? "disconnecting…"
              : facts.state === "lost"
                ? "connection lost"
                : facts.state === "failed"
                  ? `failed: ${facts.failureReason ?? "connect error"}`
                  : undefined;
    const lines = connectionTooltipLines(profile.stored);
    if (facts.serverVersion) {
        // Additive over v1 (journaled): live server version when connected.
        lines.push(`Server Version: ${facts.serverVersion}`);
    }
    const differs = disambiguationLines(profile.stored, tiedWith);
    if (differs.length > 0) {
        lines.push("Differs from same-named connections:", ...differs);
    }
    return {
        id: encodePath(path),
        path,
        kind,
        label: profile.displayName,
        ...(description ? { description } : {}),
        tooltip: lines.join("\n"),
        collapsible: true,
        connectionId: profile.profileId,
        // DB-scoped connections carry their database (K4 backup targeting).
        ...(profile.database ? { database: profile.database } : {}),
        readiness: NOT_APPLICABLE,
        capabilities: capabilitiesFor(kind),
        icon: facts.state === "connected" ? "Server_green" : "Server_red",
    };
}

/** Back-compat alias (B17 shape). */
export function disconnectedConnectionNode(profile: OeV2ProfileRecord): OeV2Node {
    return connectionNode(profile);
}

export type ConnectionStateLookup = (profileId: string) => ConnectionNodeFacts | undefined;

/**
 * Root children: the ROOT group's subgroups + profiles (groups-first, each
 * alphabetical) — same shape classic getRootNodes produces. Groups other
 * than ROOT render nested via childrenOfGroup.
 */
export function rootChildren(tree: OeV2ProfileTree, stateFor?: ConnectionStateLookup): OeV2Node[] {
    return childrenOfGroup(tree, tree.rootGroupId, stateFor);
}

export function childrenOfGroup(
    tree: OeV2ProfileTree,
    groupId: string | undefined,
    stateFor?: ConnectionStateLookup,
): OeV2Node[] {
    const subgroups = tree.groups
        .filter((group) => group.parentId === groupId && group.groupId !== groupId)
        .sort((a, z) => a.name.localeCompare(z.name))
        .map(connectionGroupNode);
    const isRootLevel = groupId === tree.rootGroupId;
    const members = tree.profiles
        .filter(
            (profile) =>
                profile.groupId === groupId ||
                // Group-less profiles live at the root (classic behavior;
                // harness/settings-written profiles often omit groupId).
                (isRootLevel && profile.groupId === undefined),
        )
        .sort((a, z) => a.displayName.localeCompare(z.displayName));
    // K6 disambiguation: siblings that tie on the full v1 label get the
    // differing properties appended to their tooltips.
    const byLabel = new Map<string, OeV2ProfileRecord[]>();
    for (const profile of members) {
        const tied = byLabel.get(profile.displayName);
        if (tied) {
            tied.push(profile);
        } else {
            byLabel.set(profile.displayName, [profile]);
        }
    }
    const profiles = members.map((profile) => {
        const tied = (byLabel.get(profile.displayName) ?? []).filter((other) => other !== profile);
        return connectionNode(
            profile,
            stateFor?.(profile.profileId),
            tied.map((other) => other.stored),
        );
    });
    return [...subgroups, ...profiles];
}

/** Context value used by the vscode edge (kept here so tests stay pure). */
export function nodeContextValue(node: OeV2Node): string {
    return contextValueFor(node.kind, node.capabilities, commandFlagsFor(node));
}
