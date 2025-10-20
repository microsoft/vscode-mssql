/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ClientAuthError, ILoggerCallback, LogLevel as MsalLogLevel } from "@azure/msal-common";
import { Configuration, PublicClientApplication } from "@azure/msal-node";
import * as Constants from "../../constants/constants";
import * as LocalizedConstants from "../../constants/locConstants";
import { ConnectionProfile } from "../../models/connectionProfile";
import { AzureAuthType, IAADResource, IAccount, IToken } from "../../models/contracts/azure";
import { AccountStore } from "../accountStore";
import { AzureController } from "../azureController";
import { getEnableSqlAuthenticationProviderConfig } from "../utils";
import { MsalAzureAuth } from "./msalAzureAuth";
import { MsalAzureCodeGrant } from "./msalAzureCodeGrant";
import { MsalAzureDeviceCode } from "./msalAzureDeviceCode";
import { MsalCachePluginProvider } from "./msalCachePlugin";
import { promises as fsPromises } from "fs";
import * as path from "path";
import * as AzureConstants from "../constants";
import { getErrorMessage } from "../../utils/utils";
import {
    CloudId,
    getAzureEnvironment,
    getAzureEnvironmentAdditions,
    getCloudId,
    getCloudProviderSettings,
} from "../providerSettings";
import { Deferred } from "../../protocol";
import { IPrompter } from "../../prompts/question";
import { ICredentialStore } from "../../credentialstore/icredentialstore";
import * as azureUtils from ".././utils";
import VscodeWrapper from "../../controllers/vscodeWrapper";
import { Logger } from "../../models/logger";

export class MsalAzureController extends AzureController {
    private _cachePluginProvider: MsalCachePluginProvider;

    private _cloudAuthMappings: Map<CloudId, CloudAuthApplication> = new Map();

    private getLoggerCallback(): ILoggerCallback {
        return (level: number, message: string, containsPii: boolean) => {
            if (!containsPii) {
                switch (level) {
                    case MsalLogLevel.Error:
                        this.logger.error(message);
                        break;
                    case MsalLogLevel.Info:
                        this.logger.info(message);
                        break;
                    case MsalLogLevel.Verbose:
                    default:
                        this.logger.verbose(message);
                        break;
                }
            } else {
                this.logger.pii(message);
            }
        };
    }

    private _storagePath: string;

    public initialized: Deferred<void> = new Deferred<void>();

    constructor(
        protected context: vscode.ExtensionContext,
        protected prompter: IPrompter,
        protected _credentialStore: ICredentialStore,
        protected _subscriptionClientFactory: azureUtils.SubscriptionClientFactory = azureUtils.defaultSubscriptionClientFactory,
    ) {
        super(context, prompter, _credentialStore, _subscriptionClientFactory);

        void this.initialize();
    }

    private async initialize(): Promise<void> {
        this._storagePath = await this.findOrMakeStoragePath();

        this._cachePluginProvider = new MsalCachePluginProvider(
            Constants.msalCacheFileName,
            this._storagePath,
            this._vscodeWrapper,
            this.logger,
            this._credentialStore,
        );

        let cloudIds = Object.values(CloudId);

        // Check if custom cloud is configured. If not, don't initialize it.
        // We check the settings directly because already-saved connections may still reference the custom cloud.
        try {
            getAzureEnvironment();
            getAzureEnvironmentAdditions();
        } catch {
            cloudIds = cloudIds.filter((c) => c !== CloudId.Custom);
        }

        for (const cloudId of cloudIds) {
            const cloudAuthApp = new CloudAuthApplication(
                cloudId,
                this._cachePluginProvider,
                this.getLoggerCallback(),
                this.context,
                this._vscodeWrapper,
                this.logger,
            );

            this._cloudAuthMappings.set(cloudId, cloudAuthApp);
        }

        this.initialized.resolve();
    }

    public init(): void {
        // Since this setting is only applicable to MSAL, we can enable it safely only for MSAL Controller
        if (getEnableSqlAuthenticationProviderConfig()) {
            this._isSqlAuthProviderEnabled = true;
        }
    }

    public async loadTokenCache(): Promise<void> {
        await this.clearOldCacheIfExists();

        for (const cloud of this._cloudAuthMappings.values()) {
            await cloud.loadTokenCache();
        }
    }

    public async clearTokenCache(): Promise<void> {
        for (const cloud of this._cloudAuthMappings.values()) {
            cloud.clientApplication.clearCache();
        }

        await this._cachePluginProvider.unlinkMsalCache();
        await this._cachePluginProvider.clearCacheEncryptionKeys(); // Delete Encryption Keys
    }

