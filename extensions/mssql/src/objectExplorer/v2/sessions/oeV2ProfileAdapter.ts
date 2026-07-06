/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Read-only connection-profile tree source (plan decision #7): OE v2 shares
 * the product's saved profiles + connection groups through a structural
 * seam over ConnectionStore/ConnectionConfig. Group CRUD and drag-drop stay
 * classic commands operating on the same settings storage; v2 re-renders on
 * change. NO credentials ride these records — auth resolution happens in
 * the session registry (B18) via the shared profileAuthAdapter closures.
 */

export interface OeV2StoredProfile {
    id?: string;
    server?: string;
    database?: string;
    user?: string;
    authenticationType?: string;
    profileName?: string;
    groupId?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    containerName?: string;
}

export interface OeV2StoredGroup {
    id?: string;
    name?: string;
    parentId?: string;
    color?: string;
}

/** Structural subset of ConnectionStore (read-only). */
export interface ConnectionProfileSource {
    readAllConnections(includeRecent?: boolean): Promise<OeV2StoredProfile[]>;
    readAllConnectionGroups(): Promise<OeV2StoredGroup[]>;
}

export interface OeV2ProfileRecord {
    /** Stable id for the connection path segment (profile id or a derived key). */
    readonly profileId: string;
    readonly displayName: string;
    readonly server: string;
    readonly database?: string;
    readonly user?: string;
    readonly authKind: "sql" | "integrated";
    readonly groupId?: string;
    readonly stored: OeV2StoredProfile;
}

export interface OeV2GroupRecord {
    readonly groupId: string;
    readonly name: string;
    readonly parentId?: string;
    readonly color?: string;
}

export interface OeV2ProfileTree {
    readonly groups: readonly OeV2GroupRecord[];
    readonly profiles: readonly OeV2ProfileRecord[];
    /** The ROOT group id when present (classic ConnectionConfig uses "ROOT"). */
    readonly rootGroupId?: string;
}

export async function readProfileTree(source: ConnectionProfileSource): Promise<OeV2ProfileTree> {
    const [groups, connections] = await Promise.all([
        source.readAllConnectionGroups().catch(() => [] as OeV2StoredGroup[]),
        source.readAllConnections(false).catch(() => [] as OeV2StoredProfile[]),
    ]);
    const groupRecords: OeV2GroupRecord[] = groups
        .filter((group) => group.id)
        .map((group) => ({
            groupId: group.id!,
            name: group.name ?? "Group",
            ...(group.parentId ? { parentId: group.parentId } : {}),
            ...(group.color ? { color: group.color } : {}),
        }));
    const rootGroupId = groupRecords.find(
        (group) => group.name === "ROOT" || group.groupId === "ROOT" || !group.parentId,
    )?.groupId;
    const profiles: OeV2ProfileRecord[] = connections
        .filter((profile) => profile.server)
        .map((profile) => ({
            profileId:
                profile.id ??
                `${profile.server}|${profile.database ?? ""}|${profile.user ?? ""}|${profile.authenticationType ?? ""}`,
            displayName: profile.profileName || profile.server!,
            server: profile.server!,
            ...(profile.database ? { database: profile.database } : {}),
            ...(profile.user ? { user: profile.user } : {}),
            authKind: (profile.authenticationType ?? "").toLowerCase().includes("integrated")
                ? "integrated"
                : "sql",
            ...(profile.groupId ? { groupId: profile.groupId } : {}),
            stored: profile,
        }));
    return { groups: groupRecords, profiles, ...(rootGroupId ? { rootGroupId } : {}) };
}
