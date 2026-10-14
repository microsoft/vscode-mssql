/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { AzureTenant, getSessionFromVSCode } from "@microsoft/vscode-azext-azureauth";

import { FormItemOptions } from "../sharedInterfaces/form";
import { IProviderResources, IToken } from "../models/contracts/azure";
import { getCloudProviderSettings } from "./providerSettings";
import { VsCodeAzureHelper, getDefaultTenantId } from "../connectionconfig/azureHelpers";
import * as locConstants from "../constants/locConstants";

export interface VscodeEntraSqlTokenInfo {
    account: vscode.AuthenticationSessionAccountInformation;
    session: vscode.AuthenticationSession;
    tenantId: string;
    token: IToken;
}

/**
 * Mirrors `vscode.AuthenticationWwwAuthenticateRequest` (VS Code 1.105+), which the
 * `@types/vscode` version used by this extension does not declare yet.
 */
interface WwwAuthenticateRequest {
    readonly wwwAuthenticate: string;
    readonly fallbackScopes?: readonly string[];
}

interface AccessTokenClaims {
    aud?: string;
    exp?: number;
    iat?: number;
    oid?: string;
    tid?: string;
}

/**
 * Challenge that makes VS Code's Microsoft auth provider skip its token cache. The native broker
 * (WAM on Windows) ignores `forceRefresh` and signing out does not remove its tokens, so a claims
 * request is the only way to get a new token before the cached one expires. VS Code requests
 * `{"access_token":{}}` for the same purpose.
 */
const forceRefreshChallenge = `Bearer claims="${Buffer.from('{"access_token":{}}').toString("base64")}"`;

/** Set when the user clears the Entra token cache; tokens are then stale until force-refreshed. */
let tokenCacheCleared = false;

/**
 * `iat` of the last force-refreshed token per user, tenant and resource. The broker can keep
 * returning an older token to requests without claims, so tokens issued before this are stale too.
 */
const forceRefreshedTokenIssuedAt = new Map<string, number>();

/**
 * Discards the VS Code accounts tokens the extension has seen. VS Code's auth provider cache
 * cannot be cleared from here, so the next request for each token is made with a claims challenge.
 */
export function clearVscodeEntraTokenCache(): void {
    tokenCacheCleared = true;
    forceRefreshedTokenIssuedAt.clear();
}

/**
 * Returns true if the access token was cached before the Entra token cache was last cleared,
 * e.g. it may not reflect group membership or PIM role changes made since it was issued.
 */
export function isVscodeEntraTokenStale(accessToken: string | undefined): boolean {
    if (!tokenCacheCleared || !accessToken) {
        return false;
    }

    const claims = getTokenClaims(accessToken);
    const key = getTokenCacheKey(claims);
    if (!key) {
        return false;
    }

    const forceRefreshedIssuedAt = forceRefreshedTokenIssuedAt.get(key);
    return (
        forceRefreshedIssuedAt === undefined ||
        (typeof claims.iat === "number" && claims.iat < forceRefreshedIssuedAt)
    );
}

/**
 * Determines if the provided account IDs are compatible, meaning they are either exactly the same or one is a prefix of the other.
 */
export function areCompatibleEntraAccountIds(
    currentAccountId?: string,
    expectedAccountId?: string,
): boolean {
    const normalizedCurrentAccountId = currentAccountId?.toLowerCase();
    const normalizedExpectedAccountId = expectedAccountId?.toLowerCase();

    return (
        !!normalizedCurrentAccountId &&
        !!normalizedExpectedAccountId &&
        (normalizedCurrentAccountId === normalizedExpectedAccountId ||
            normalizedCurrentAccountId.startsWith(normalizedExpectedAccountId) ||
            normalizedExpectedAccountId.startsWith(normalizedCurrentAccountId))
    );
}

export async function getVscodeEntraAccountOptions(): Promise<FormItemOptions[]> {
    const accounts = await VsCodeAzureHelper.getAccounts(false);
    return accounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));
}

export async function resolveVscodeEntraAccount(
    accountId?: string,
    accountLabel?: string,
): Promise<vscode.AuthenticationSessionAccountInformation | undefined> {
    const accounts = await VsCodeAzureHelper.getAccounts(false);

    if (accountId) {
        const exactMatch = accounts.find((account) => account.id === accountId);
        if (exactMatch) {
            return exactMatch;
        }

        const compatibleMatch = accounts.find((account) =>
            areCompatibleEntraAccountIds(account.id, accountId),
        );
        if (compatibleMatch) {
            return compatibleMatch;
        }
    }

    if (accountLabel) {
        const normalizedAccountLabel = accountLabel.trim().toLowerCase();
        return accounts.find(
            (account) => account.label.trim().toLowerCase() === normalizedAccountLabel,
        );
    }

    return undefined;
}

export async function normalizeVscodeEntraAccountId(
    accountId?: string,
): Promise<string | undefined> {
    return (await resolveVscodeEntraAccount(accountId))?.id;
}

