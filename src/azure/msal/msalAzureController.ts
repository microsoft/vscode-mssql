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
import { getAzureActiveDirectoryConfig, getEnableSqlAuthenticationProviderConfig } from "../utils";
import { MsalAzureAuth } from "./msalAzureAuth";
import { MsalAzureCodeGrant } from "./msalAzureCodeGrant";
import { MsalAzureDeviceCode } from "./msalAzureDeviceCode";
import { MsalCachePluginProvider } from "./msalCachePlugin";
import { promises as fsPromises } from "fs";
import * as path from "path";
import * as AzureConstants from "../constants";
import { getErrorMessage } from "../../utils/utils";
import { getCloudSettings } from "../providerSettings";

export class MsalAzureController extends AzureController {
    private _authMappings = new Map<AzureAuthType, MsalAzureAuth>();
    private _cachePluginProvider: MsalCachePluginProvider | undefined = undefined;
    protected clientApplication: PublicClientApplication;

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

    public init(): void {
        // Since this setting is only applicable to MSAL, we can enable it safely only for MSAL Controller
        if (getEnableSqlAuthenticationProviderConfig()) {
            this._isSqlAuthProviderEnabled = true;
        }
    }

    public async loadTokenCache(): Promise<void> {
        let authType = getAzureActiveDirectoryConfig();
        if (!this._authMappings.has(authType)) {
            await this.handleAuthMapping();
        }

        let azureAuth = await this.getAzureAuthInstance(authType!);
        await this.clearOldCacheIfExists();
        void azureAuth.loadTokenCache();
    }

    public async clearTokenCache(): Promise<void> {
        this.clientApplication.clearCache();
        await this._cachePluginProvider.unlinkMsalCache();

        // Delete Encryption Keys
        await this._cachePluginProvider.clearCacheEncryptionKeys();
    }

    /**
     * Clears old cache file that is no longer needed on system.
     */
    private async clearOldCacheIfExists(): Promise<void> {
        let filePath = path.join(
            await this.findOrMakeStoragePath(),
            AzureConstants.oldMsalCacheFileName,
        );
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

    public async login(authType: AzureAuthType): Promise<IAccount | undefined> {
        let azureAuth = await this.getAzureAuthInstance(authType);
        let response = await azureAuth!.startLogin();
        return response ? (response as IAccount) : undefined;
    }

    public async isAccountInCache(account: IAccount): Promise<boolean> {
        let authType = getAzureActiveDirectoryConfig();
        let azureAuth = await this.getAzureAuthInstance(authType!);
        await this.clearOldCacheIfExists();
        let accountInfo = await azureAuth.getAccountFromMsalCache(account.key.id);
        return accountInfo !== undefined;
    }

    private async getAzureAuthInstance(
        authType: AzureAuthType,
    ): Promise<MsalAzureAuth | undefined> {
        if (!this._authMappings.has(authType)) {
            await this.handleAuthMapping();
        }
        return this._authMappings!.get(authType);
    }

    public async getAccountSecurityToken(
        account: IAccount,
        tenantId: string,
        settings: IAADResource,
    ): Promise<IToken | undefined> {
        let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
        if (azureAuth) {
            this.logger.piiSanitized(
                `Getting account security token for ${JSON.stringify(account?.key)} (tenant ${tenantId}). Auth Method = ${AzureAuthType[account?.properties.azureAuthType]}`,
                [],
                [],
            );
            tenantId = tenantId || account.properties.owningTenant.id;
            let result = await azureAuth.getToken(account, tenantId, settings);
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
            let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
            newAccount = await azureAuth!.refreshAccessToken(
                account,
                AzureConstants.organizationTenant.id,
                getCloudSettings(account.key.providerId).resources.windowsManagementResource,
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
                    newAccount = await this.login(account.properties.azureAuthType);
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
                    LocalizedConstants.ConnectionDialog.ClearCacheAndRefreshToken,
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
        let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
        await azureAuth!.clearCredentials(account);
    }

    public async handleAuthMapping(): Promise<void> {
        if (!this.clientApplication) {
            let storagePath = await this.findOrMakeStoragePath();
            this._cachePluginProvider = new MsalCachePluginProvider(
                Constants.msalCacheFileName,
                storagePath!,
                this._vscodeWrapper,
                this.logger,
                this._credentialStore,
            );
            const msalConfiguration: Configuration = {
                auth: {
                    clientId: getCloudSettings().clientId,
                    authority: vscode.Uri.joinPath(
                        vscode.Uri.parse(getCloudSettings().loginEndpoint),
                        "common",
                    ).toString(),
                },
                system: {
                    loggerOptions: {
                        loggerCallback: this.getLoggerCallback(),
                        logLevel: MsalLogLevel.Trace,
                        piiLoggingEnabled: true,
                    },
                },
                cache: {
                    cachePlugin: this._cachePluginProvider?.getCachePlugin(),
                },
            };
            this.clientApplication = new PublicClientApplication(msalConfiguration);
        }

        this._authMappings.clear();

        const configuration = getAzureActiveDirectoryConfig();

        if (configuration === AzureAuthType.AuthCodeGrant) {
            this._authMappings.set(
                AzureAuthType.AuthCodeGrant,
                new MsalAzureCodeGrant(
                    getCloudSettings(),
                    this.context,
                    this.clientApplication,
                    this._vscodeWrapper,
                    this.logger,
                ),
            );
        } else if (configuration === AzureAuthType.DeviceCode) {
            this._authMappings.set(
                AzureAuthType.DeviceCode,
                new MsalAzureDeviceCode(
                    getCloudSettings(),
                    this.context,
                    this.clientApplication,
                    this._vscodeWrapper,
                    this.logger,
                ),
            );
        }
    }
}
