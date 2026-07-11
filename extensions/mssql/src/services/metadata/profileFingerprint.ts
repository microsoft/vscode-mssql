/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stable, NON-REVERSIBLE connection-identity fingerprints (MetadataStore
 * design §4.1). Two scopes:
 *
 * - profileFingerprint: includes the default database — session identity for
 *   the data plane and replay keys (the SqlConnectionProfileRef contract
 *   documents "never reversible"; the original qsfp_ recipe was a truncated
 *   base64 of the raw parts and leaked the server name — replaced here).
 * - serverFingerprint: EXCLUDES the database — the MetadataStore ServerKey,
 *   so every database catalog under one logical server shares a server
 *   identity.
 *
 * Inputs deliberately cover only connection-affecting facts. Passwords,
 * tokens, and connection strings must never reach these functions.
 */

import { createHash } from "crypto";

export interface ProfileIdentityInput {
    readonly server?: string;
    readonly database?: string;
    readonly user?: string;
    /** Stable account/tenant ids separate metadata caches across Entra principals. */
    readonly accountId?: string;
    readonly tenantId?: string;
    /** Auth kind string (e.g. "sql" | "integrated" | "aad" | "bearer"). */
    readonly authKind: string;
    readonly encrypt?: string | boolean;
    readonly trustServerCertificate?: boolean;
}

function digestParts(prefix: string, parts: readonly (string | undefined)[]): string {
    const canonical = parts.map((part) => part ?? "").join("|");
    const hash = createHash("sha256").update(canonical, "utf8").digest("base64url");
    return `${prefix}_${hash.slice(0, 22)}`;
}

/** Profile-scoped fingerprint (includes default database). */
export function profileFingerprint(input: ProfileIdentityInput): string {
    return digestParts("pfp", [
        input.server,
        input.database,
        input.user,
        input.accountId,
        input.tenantId,
        input.authKind,
        String(input.encrypt ?? ""),
        String(input.trustServerCertificate ?? ""),
    ]);
}

/** Server-scoped fingerprint (excludes database) — MetadataStore ServerKey. */
export function serverFingerprint(input: ProfileIdentityInput): string {
    return digestParts("sfp", [
        input.server,
        input.user,
        input.accountId,
        input.tenantId,
        input.authKind,
        String(input.encrypt ?? ""),
        String(input.trustServerCertificate ?? ""),
    ]);
}

/** Non-reversible digest for arbitrary identity strings (short form). */
export function identityDigest(prefix: string, value: string): string {
    return digestParts(prefix, [value]);
}
