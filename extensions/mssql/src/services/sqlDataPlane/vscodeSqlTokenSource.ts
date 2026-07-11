/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Data Plane token source backed by VS Code authentication sessions.
 *
 * This is deliberately independent of ConnectionManager and the classic STS
 * token-refresh protocol. It shares the same VS Code account/session store,
 * resolves a fresh SQL-resource token for each physical open, and retains no
 * token cache of its own. Concurrent opens for one identity are single-flight.
 */

import {
    acquireTokenFromVscodeAccountForResource,
    areCompatibleEntraAccountIds,
    getCloudResourceEndpoint,
    VscodeEntraSqlTokenInfo,
} from "../../azure/vscodeEntraMfaUtils";
import { diag } from "../../diagnostics/diagnosticsCore";
import { PreviewFeature, previewService } from "../../previews/previewService";
import {
    profilePrincipal,
    ProfileTokenSource,
    StoredConnectionProfile,
} from "../metadata/profileAuthAdapter";

export type AcquireVscodeSqlToken = (
    accountId?: string,
    tenantId?: string,
    accountLabel?: string,
) => Promise<VscodeEntraSqlTokenInfo>;

export class UnsupportedEntraAccountStoreError extends Error {
    constructor() {
        super(
            "SQL Data Plane Microsoft Entra authentication requires VS Code account authentication. " +
                "Enable mssql.preview.useVscodeAccountsForEntraMFA and re-select the account and tenant in the connection profile.",
        );
        this.name = "UnsupportedEntraAccountStoreError";
        Object.setPrototypeOf(this, UnsupportedEntraAccountStoreError.prototype);
    }
}

export class EntraIdentityMismatchError extends Error {
    constructor(kind: "account" | "tenant") {
        super(
            `The saved Microsoft Entra ${kind} is not available for the selected VS Code account. ` +
                "Re-select the account and tenant in the connection profile.",
        );
        this.name = kind === "account" ? "EntraAccountMismatchError" : "EntraTenantMismatchError";
        Object.setPrototypeOf(this, EntraIdentityMismatchError.prototype);
    }
}

export class EntraTokenExpiryError extends Error {
    constructor() {
        super(
            "VS Code returned a SQL access token too close to expiration. Retry the connection or sign in again.",
        );
        this.name = "EntraTokenExpiryError";
        Object.setPrototypeOf(this, EntraTokenExpiryError.prototype);
    }
}

const defaultAcquire: AcquireVscodeSqlToken = (accountId, tenantId, accountLabel) => {
    if (!previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
        throw new UnsupportedEntraAccountStoreError();
    }
    return acquireTokenFromVscodeAccountForResource(
        getCloudResourceEndpoint("sqlResource"),
        accountId,
        tenantId,
        accountLabel,
    );
};

const MIN_TOKEN_LIFETIME_SECONDS = 60;

function sameTenant(left: string, right: string): boolean {
    return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function acquisitionErrorClass(error: unknown): string {
    switch (error instanceof Error ? error.name : "") {
        case "MissingEntraAuthAccountError":
            return "missingAccount";
        case "UnsupportedEntraAccountStoreError":
            return "unsupportedAccountStore";
        case "EntraAccountMismatchError":
            return "accountMismatch";
        case "EntraTenantMismatchError":
            return "tenantMismatch";
        case "EntraTokenExpiryError":
            return "expiredToken";
        default:
            return "acquisitionFailed";
    }
}

function expiryBucket(expiresOn: number | undefined): string {
    if (expiresOn === undefined) {
        return "unknown";
    }
    const remainingSeconds = expiresOn - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) return "expired";
    if (remainingSeconds < 5 * 60) return "under5m";
    if (remainingSeconds < 30 * 60) return "under30m";
    return "over30m";
}

export class VscodeSqlTokenSource implements ProfileTokenSource {
    private readonly inFlight = new Map<string, Promise<string | undefined>>();

    constructor(private readonly acquire: AcquireVscodeSqlToken = defaultAcquire) {}

    acquireSqlAccessToken(profile: StoredConnectionProfile): Promise<string | undefined> {
        const accountLabel = profilePrincipal(profile);
        const key = JSON.stringify([
            profile.accountId ?? "",
            profile.tenantId ?? "",
            accountLabel ?? "",
        ]);
        const existing = this.inFlight.get(key);
        if (existing) {
            diag.emit({
                feature: "sqlDataPlane",
                kind: "event",
                type: "sqlDataPlane.auth.token.coalesced",
                fields: { authKind: { raw: "aad", cls: "diagnostic.metadata" } },
            });
            return existing;
        }

        const acquisition = this.acquireCore(profile, accountLabel).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, acquisition);
        return acquisition;
    }

    private async acquireCore(
        profile: StoredConnectionProfile,
        accountLabel: string | undefined,
    ): Promise<string | undefined> {
        const span = diag.startSpan({
            feature: "sqlDataPlane",
            kind: "span",
            type: "sqlDataPlane.auth.token",
            fields: {
                authKind: { raw: "aad", cls: "diagnostic.metadata" },
                hasAccountId: { raw: !!profile.accountId, cls: "diagnostic.metadata" },
                hasTenantId: { raw: !!profile.tenantId, cls: "diagnostic.metadata" },
                hasAccountLabel: { raw: !!accountLabel, cls: "diagnostic.metadata" },
            },
        });
        try {
            const tokenInfo = await this.acquire(profile.accountId, profile.tenantId, accountLabel);
            if (
                profile.accountId &&
                !areCompatibleEntraAccountIds(profile.accountId, tokenInfo.account.id)
            ) {
                throw new EntraIdentityMismatchError("account");
            }
            if (profile.tenantId && !sameTenant(profile.tenantId, tokenInfo.tenantId)) {
                throw new EntraIdentityMismatchError("tenant");
            }
            const token = tokenInfo.token.token;
            if (!token) {
                span.end("error", {
                    result: { raw: "emptyToken", cls: "diagnostic.metadata" },
                });
                return undefined;
            }
            if (
                tokenInfo.token.expiresOn !== undefined &&
                tokenInfo.token.expiresOn <=
                    Math.floor(Date.now() / 1000) + MIN_TOKEN_LIFETIME_SECONDS
            ) {
                throw new EntraTokenExpiryError();
            }
            span.end("ok", {
                result: { raw: "acquired", cls: "diagnostic.metadata" },
                expiryBucket: {
                    raw: expiryBucket(tokenInfo.token.expiresOn),
                    cls: "diagnostic.metadata",
                },
            });
            return token;
        } catch (error) {
            // Account and tenant identifiers can occur in the actionable error
            // message. Keep diagnostics to a fixed class and rethrow the
            // original only to the interactive caller.
            span.end("error", {
                result: { raw: "failed", cls: "diagnostic.metadata" },
                errorClass: {
                    raw: acquisitionErrorClass(error),
                    cls: "diagnostic.metadata",
                },
            });
            throw error;
        }
    }
}

/** Product singleton: stateless apart from short-lived single-flight promises. */
export const vscodeSqlTokenSource = new VscodeSqlTokenSource();