    /**
     * Clears old cache file that is no longer needed on system.
     */
    private async clearOldCacheIfExists(): Promise<void> {
        await this.initialized;
        const filePath = path.join(this._storagePath, AzureConstants.oldMsalCacheFileName);

        try {
            await fsPromises.access(filePath);
            await fsPromises.rm(filePath);
            this.logger.verbose(`Old cache file removed successfully.`);
        } catch (e) {
            if (e.code !== "ENOENT") {
                this.logger.verbose(`Error occurred while removing old cache file: ${e}`);
            } // else file doesn't exist.
        }
    }

    public async login(authType: AzureAuthType, cloud?: CloudId): Promise<IAccount | undefined> {
        const cloudAuth = this.getCloudAuthApp(cloud);

        const response = await cloudAuth.msalAuthInstance(authType).startLogin();

        if (response.success === true) {
            return response.account;
        } else {
            this.logger.error(`Login failed: ${response.error}`);
            return undefined;
        }
    }

    public async isAccountInCache(account: IAccount): Promise<boolean> {
        let cloudAuth = this.getCloudAuthForAccount(account);

        await this.clearOldCacheIfExists();
        let accountInfo = await cloudAuth
            .msalAuthInstance(account.properties.azureAuthType)
            .getAccountFromMsalCache(account.key.id);
        return accountInfo !== undefined;
    }

    private getCloudAuthApp(cloud?: CloudId): CloudAuthApplication {
        return this._cloudAuthMappings.get(cloud || getCloudId())!;
    }

    private getCloudAuthForAccount(account: IAccount): CloudAuthApplication | undefined {
        const cloudId = getCloudId(account.key.providerId);
        return this.getCloudAuthApp(cloudId);
    }

    public async getAccountSecurityToken(
        account: IAccount,
        tenantId: string,
        settings: IAADResource,
    ): Promise<IToken | undefined> {
        let cloudAuth = this.getCloudAuthForAccount(account);

        if (cloudAuth) {
            this.logger.piiSanitized(
                `Getting account security token for ${JSON.stringify(account?.key)} (tenant ${tenantId}). Auth Method = ${AzureAuthType[account?.properties.azureAuthType]}`,
                [],
                [],
            );
            tenantId = tenantId || account.properties.owningTenant.id;
            let result = await cloudAuth
                .msalAuthInstance(account.properties.azureAuthType)
                .getToken(account, tenantId, settings);
            if (!result || !result.account || !result.account.idTokenClaims) {
                this.logger.error(`MSAL: getToken call failed`);
                throw Error("Failed to get token");
            } else {
                const token: IToken = {
                    key: result.account.homeAccountId,
                    token: result.accessToken,
                    tokenType: result.tokenType,
                    expiresOn: result.account.idTokenClaims.exp,
                };
                return token;
            }
        } else {
            if (account) {
                account.isStale = true;
                this.logger.error(
                    `_getAccountSecurityToken: Authentication method not found for account ${account.displayInfo.displayName}`,
                );
                throw Error(LocalizedConstants.msgAuthTypeNotFound);
            } else {
                this.logger.error(
                    `_getAccountSecurityToken: Authentication method not found as account not available.`,
                );
                throw Error(LocalizedConstants.msgAccountNotFound);
            }
        }
    }