export async function getVscodeEntraTenantsForAccountId(
    accountId?: string,
): Promise<AzureTenant[]> {
    const account = await resolveVscodeEntraAccount(accountId);
    return account ? await VsCodeAzureHelper.getTenantsForAccount(account) : [];
}

export async function getVscodeEntraTenantOptions(accountId?: string): Promise<FormItemOptions[]> {
    const tenants = await getVscodeEntraTenantsForAccountId(accountId);
    return tenants.map((tenant) => ({
        displayName: `${tenant.displayName} (${tenant.tenantId})`,
        value: tenant.tenantId,
    }));
}

/**
 * Acquires an access token for the given resource from VS Code's authentication provider.
 * Shared implementation for SQL and Azure Key Vault token acquisition.
 */
export async function acquireTokenFromVscodeAccountForResource(
    resourceEndpoint: string,
    accountId?: string,
    tenantId?: string,
    accountLabel?: string,
): Promise<VscodeEntraSqlTokenInfo> {
    const account = await resolveVscodeEntraAccount(accountId, accountLabel);
    if (!account) {
        throw new MissingEntraAuthAccountError(
            locConstants.Accounts.accountNotAvailableThroughVsCode(
                accountLabel ?? accountId ?? "",
                tenantId,
            ),
        );
    }

    let resolvedTenantId = tenantId?.trim() || undefined;
    if (!resolvedTenantId) {
        const tenants = await VsCodeAzureHelper.getTenantsForAccount(account);
        resolvedTenantId = getDefaultTenantId(account.id, tenants);
    }

    if (!resolvedTenantId) {
        throw new MissingEntraAuthAccountError(
            locConstants.Accounts.accountNotAvailableThroughVsCode(
                accountLabel ?? accountId ?? "",
                tenantId,
            ),
        );
    }

    let session = await getSessionForAccount(resourceEndpoint, resolvedTenantId, account);

    if (session && isVscodeEntraTokenStale(session.accessToken)) {
        session = await getSessionForAccount(
            { wwwAuthenticate: forceRefreshChallenge, fallbackScopes: [resourceEndpoint] },
            resolvedTenantId,
            account,
        );

        if (session) {
            const claims = getTokenClaims(session.accessToken);
            const key = getTokenCacheKey(claims);
            if (key) {
                forceRefreshedTokenIssuedAt.set(key, claims.iat ?? 0);
            }
        }
    }

    if (!session) {
        throw new Error(
            locConstants.Azure.unableToAcquireEntraTokenFromVsCode(accountLabel ?? accountId ?? ""),
        );
    }

    return {
        account,
        session,
        tenantId: resolvedTenantId,
        token: {
            key: account.id,
            token: session.accessToken,
            tokenType: "Bearer",
            expiresOn: getTokenExpiration(session.accessToken),
        },
    };
}

export function getCloudResourceEndpoint(endpoint: keyof IProviderResources): string {
    const cloudSettings = getCloudProviderSettings();
    const resource = cloudSettings.settings[endpoint];

    if (!resource) {
        throw new Error(
            locConstants.Azure.noResourceConfiguredForCurrentCloud(
                endpoint,
                cloudSettings.displayName,
            ),
        );
    }

    return resource.endpoint;
}

/**
 * Gets a session silently, falling back to an interactive request if VS Code has none.
 */
async function getSessionForAccount(
    scopeOrRequest: string | WwwAuthenticateRequest,
    tenantId: string,
    account: vscode.AuthenticationSessionAccountInformation,
): Promise<vscode.AuthenticationSession | undefined> {
    return (
        (await getSessionFromVSCode(scopeOrRequest, tenantId, {
            createIfNone: false,
            silent: true,
            account,
        })) ??
        (await getSessionFromVSCode(scopeOrRequest, tenantId, {
            createIfNone: true,
            account,
        }))
    );
}

function getTokenExpiration(accessToken: string): number | undefined {
    const exp = getTokenClaims(accessToken).exp;
    return typeof exp === "number" ? exp : undefined;
}

function getTokenClaims(accessToken: string): AccessTokenClaims {
    try {
        const tokenParts = accessToken.split(".");
        if (tokenParts.length < 2) {
            return {};
        }

        const tokenBody = tokenParts[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(Buffer.from(tokenBody, "base64").toString("utf8")) ?? {};
    } catch {
        return {};
    }
}

function getTokenCacheKey(claims: AccessTokenClaims): string | undefined {
    if (!claims.aud || !claims.oid || !claims.tid) {
        return undefined;
    }
    return `${claims.tid}|${claims.oid}|${claims.aud}`;
}

export class MissingEntraAuthAccountError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MissingEntraAuthAccountError";
        // Set the prototype explicitly to maintain the correct prototype chain
        Object.setPrototypeOf(this, MissingEntraAuthAccountError.prototype);
    }
}
