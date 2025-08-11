/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { getSessionProviderForEnvironment } from "./helpers";

export class AccountProvider {
    readonly tokenOptions: TokenRequestOptions = {
        callerId: "vscode-fabric-identity",
        requestReason: vscode.l10n.t("Sign in to Microsoft Fabric."),
    };

    constructor(private tokenService: TokenAcquisitionService) {}

    async getToken(tenantId?: string): Promise<string | null> {
        return await this.tokenService.getMsAccessToken(
            {
                ...this.tokenOptions,
                silent: true,
            },
            undefined,
            tenantId ?? this._mostRecentlyUsedTenantId,
        );
    }
}

export class TokenAcquisitionService {
    public getMsAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null> {
        const currentEnv = "PROD"; // this.fabricEnvironmentProvider.getCurrent();
        const currentProvider = getSessionProviderForEnvironment(/*currentEnv.env*/);
        const fullScope = [
            ...this.vscodeSessionScopes(currentEnv.clientId, tenantId),
            ...currentEnv.scopes,
            ...(extraScopes ?? []),
        ];
        return this.getAccessToken(currentProvider, fullScope, options);
    }

    private vscodeSessionScopes(clientId: string, tenantId?: string): string[] {
        return [...this.vscodeClientScopes(clientId), ...this.vscodeTenantScopes(tenantId)];
    }

    private vscodeClientScopes(clientId?: string): string[] {
        if (!clientId) {
            return [];
        }
        return [`VSCODE_CLIENT_ID:${clientId}`];
    }

    private vscodeTenantScopes(tenantId?: string): string[] {
        return [tenantId ? `VSCODE_TENANT:${tenantId}` : "VSCODE_TENANT:common"];
    }

    private async getAccessToken(
        providerId: string,
        scopes: string[],
        options: TokenRequestOptions,
    ): Promise<string | null> {
        const session = await this.getSession(providerId, scopes, options);
        return session?.accessToken ?? null;
    }
}

export interface TokenRequestOptions extends vscode.AuthenticationGetSessionOptions {
    /**
     * Identifier of caller partner (ex. NuGet or AvailabilityService) that would be used for telemetry.
     */
    callerId: string;

    /**
     * Reason to request session from customer. This string could be displayed to customer in the future, so ideally should be localized.
     */
    requestReason: string;
}
