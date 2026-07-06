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
import { capabilitiesFor, contextValueFor } from "./oeV2Capabilities";
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

export function disconnectedConnectionNode(profile: OeV2ProfileRecord): OeV2Node {
    const path = { kind: "connection" as const, connectionId: profile.profileId };
    return {
        id: encodePath(path),
        path,
        kind: "disconnectedConnection",
        label: profile.displayName,
        description: profile.database,
        tooltip: `${profile.server}${profile.database ? ` · ${profile.database}` : ""} · ${
            profile.user ?? "integrated"
        }`,
        collapsible: true,
        connectionId: profile.profileId,
        readiness: NOT_APPLICABLE,
        capabilities: capabilitiesFor("disconnectedConnection"),
        icon: "Server_red",
    };
}

/**
 * Root children: the ROOT group's subgroups + profiles (groups-first, each
 * alphabetical) — same shape classic getRootNodes produces. Groups other
 * than ROOT render nested via childrenOfGroup.
 */
export function rootChildren(tree: OeV2ProfileTree): OeV2Node[] {
    return childrenOfGroup(tree, tree.rootGroupId);
}

export function childrenOfGroup(tree: OeV2ProfileTree, groupId: string | undefined): OeV2Node[] {
    const subgroups = tree.groups
        .filter((group) => group.parentId === groupId && group.groupId !== groupId)
        .sort((a, z) => a.name.localeCompare(z.name))
        .map(connectionGroupNode);
    const profiles = tree.profiles
        .filter((profile) =>
            groupId === undefined ? profile.groupId === undefined : profile.groupId === groupId,
        )
        .sort((a, z) => a.displayName.localeCompare(z.displayName))
        .map(disconnectedConnectionNode);
    return [...subgroups, ...profiles];
}

/** Context value used by the vscode edge (kept here so tests stay pure). */
export function nodeContextValue(node: OeV2Node): string {
    return contextValueFor(node.kind, node.capabilities);
}
