/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { AzureTenant, getSessionFromVSCode } from "@microsoft/vscode-azext-azureauth";

import * as Constants from "../constants/constants";
import { FormItemOptions } from "../sharedInterfaces/form";
import { IToken } from "../models/contracts/azure";
import { getCloudProviderSettings } from "./providerSettings";
import { VsCodeAzureHelper, getDefaultTenantId } from "../connectionconfig/azureHelpers";
import * as locConstants from "../constants/locConstants";

export interface VscodeEntraSqlTokenInfo {
    account: vscode.AuthenticationSessionAccountInformation;
    session: vscode.AuthenticationSession;
    tenantId: string;
    token: IToken;
}

export function useVscodeAccountsForEntraMfa(): boolean {
    return vscode.workspace
        .getConfiguration()
        .get<boolean>(Constants.configUseVscodeAccountsForEntraMfa, false);
}

/**
 * Determines if the provided account IDs are compatible, meaning they are either exactly the same or one is a prefix of the other.
 */
export function areCompatibleEntraAccountIds(
    currentAccountId?: string,
    expectedAccountId?: string,
): boolean {
    return (
        !!currentAccountId &&
        !!expectedAccountId &&
        (currentAccountId === expectedAccountId ||
            currentAccountId.startsWith(expectedAccountId) ||
            expectedAccountId.startsWith(currentAccountId))
    );
}

export async function getVscodeEntraAccountOptions(): Promise<FormItemOptions[]> {
    const accounts = await VsCodeAzureHelper.getAccounts();
    return accounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));
}

export async function resolveVscodeEntraAccount(
    accountId?: string,
    accountLabel?: string,
): Promise<vscode.AuthenticationSessionAccountInformation | undefined> {
    const accounts = await VsCodeAzureHelper.getAccounts();

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
        return accounts.find((account) => account.label === accountLabel);
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

export async function acquireSqlAccessTokenFromVscodeAccount(
    accountId?: string,
    tenantId?: string,
    accountLabel?: string,
): Promise<VscodeEntraSqlTokenInfo> {
    const account = await resolveVscodeEntraAccount(accountId, accountLabel);
    if (!account) {
        throw new MissingVsCodeEntraAuthError(
            locConstants.Accounts.accountNotAvailableThroughVsCode(
                accountLabel ?? accountId ?? "",
                tenantId ?? "",
            ),
        );
    }

    const tenants = await VsCodeAzureHelper.getTenantsForAccount(account);
    const resolvedTenantId =
        tenantId && tenants.some((tenant) => tenant.tenantId === tenantId)
            ? tenantId
            : getDefaultTenantId(account.id, tenants);

    if (!resolvedTenantId) {
        throw new MissingVsCodeEntraAuthError(
            locConstants.Accounts.accountNotAvailableThroughVsCode(
                accountLabel ?? accountId ?? "",
                tenantId ?? "",
            ),
        );
    }

    const cloudSettings = getCloudProviderSettings();
    const sqlResource = cloudSettings.settings.sqlResource;
    if (!sqlResource) {
        throw new Error(
            locConstants.Azure.noSqlResourceConfiguredForCurrentCloud(cloudSettings.displayName),
        );
    }

    const session =
        (await getSessionFromVSCode(sqlResource.endpoint, resolvedTenantId, {
            createIfNone: false,
            silent: true,
            account,
        })) ??
        (await getSessionFromVSCode(sqlResource.endpoint, resolvedTenantId, {
            createIfNone: true,
            account,
        }));

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

export class MissingVsCodeEntraAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MissingVsCodeEntraAuthError";
        // Set the prototype explicitly to maintain the correct prototype chain
        Object.setPrototypeOf(this, MissingVsCodeEntraAuthError.prototype);
    }
}
