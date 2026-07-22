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
    id?: string;
    server?: string;
    /** Optional SQL TCP port from classic IConnectionInfo profiles. The data
     * plane carries endpoints as `server,port`, so this must be folded into
     * the sanitized server identity before opening a session. */
    port?: string | number;
    database?: string;
    user?: string;
    email?: string;
    accountId?: string;
    tenantId?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    profileName?: string;
    savePassword?: boolean;
}

function profileServerEndpoint(stored: StoredConnectionProfile): string {
    const server = stored.server ?? "";
    const port = String(stored.port ?? "").trim();
    if (!/^\d+$/.test(port) || server.includes(",")) {
        return server;
    }
    return `${server},${port}`;
}

/** First usable human-readable principal; empty profile fields are not identities. */
export function profilePrincipal(
    stored: Pick<StoredConnectionProfile, "user" | "email">,
): string | undefined {
    for (const value of [stored.user, stored.email]) {
        const candidate = value?.trim();
        if (candidate) {
            return candidate;
        }
    }
    return undefined;
}

/**
 * Stable id for a stored profile: its saved id when present, else a
 * deterministic derivation — the ONE recipe shared by OE v2 nodes and the
 * Query Studio open-from-context path so ids always agree.
 */
export function stableProfileId(stored: StoredConnectionProfile): string {
    const principal = profilePrincipal(stored) ?? stored.accountId?.trim() ?? "";
    return (
        stored.id ??
        `${profileServerEndpoint(stored)}|${stored.database ?? ""}|${principal}|${stored.tenantId ?? ""}|${stored.authenticationType ?? ""}`
    );
}

/** Credential-store seam (ConnectionStore.lookupPassword). */
export interface ProfileSecretSource {
    lookupPassword(credentials: unknown, isConnectionString?: boolean): Promise<string>;
}

/** Extension-host seam for acquiring a SQL-resource token at physical-open time. */
export interface ProfileTokenSource {
    acquireSqlAccessToken(profile: StoredConnectionProfile): Promise<string | undefined>;
}

export type ResolvedAuthKind = "sql" | "integrated" | "aad";

export class UnsupportedProfileAuthenticationError extends Error {
    constructor(authenticationType: string) {
        super(
            `Authentication type '${authenticationType}' is not supported by the SQL Data Plane. ` +
                "Use SQL Login, Integrated authentication, or Microsoft Entra MFA.",
        );
        this.name = "UnsupportedProfileAuthenticationError";
        Object.setPrototypeOf(this, UnsupportedProfileAuthenticationError.prototype);
    }
}

export function resolveAuthKind(stored: StoredConnectionProfile): ResolvedAuthKind {
    const authenticationType = stored.authenticationType?.trim() ?? "";
    switch (authenticationType.toLowerCase()) {
        // Classic connection behavior defaults an absent auth type to SQL Login.
        case "":
        case "sqllogin":
            return "sql";
        case "integrated":
            return "integrated";
        case "azuremfa":
        case "activedirectoryinteractive":
            return "aad";
        default:
            throw new UnsupportedProfileAuthenticationError(authenticationType);
    }
}

export function buildProfileRef(stored: StoredConnectionProfile): SqlConnectionProfileRef {
    const authKind = resolveAuthKind(stored);
    const principal = profilePrincipal(stored);
    return {
        profileFingerprint: profileFingerprint({
            ...stored,
            server: profileServerEndpoint(stored),
            user: principal,
            authKind,
        }),
        server: profileServerEndpoint(stored),
        ...(stored.database ? { database: stored.database } : {}),
        authKind,
        ...(principal ? { user: principal } : {}),
        ...(stored.encrypt !== undefined ? { encrypt: stored.encrypt } : {}),
        ...(stored.trustServerCertificate !== undefined
            ? { trustServerCertificate: stored.trustServerCertificate }
            : {}),
        ...(stored.profileName ? { displayName: stored.profileName } : {}),
        // Entra identity rides along for host-side ARM checks (serverless
        // pause status on open timeouts); never serialized to a backend wire.
        ...(authKind === "aad" && stored.accountId ? { accountId: stored.accountId } : {}),
        ...(authKind === "aad" && stored.tenantId ? { tenantId: stored.tenantId } : {}),
    };
}

/**
 * Deferred credential providers. SQL auth resolves the credential-store
 * password at open time; Entra MFA resolves a SQL-resource token; integrated
 * auth carries no secret provider.
 */
export function buildAuthBundle(
    stored: StoredConnectionProfile,
    secrets: ProfileSecretSource,
    tokens?: ProfileTokenSource,
): AuthProviderBundle {
    const authKind = resolveAuthKind(stored);
    switch (authKind) {
        case "sql":
            return { passwordProvider: async () => secrets.lookupPassword(stored) };
        case "aad":
            return {
                tokenProvider: async () => {
                    if (!tokens) {
                        throw new Error(
                            "Microsoft Entra authentication is unavailable in this host.",
                        );
                    }
                    return tokens.acquireSqlAccessToken(stored);
                },
            };
        case "integrated":
            return {};
    }
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
    tokens?: ProfileTokenSource,
): PreparedConnection {
    const authKind = resolveAuthKind(stored);
    const principal = profilePrincipal(stored);
    return {
        profileRef: buildProfileRef(stored),
        auth: buildAuthBundle(stored, secrets, tokens),
        authKind,
        serverFingerprint: serverFingerprint({
            ...stored,
            server: profileServerEndpoint(stored),
            user: principal,
            authKind,
        }),
        ...(stored.database ? { defaultDatabase: stored.database } : {}),
        ...(stored.profileName || stored.server
            ? { displayName: stored.profileName ?? stored.server }
            : {}),
    };
}