    public async refreshAccessToken(
        account: IAccount,
        accountStore: AccountStore,
        tenantId: string | undefined,
        settings: IAADResource,
    ): Promise<IToken | undefined> {
        let newAccount: IAccount;
        try {
            const cloudAuth = this.getCloudAuthForAccount(account);
            newAccount = await cloudAuth
                .msalAuthInstance(account.properties.azureAuthType)
                .refreshAccessToken(
                    account,
                    AzureConstants.organizationTenant.id,
                    getCloudProviderSettings(account.key.providerId).settings
                        .windowsManagementResource,
                );

            if (newAccount!.isStale === true) {
                return undefined;
            }

            await accountStore.addAccount(newAccount!);
            return await this.getAccountSecurityToken(
                account,
                tenantId ?? account.properties.owningTenant.id,
                settings,
            );
        } catch (ex) {
            if (
                ex instanceof ClientAuthError &&
                ex.errorCode === AzureConstants.noAccountInSilentRequestError
            ) {
                try {
                    // Account needs re-authentication
                    newAccount = await this.login(
                        account.properties.azureAuthType,
                        getCloudId(account.key.providerId),
                    );
                    if (newAccount!.isStale === true) {
                        return undefined;
                    }
                    await accountStore.addAccount(newAccount!);
                    return await this.getAccountSecurityToken(
                        account,
                        tenantId ?? account.properties.owningTenant.id,
                        settings,
                    );
                } catch (ex) {
                    this._vscodeWrapper.showErrorMessage(ex);
                }
            }
            if (getErrorMessage(ex).includes(AzureConstants.multiple_matching_tokens_error)) {
                const response = await this._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.ConnectionDialog.multipleMatchingTokensError(
                        account?.displayInfo?.displayName,
                        tenantId,
                    ),
                    LocalizedConstants.ConnectionDialog.clearCacheAndRefreshToken,
                    LocalizedConstants.Common.cancel,
                );
                if (response === LocalizedConstants.msgYes) {
                    await this.clearTokenCache();
                    return await this.refreshAccessToken(account, accountStore, tenantId, settings);
                }
            } else {
                this._vscodeWrapper.showErrorMessage(ex);
            }
        }
    }

    /**
     * Gets the token for given account and updates the connection profile with token information needed for AAD authentication
     */
    public async populateAccountProperties(
        profile: ConnectionProfile,
        accountStore: AccountStore,
        settings: IAADResource,
    ): Promise<ConnectionProfile> {
        let account = await this.addAccount(accountStore);
        profile.user = account!.displayInfo.displayName;
        profile.email = account!.displayInfo.email;
        profile.accountId = account!.key.id;

        // Skip fetching access token for profile if Sql Authentication Provider is enabled.
        if (!this.isSqlAuthProviderEnabled()) {
            if (!profile.tenantId) {
                await this.promptForTenantChoice(account!, profile);
            }

            const token = await this.getAccountSecurityToken(account!, profile.tenantId, settings);

            if (!token) {
                let errorMessage = LocalizedConstants.msgGetTokenFail;
                this.logger.error(errorMessage);
                this._vscodeWrapper.showErrorMessage(errorMessage);
            } else {
                profile.azureAccountToken = token.token;
                profile.expiresOn = token.expiresOn;
            }
        } else {
            this.logger.verbose(
                "SQL Authentication Provider is enabled, access token will not be acquired by extension.",
            );
        }
        return profile;
    }

    public async removeAccount(account: IAccount): Promise<void> {
        const cloudAuth = this.getCloudAuthForAccount(account);
        await cloudAuth
            .msalAuthInstance(account.properties.azureAuthType)
            .clearCredentials(account);
    }

    public async handleAuthMapping(cloudId?: CloudId): Promise<void> {
        if (cloudId) {
            return await this.handleAuthMappingHelper(cloudId);
        } else {
            for (const cloud of Object.values(CloudId)) {
                await this.handleAuthMappingHelper(cloud);
            }
            return;
        }
    }

    private async handleAuthMappingHelper(_cloudId: CloudId): Promise<void> {
        await this.initialized;
    }
}

/**
 * Class to handle authentication for a given Azure cloud
 */
export class CloudAuthApplication {
    private _authMappings: Map<AzureAuthType, MsalAzureAuth>;
    private _clientApplication: PublicClientApplication;

    public get clientApplication(): PublicClientApplication {
        return this._clientApplication;
    }

    public msalAuthInstance(authType: AzureAuthType): MsalAzureAuth {
        if (!this._authMappings.has(authType)) {
            if (authType === AzureAuthType.AuthCodeGrant) {
                this._authMappings.set(
                    AzureAuthType.AuthCodeGrant,
                    new MsalAzureCodeGrant(
                        getCloudProviderSettings(this.cloudId),
                        this.context,
                        this.clientApplication,
                        this.vscodeWrapper,
                        this.logger,
                    ),
                );
            } else if (authType === AzureAuthType.DeviceCode) {
                this._authMappings.set(
                    AzureAuthType.DeviceCode,
                    new MsalAzureDeviceCode(
                        getCloudProviderSettings(this.cloudId),
                        this.context,
                        this.clientApplication,
                        this.vscodeWrapper,
                        this.logger,
                    ),
                );
            }
        }

        return this._authMappings.get(authType)!;
    }

    constructor(
        public readonly cloudId: CloudId,
        private _cachePluginProvider: MsalCachePluginProvider,
        private loggerCallback: ILoggerCallback,
        private readonly context: vscode.ExtensionContext,
        private readonly vscodeWrapper: VscodeWrapper,
        private readonly logger: Logger,
    ) {
        this._authMappings = new Map<AzureAuthType, MsalAzureAuth>();
        this.createClientApplication();
    }

    public async loadTokenCache(): Promise<void> {
        // both MSAL auth types share the same client application, so loading its cache directly covers both auth types
        const cache = this._clientApplication.getTokenCache();
        void cache.getAllAccounts();
    }

    private createClientApplication() {
        const msalConfiguration: Configuration = {
            auth: {
                clientId: getCloudProviderSettings(this.cloudId).clientId,
                authority: vscode.Uri.joinPath(
                    vscode.Uri.parse(getCloudProviderSettings(this.cloudId).loginEndpoint),
                    "common",
                ).toString(),
            },
            system: {
                loggerOptions: {
                    loggerCallback: this.loggerCallback,
                    logLevel: MsalLogLevel.Trace,
                    piiLoggingEnabled: true,
                },
            },
            cache: {
                cachePlugin: this._cachePluginProvider?.getCachePlugin(),
            },
        };
        this._clientApplication = new PublicClientApplication(msalConfiguration);
    }
}
