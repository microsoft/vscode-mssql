/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import * as vscode from "vscode";
import { AzureTenant, getSessionFromVSCode } from "@microsoft/vscode-azext-azureauth";

import { FormItemOptions } from "../sharedInterfaces/form";
import { IProviderResources, IToken } from "../models/contracts/azure";
import { getCloudProviderSettings } from "./providerSettings";
import { VsCodeAzureHelper, getDefaultTenantId } from "../connectionconfig/azureHelpers";
import * as locConstants from "../constants/locConstants";
import { getLogger } from "../models/logger";
import { epochToDisplay } from "../models/utils";
import { getErrorMessage } from "../utils/utils";

const logger = getLogger("Entra Auth");

export interface VscodeEntraSqlTokenInfo {
    account: vscode.AuthenticationSessionAccountInformation;
    session: vscode.AuthenticationSession;
    tenantId: string;
    token: IToken;
}

interface TokenCacheClearState {
    /** Time the user last cleared the Entra token cache, in seconds since the epoch. */
    clearedAt: number;
    /**
     * SHA-256 hash of the token accepted since the clear, per resource, account and tenant. Any
     * other token VS Code returns, including an older one the broker still has cached, is stale.
     */
    tokenHashes: Record<string, string>;
}

/** Global state key that keeps the last clear across window reloads. */
export const tokenCacheClearStateKey = "mssql.entraTokenCacheClear";

/**
 * Longest an Entra access token can be valid (28 hours, for continuous access evaluation tokens).
 * After this, no token issued before the clear can be returned, so the clear no longer applies.
 */
const maxAccessTokenLifetimeSeconds = 28 * 60 * 60;

let clearStateStore: vscode.Memento | undefined;
let clearState: TokenCacheClearState | undefined;

/**
 * Restores the last token cache clear from global state. The broker keeps tokens across window
 * reloads, so without this a reload would let it return a token cached before the clear.
 */
export function initializeVscodeEntraTokenCacheState(store: vscode.Memento): void {
    clearStateStore = store;
    clearState = store.get<TokenCacheClearState>(tokenCacheClearStateKey);
}

/**
 * Discards the VS Code accounts tokens the extension has seen. VS Code's auth provider cache
 * cannot be cleared from here, so the next request for each token is made with a claims challenge.
 */
export async function clearVscodeEntraTokenCache(): Promise<void> {
    // Each clear needs its own challenge, so never reuse the previous clear's time.
    const clearedAt = Math.max(nowInSeconds(), (getClearState()?.clearedAt ?? 0) + 1);
    clearState = { clearedAt, tokenHashes: {} };
    logger.info(
        `VS Code accounts token cache cleared at ${clearedAt}; the next request for each token will force a refresh.`,
    );
    await saveClearState();
}

/**
 * Returns true if the access token was obtained before the Entra token cache was last cleared,
 * so it may not reflect group membership or PIM role changes made since then.
 */
export function isVscodeEntraTokenStale(accessToken: string | undefined): boolean {
    const state = getClearState();
    return (
        state !== undefined &&
        !!accessToken &&
        !Object.values(state.tokenHashes).includes(hashToken(accessToken))
    );
}

/** Forgets any token cache clear. For tests only. */
export function resetVscodeEntraTokenCacheForTest(): void {
    clearStateStore = undefined;
    clearState = undefined;
}

function getClearState(): TokenCacheClearState | undefined {
    if (clearState && nowInSeconds() - clearState.clearedAt > maxAccessTokenLifetimeSeconds) {
        return undefined;
    }
    return clearState;
}

async function saveClearState(): Promise<void> {
    try {
        await clearStateStore?.update(tokenCacheClearStateKey, clearState);
    } catch (error) {
        logger.error(`Failed to save the Entra token cache clear: ${getErrorMessage(error)}`);
    }
}

function hashToken(accessToken: string): string {
    return crypto.createHash("sha256").update(accessToken).digest("base64");
}

function nowInSeconds(): number {
    return Math.floor(Date.now() / 1000);
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

    const state = getClearState();
    const clearedAt = state?.clearedAt;
    const tokenKey = `${resourceEndpoint}|${account.id}|${resolvedTenantId}`;
    if (
        session &&
        clearedAt !== undefined &&
        hashToken(session.accessToken) !== state?.tokenHashes[tokenKey]
    ) {
        const cachedToken = session.accessToken;
        logger.info(
            `Forcing a token refresh for ${resourceEndpoint} with tenantId '${resolvedTenantId}' because the token cache was cleared at ${clearedAt}; cached token expires on ${describeExpiry(cachedToken)}`,
        );

        session = await getSessionForAccount(
            {
                wwwAuthenticate: getForceRefreshChallenge(clearedAt),
                fallbackScopes: [resourceEndpoint],
            },
            resolvedTenantId,
            account,
        );

        if (session) {
            if (session.accessToken === cachedToken) {
                logger.warn(
                    `VS Code returned the cached token for ${resourceEndpoint} again after a forced refresh; it may not reflect recent group or role changes.`,
                );
            } else {
                // If the cache was cleared again during the refresh, this token predates that clear.
                if (clearState?.clearedAt === clearedAt) {
                    clearState.tokenHashes[tokenKey] = hashToken(session.accessToken);
                    await saveClearState();
                }
                logger.info(
                    `Got a new token for ${resourceEndpoint} after a forced refresh; expires on ${describeExpiry(session.accessToken)}`,
                );
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
    scopeOrRequest: string | vscode.AuthenticationWwwAuthenticateRequest,
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

function describeExpiry(accessToken: string): string {
    const expiresOn = getTokenExpiration(accessToken);
    if (expiresOn === undefined) {
        return "unknown";
    }
    const expiry = epochToDisplay(expiresOn * 1000);
    return `${expiresOn} (${expiry.iso}, ${expiry.relative})`;
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
