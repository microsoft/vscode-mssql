/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { IDisposable } from "@fabric/vscode-fabric-api";
import { ITokenAcquisitionService, TokenRequestOptions } from "./TokenAcquisitionService";
import { AuthenticationSessionAccountInformation } from "vscode";
import { doTaskWithTimeout } from "../fabricUtilities";
import { SubscriptionClient, TenantIdDescription } from "@azure/arm-resources-subscriptions";
import type { TokenCredential } from "@azure/core-auth";
import { getConfiguredAzureEnv } from "@microsoft/vscode-azext-azureauth";

export interface ITenantSettings {
    tenantId: string;
    displayName: string;
    defaultDomain: string;
}

export interface IAccountProvider {
    getTenants(): Promise<ITenantSettings[]>;
    getCurrentTenant(): Promise<ITenantSettings | undefined>;
    onTenantChanged: vscode.Event<void>;

    getToken(tenantId?: string): Promise<string | null>;
    signIn(tenantId?: string): Promise<boolean>;
    isSignedIn(tenantId?: string): Promise<boolean>;

    getDefaultTelemetryProperties(): Promise<{ [key: string]: string }>;
    onSignInChanged: vscode.Event<void>;
    awaitSignIn(): Promise<void>;
}

export class AccountProvider implements IAccountProvider, IDisposable {
    private readonly onSuccessfulSignInEmitter = new vscode.EventEmitter<void>();
    private readonly onSuccessfulSignIn = this.onSuccessfulSignInEmitter.event;

    readonly onSignInChangedEmitter = new vscode.EventEmitter<void>();
    readonly onSignInChanged = this.onSignInChangedEmitter.event;

    readonly onTenantChangedEmitter = new vscode.EventEmitter<void>();
    readonly onTenantChanged = this.onTenantChangedEmitter.event;

    readonly sessionChangedListener: vscode.Disposable;

    private signInState: boolean | undefined = undefined;
    private mutex = new Mutex();

    // By default, use the most recently used tenantId is undefined,
    // which will default to the users "home" tenant. If they choose to
    // "Switch tenant..." then the mostRecentlyUsedTenantId will be updated
    // and that one should be used for all subsequent calls.
    private _mostRecentlyUsedTenantId: string | undefined = undefined;

    readonly tokenOptions: TokenRequestOptions = {
        callerId: "vscode-fabric-identity",
        requestReason: vscode.l10n.t("Sign in to Microsoft Fabric."),
    };

    constructor(private tokenService: ITokenAcquisitionService) {
        this.sessionChangedListener = this.tokenService.msSessionChanged(async () => {
            await this.mutex.acquire();
            try {
                const currentState = this.signInState;
                const newState = await this.isSignedIn();
                if (currentState !== newState) {
                    this.signInState = newState;
                    this.onSignInChangedEmitter.fire();
                }
                if (!newState) {
                    // If new state is false, user has signed out
                    this._mostRecentlyUsedTenantId = undefined;
                    this.onTenantChangedEmitter.fire();
                }
            } finally {
                this.mutex.release(); // release the mutex after checking the sign-in state
            }
        });
    }

    /**
     * Gets the currently selected tenant based on _mostRecentlyUsedTenantId
     * @returns The current tenant settings, or undefined if not found or not signed in
     */
    async getCurrentTenant(): Promise<ITenantSettings | undefined> {
        if (!this._mostRecentlyUsedTenantId) {
            return undefined;
        }

        try {
            const tenants = await this.getTenants();
            return tenants.find((tenant) => tenant.tenantId === this._mostRecentlyUsedTenantId);
        } catch (error) {
            // If there's an error getting tenants (e.g., user not signed in)
            return undefined;
        }
    }

    // Always get list of tenants using a token from users "home" tenant.
    // Home tenant is the default tenant when not specified.
    // If the user has not signed in, they will be prompted to sign in.
    async getTenants(): Promise<ITenantSettings[]> {
        const tenants: ITenantSettings[] = [];

        const token = await this.tokenService.getArmAccessToken({
            callerId: "vscode-fabric-identity",
            requestReason: vscode.l10n.t("Get Entra tenants from Azure."),
            createIfNone: true,
        });

        if (!token) {
            return tenants;
        }

        // get tenants from azure sdk
        const credential: TokenCredential = {
            getToken: async (scopes: string | string[], options?: any) => {
                return {
                    token: token,
                    expiresOnTimestamp: 0,
                };
            },
        };

        const configuredAzureEnv = getConfiguredAzureEnv();
        const endpoint = configuredAzureEnv.resourceManagerEndpointUrl;
        var subscriptionClient = new SubscriptionClient(credential, { endpoint });

        for await (const tenant of subscriptionClient.tenants.list()) {
            if (!tenant.tenantId) {
                continue;
            }
            tenants.push({
                tenantId: tenant.tenantId,
                displayName: tenant.displayName ?? "",
                defaultDomain: tenant.defaultDomain ?? "",
            });
        }

        return tenants;
    }

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

