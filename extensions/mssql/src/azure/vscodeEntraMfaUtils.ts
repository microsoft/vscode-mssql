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

/** Time the user last cleared the Entra token cache, in seconds since the epoch. */
let tokenCacheClearedAt: number | undefined;

/**
 * Token accepted since the last clear, per resource, account and tenant. Any other token VS Code
 * returns, including an older one the broker still has cached, is stale.
 */
const tokensSinceClear = new Map<string, string>();

/**
 * Discards the VS Code accounts tokens the extension has seen. VS Code's auth provider cache
 * cannot be cleared from here, so the next request for each token is made with a claims challenge.
 */
export function clearVscodeEntraTokenCache(): void {
    tokenCacheClearedAt = Math.floor(Date.now() / 1000);
    tokensSinceClear.clear();
}

/**
 * Returns true if the access token was obtained before the Entra token cache was last cleared,
 * so it may not reflect group membership or PIM role changes made since then.
 */
export function isVscodeEntraTokenStale(accessToken: string | undefined): boolean {
    return (
        tokenCacheClearedAt !== undefined &&
        !!accessToken &&
        !Array.from(tokensSinceClear.values()).includes(accessToken)
    );
}

/** Forgets any token cache clear. For tests only. */
export function resetVscodeEntraTokenCacheForTest(): void {
    tokenCacheClearedAt = undefined;
    tokensSinceClear.clear();
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

    const clearedAt = tokenCacheClearedAt;
    const tokenKey = `${resourceEndpoint}|${account.id}|${resolvedTenantId}`;
    if (
        session &&
        clearedAt !== undefined &&
        session.accessToken !== tokensSinceClear.get(tokenKey)
    ) {
        session = await getSessionForAccount(
            {
                wwwAuthenticate: getForceRefreshChallenge(clearedAt),
                fallbackScopes: [resourceEndpoint],
            },
            resolvedTenantId,
            account,
        );

        if (session) {
            tokensSinceClear.set(tokenKey, session.accessToken);
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

/**
 * Challenge that makes VS Code's Microsoft auth provider skip its token cache. The native broker
 * (WAM on Windows) ignores `forceRefresh` and signing out does not remove its tokens, so a claims
 * request is the only way to get a new token before the cached one expires. The broker caches
 * tokens by the claims requested, so each clear asks for a token issued after it, in the format
 * Entra uses for continuous access evaluation challenges.
 */
function getForceRefreshChallenge(clearedAt: number): string {
    const claims = JSON.stringify({
        access_token: { nbf: { essential: true, value: String(clearedAt) } },
    });
    return `Bearer claims="${Buffer.from(claims).toString("base64")}"`;
}

function getTokenExpiration(accessToken: string): number | undefined {
    try {
        const tokenParts = accessToken.split(".");
        if (tokenParts.length < 2) {
            return undefined;
        }

        const tokenBody = tokenParts[1].replace(/-/g, "+").replace(/_/g, "/");
        const claims = JSON.parse(Buffer.from(tokenBody, "base64").toString("utf8"));
        return typeof claims.exp === "number" ? claims.exp : undefined;
    } catch {
        return undefined;
    }
}

export class MissingEntraAuthAccountError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MissingEntraAuthAccountError";
        // Set the prototype explicitly to maintain the correct prototype chain
        Object.setPrototypeOf(this, MissingEntraAuthAccountError.prototype);
    }
}
