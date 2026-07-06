/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared profile → data-plane preparation (MetadataStore design MD-0):
 * builds SqlConnectionProfileRef + AuthProviderBundle from a stored
 * connection profile the way Query Studio's DocumentSessionBinding always
 * has — extracted so the MetadataStore and Object Explorer v2 use the SAME
 * seam instead of copying it.
 *
 * Secrets: passwords exist only inside the passwordProvider closure and are
 * resolved from the credential store at open time. Nothing here stores or
 * logs them.
 */

import { AuthProviderBundle, SqlConnectionProfileRef } from "../sqlDataPlane/api";
import { profileFingerprint, serverFingerprint } from "./profileFingerprint";

/** Minimal stored-profile shape (subset of IConnectionProfile). */
export interface StoredConnectionProfile {
    server?: string;
    database?: string;
    user?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    profileName?: string;
    savePassword?: boolean;
}

/** Credential-store seam (ConnectionStore.lookupPassword). */
export interface ProfileSecretSource {
    lookupPassword(credentials: unknown, isConnectionString?: boolean): Promise<string>;
}

export type ResolvedAuthKind = "sql" | "integrated";

export function resolveAuthKind(stored: StoredConnectionProfile): ResolvedAuthKind {
    return (stored.authenticationType ?? "").toLowerCase().includes("integrated")
        ? "integrated"
        : "sql";
}

export function buildProfileRef(stored: StoredConnectionProfile): SqlConnectionProfileRef {
    const authKind = resolveAuthKind(stored);
    return {
        profileFingerprint: profileFingerprint({ ...stored, authKind }),
        server: stored.server ?? "",
        ...(stored.database ? { database: stored.database } : {}),
        authKind,
        ...(stored.user ? { user: stored.user } : {}),
        ...(stored.encrypt !== undefined ? { encrypt: stored.encrypt } : {}),
        ...(stored.trustServerCertificate !== undefined
            ? { trustServerCertificate: stored.trustServerCertificate }
            : {}),
        ...(stored.profileName ? { displayName: stored.profileName } : {}),
    };
}

/**
 * Password provider closure over the credential store. Integrated auth
 * resolves to no password; SQL auth defers to lookupPassword at open time.
 */
export function buildAuthBundle(
    stored: StoredConnectionProfile,
    secrets: ProfileSecretSource,
): AuthProviderBundle {
    const authKind = resolveAuthKind(stored);
    return {
        passwordProvider: async () =>
            authKind === "sql" ? secrets.lookupPassword(stored) : undefined,
    };
}

/** Everything a data-plane consumer needs to open sessions for a profile. */
export interface PreparedConnection {
    readonly profileRef: SqlConnectionProfileRef;
    readonly auth: AuthProviderBundle;
    readonly authKind: ResolvedAuthKind;
    /** Server-scoped identity (excludes database) — the store ServerKey value. */
    readonly serverFingerprint: string;
    readonly defaultDatabase?: string;
    readonly displayName?: string;
}

export function prepareConnection(
    stored: StoredConnectionProfile,
    secrets: ProfileSecretSource,
): PreparedConnection {
    const authKind = resolveAuthKind(stored);
    return {
        profileRef: buildProfileRef(stored),
        auth: buildAuthBundle(stored, secrets),
        authKind,
        serverFingerprint: serverFingerprint({ ...stored, authKind }),
        ...(stored.database ? { defaultDatabase: stored.database } : {}),
        ...(stored.profileName || stored.server
            ? { displayName: stored.profileName ?? stored.server }
            : {}),
    };
}