    async getAccountInfo(askToSignIn: boolean = false, tenantId?: string) {
        const session = await this.tokenService.getSessionInfo(
            {
                ...this.tokenOptions,
                silent: !askToSignIn,
                createIfNone: askToSignIn,
            },
            undefined,
            tenantId ?? this._mostRecentlyUsedTenantId,
        );

        return session?.account ?? null;
    }

    async signIn(tenantId?: string): Promise<boolean> {
        const account = await this.getAccountInfo(/*askToSignIn = */ true, tenantId);
        const result: boolean = !!account;
        if (result) {
            this.onSuccessfulSignInEmitter.fire();

            // If successfully signed in to a specific tenant, remember that tenantId
            if (tenantId && this._mostRecentlyUsedTenantId !== tenantId) {
                this._mostRecentlyUsedTenantId = tenantId;
                this.onTenantChangedEmitter.fire();
            }
        }
        return result;
    }

    async isSignedIn(tenantId?: string): Promise<boolean> {
        const account = await this.getAccountInfo(/*askToSignIn = */ false, tenantId);
        return !!account;
    }

    /// <summary>
    /// Get the default telemetry properties for the user. This will include the tenantId and whether the user is a Microsoft internal user.
    /// </summary>
    async getDefaultTelemetryProperties(): Promise<{ [key: string]: string }> {
        let result: { [key: string]: string } = {};
        let email: string | null = null;
        const requestOptions: TokenRequestOptions = {
            ...this.tokenOptions,
            silent: true,
        };
        // code from here: https://devdiv.visualstudio.com/DevDiv/_git/vs-green?path=/src/telemetry/TelemetryService.ts&version=GBmain&line=300&lineEnd=301&lineStartColumn=1&lineEndColumn=1&lineStyle=plain&_a=contents
        // Get the entitlements session object. This will have the id token which will have the information we need
        const session = await this.tokenService.getSessionInfo(
            requestOptions,
            undefined,
            this._mostRecentlyUsedTenantId,
        );
        if (session) {
            let decodedToken = "";
            try {
                // @ts-ignore: the idToken property not documented by VS Code but exists on the AuthenticationSession. The AccessToken does exist, but doesn't have the id info
                const tokenBody = session?.idToken.split(".")[1];
                decodedToken = Buffer.from(tokenBody, "base64").toString("binary");
                // eslint-disable-next-line @typescript-eslint/naming-convention
                const parsedToken = JSON.parse(decodedToken) as {
                    email?: string;
                    tid?: string;
                    preferred_username?: string;
                };
                email = parsedToken?.email ?? parsedToken?.preferred_username ?? ""; // some users have email empty, but preferred_username has email (some Mac machines)
                result.tenantid = parsedToken?.tid ?? "";
            } catch (error) {
                // TODO
                // extensionVariables.serviceCollection.logger.log(`Unable to parse token: ${decodedToken}`);
            }
        }
        result.isMicrosoftInternal = "false";
        if (email) {
            var emailParts = email.split("@");
            if (emailParts.length === 2) {
                if (emailParts[1]?.toLowerCase() === "microsoft.com") {
                    result.isMicrosoftInternal = "true";
                    const alias = emailParts[0];
                    result.useralias = alias; // for internal users we log the alias (visual studio telemetry does that too)
                }
            } else {
                // TODO
                // extensionVariables.serviceCollection.logger.log(`Invalid email address format: ${email}`);
            }
        }
        return result;
    }

    // TODO: this should not be here, but in a utility class in vscode-fabric ??
    public async awaitSignIn(): Promise<void> {
        if (!(await this.isSignedIn(this._mostRecentlyUsedTenantId))) {
            let evListener: vscode.Disposable | null = null;
            const taskListenLogin = new Promise<void>((resolve, reject) => {
                evListener = this.onSuccessfulSignIn(() => {
                    evListener?.dispose(); // we don't want to leak
                    resolve();
                });
            });

            // TODO this is a magic string and should be a constant in API or Util package?
            await vscode.commands.executeCommand(
                "vscode-fabric.signIn",
                this._mostRecentlyUsedTenantId,
            );

            await doTaskWithTimeout(taskListenLogin, 60000, "Timeout logging in"); // allow one minute to sign in, (browser acivate, enter username/password, 2fa, etc)
        }
    }

    dispose(): void {
        this.onSuccessfulSignInEmitter.dispose();
        this.onSignInChangedEmitter.dispose();
        this.onTenantChangedEmitter.dispose();
        this.sessionChangedListener.dispose();
    }
}

class Mutex {
    private isLocked = false;
    private waiting: (() => void)[] = [];

    async acquire(): Promise<void> {
        if (this.isLocked) {
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        }
        this.isLocked = true;
    }

    release(): void {
        if (!this.isLocked) {
            throw new Error("Cannot release an unlocked mutex");
        }
        this.isLocked = false;
        const next = this.waiting.shift();
        if (next) {
            next();
        }
    }
}
