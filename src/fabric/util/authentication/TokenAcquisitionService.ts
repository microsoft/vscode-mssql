/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from "@fabric/vscode-fabric-api";
import * as vscode from "vscode";
import { IFabricEnvironmentProvider } from "../settings/FabricEnvironmentProvider";
import {
    getSessionProviderForEnvironment,
    msSessionProvider,
    msSessionProviderPPE,
} from "./helpers";
import { TelemetryService } from "../telemetry/TelemetryService";
import { ILogger, LogImportance } from "../logger/Logger";
import { getConfiguredAzureEnv } from "@microsoft/vscode-azext-azureauth";

export interface ITokenAcquisitionService {
    getSessionInfo(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<vscode.AuthenticationSession | null>;
    getMsAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null>;
    getArmAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null>;
    msSessionChanged: vscode.Event<void>;
}

export class TokenAcquisitionService implements ITokenAcquisitionService, IDisposable {
    private readonly sessionsChangeEventHandle: IDisposable;
    private readonly msSessionChangedEmitter = new vscode.EventEmitter<void>();
    public readonly msSessionChanged = this.msSessionChangedEmitter.event;

    constructor(
        private readonly fabricEnvironmentProvider: IFabricEnvironmentProvider,
        private readonly logger: ILogger,
        private readonly telemetryService: TelemetryService | null,
        private readonly authentication?: VsCodeAuthentication,
    ) {
        this.authentication = authentication ?? new DefaultVsCodeAuthentication();
        this.sessionsChangeEventHandle = this.authentication.onDidChangeSessions((e) =>
            this.fireUpdate(e.provider.id),
        );
    }

    public async getSessionInfo(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<vscode.AuthenticationSession | null> {
        const currentEnv = this.fabricEnvironmentProvider.getCurrent();
        const currentProvider = getSessionProviderForEnvironment(currentEnv.env);
        const fullScope = [
            ...this.vscodeSessionScopes(currentEnv.clientId, tenantId),
            ...currentEnv.scopes,
            ...(extraScopes ?? []),
        ];
        const session = await this.getSession(currentProvider, fullScope, options);
        return session ?? null;
    }

    public getMsAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null> {
        const currentEnv = this.fabricEnvironmentProvider.getCurrent();
        const currentProvider = getSessionProviderForEnvironment(currentEnv.env);
        const fullScope = [
            ...this.vscodeSessionScopes(currentEnv.clientId, tenantId),
            ...currentEnv.scopes,
            ...(extraScopes ?? []),
        ];
        return this.getAccessToken(currentProvider, fullScope, options);
    }

    public getArmAccessToken(
        options: TokenRequestOptions,
        extraScopes?: string[],
        tenantId?: string,
    ): Promise<string | null> {
        const currentEnv = this.fabricEnvironmentProvider.getCurrent();
        const currentProvider = getSessionProviderForEnvironment(currentEnv.env);
        const configuredAzureEnv = getConfiguredAzureEnv();
        const endpoint = configuredAzureEnv.resourceManagerEndpointUrl;

        const fullScope = [
            ...this.vscodeSessionScopes(currentEnv.clientId, tenantId),
            endpoint + ".default",
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

    private async getSession(
        providerId: string,
        scopes: string[],
        options: TokenRequestOptions,
    ): Promise<vscode.AuthenticationSession | undefined> {
        try {
            if (!options || !options.callerId.trim() || !options.requestReason.trim()) {
                throw new Error("Please provide callerId and requestReason in TokenRequestOptions");
            }

            // In case there a session is not found, we would like to add a request reason to the modal dialog that will request it,
            // so we replace createIfNone with forceNewSession that behaves identically in this situation, but allows us to pass the request reason.
            if (options.createIfNone && !options.forceNewSession) {
                const session = await this.authentication?.getSession(providerId, scopes, {
                    silent: true,
                });
                if (session) {
                    return session;
                } else {
                    options.createIfNone = false;
                    options.forceNewSession = true;
                }
            }

            if (options.forceNewSession === true) {
                options.forceNewSession = { detail: options.requestReason };
            }

            return await this.authentication?.getSession(providerId, scopes, options);
        } catch (error: unknown) {
            const message = `Error getting session for ${options.callerId}: ${error}`;
            this.logger.log(message, LogImportance.high);

            const wrappedError =
                error instanceof Error ? error : new Error(String(error ?? message));
            this.logger.reportExceptionTelemetryAndLog(
                "getSession",
                "auth-error",
                wrappedError,
                this.telemetryService,
                { callerId: options.callerId },
            );
        }
    }

    private fireUpdate(providerId: string) {
        // We only care about the MS sessions
        switch (providerId) {
            case msSessionProvider:
            case msSessionProviderPPE:
                this.msSessionChangedEmitter.fire();
                break;
            default:
                break;
        }
    }

    public dispose(): void {
        this.msSessionChangedEmitter.dispose();
        this.sessionsChangeEventHandle.dispose();
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

export interface VsCodeAuthentication {
    getSession(
        providerId: string,
        scopes: readonly string[],
        options: vscode.AuthenticationGetSessionOptions,
    ): Thenable<vscode.AuthenticationSession | undefined>;

    onDidChangeSessions: vscode.Event<vscode.AuthenticationSessionsChangeEvent>;
}

export class DefaultVsCodeAuthentication implements VsCodeAuthentication {
    getSession(
        providerId: string,
        scopes: readonly string[],
        options: vscode.AuthenticationGetSessionOptions,
    ) {
        return vscode.authentication.getSession(providerId, scopes, options);
    }

    onDidChangeSessions: vscode.Event<vscode.AuthenticationSessionsChangeEvent> =
        vscode.authentication.onDidChangeSessions;
}
