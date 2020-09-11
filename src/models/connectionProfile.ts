/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import vscode = require('vscode');
import LocalizedConstants = require('../constants/localizedConstants');
import { IConnectionProfile, AuthenticationTypes } from './interfaces';
import { ConnectionCredentials } from './connectionCredentials';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';
import * as utils from './utils';
import { ConnectionStore } from './connectionStore';
import { AzureCodeGrant, AzureAuthType, AzureDeviceCode, AADResource } from '@cssuh/ads-adal-library';
import { AzureController } from '../azure/azureController';
import providerSettings from '../azure/providerSettings';
import { AzureLogger } from '../azure/azureLogger';
import { AccountStore } from '../azure/accountStore';
import { IAccount } from './contracts/azure/accountInterfaces';

// Concrete implementation of the IConnectionProfile interface

/**
 * A concrete implementation of an IConnectionProfile with support for profile creation and validation
 */
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public savePassword: boolean;
    public emptyPasswordInput: boolean;
    public azureAuthType: AzureAuthType;
    public azureAccountToken: string;
    public accountStore: AccountStore;

    /**
     * Creates a new profile by prompting the user for information.
     * @param  {IPrompter} prompter that asks user the questions needed to complete a profile
     * @param  {IConnectionProfile} (optional) default profile values that will be prefilled for questions, if any
     * @returns Promise - resolves to undefined if profile creation was not completed, or IConnectionProfile if completed
     */
    public static async createProfile(
        prompter: IPrompter,
        connectionStore: ConnectionStore,
        context: vscode.ExtensionContext,
        accountStore?: AccountStore,
        defaultProfileValues?: IConnectionProfile
        ): Promise<IConnectionProfile> {
        let profile: ConnectionProfile = new ConnectionProfile();
        // Ensure all core properties are entered
        let authOptions: INameValueChoice[] = ConnectionCredentials.getAuthenticationTypesChoice();
        if (authOptions.length === 1) {
            // Set default value as there is only 1 option
            profile.authenticationType = authOptions[0].value;
        }
        let azureAuthChoices: INameValueChoice[] = ConnectionProfile.getAzureAuthChoices();
        let azureAccountChoices: INameValueChoice[] = ConnectionProfile.getAccountChoices(accountStore);
        azureAccountChoices.unshift({ name: 'Add An Account...', value: 'addAccount'});


        let questions: IQuestion[] = await ConnectionCredentials.getRequiredCredentialValuesQuestions(profile, true,
            false, connectionStore, defaultProfileValues);

        // Check if password needs to be saved
        questions.push(
            {
                type: QuestionTypes.confirm,
                name: LocalizedConstants.msgSavePassword,
                message: LocalizedConstants.msgSavePassword,
                shouldPrompt: (answers) => !profile.connectionString && ConnectionCredentials.isPasswordBasedCredential(profile),
                onAnswered: (value) => profile.savePassword = value
            },
            {
                type: QuestionTypes.expand,
                name: 'AAD',
                message: 'Choose an Azure Active Directory Account',
                choices: azureAccountChoices,
                shouldPrompt: (answers) => profile.isAzureActiveDirectory()
            },
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.profileNamePrompt,
                message: LocalizedConstants.profileNamePrompt,
                placeHolder: LocalizedConstants.profileNamePlaceholder,
                default: defaultProfileValues ? defaultProfileValues.profileName : undefined,
                onAnswered: (value) => {
                    // Fall back to a default name if none specified
                    profile.profileName = value ? value : undefined;
                }

        });

        return prompter.prompt(questions, true).then(async answers => {
            if (answers.AAD === 'addAccount') {
                let account: IAccount;
                let config = vscode.workspace.getConfiguration('mssql').get('azureActiveDirectory');
                if (config === utils.azureAuthTypeToString(AzureAuthType.AuthCodeGrant)) {
                    let azureLogger = new AzureLogger();
                    let azureController = new AzureController(context, azureLogger);
                    await azureController.init();
                    let azureCodeGrant = new AzureCodeGrant(
                        providerSettings, azureController.storageService, azureController.cacheService, azureLogger,
                        azureController.azureMessageDisplayer, azureController.azureErrorLookup, azureController.azureUserInteraction,
                        azureController.azureStringLookup, azureController.authRequest
                    );
                    account = await azureCodeGrant.startLogin();
                    await accountStore.addAccount(account, azureCodeGrant);
                    const token = await azureCodeGrant.getAccountSecurityToken(
                        account, azureCodeGrant.getHomeTenant(account).id, providerSettings.resources.databaseResource
                    );
                    profile.azureAccountToken = token.token;
                } else if (config === utils.azureAuthTypeToString(AzureAuthType.DeviceCode)) {
                    let azureLogger = new AzureLogger();
                    let azureController = new AzureController(context, azureLogger);
                    await azureController.init();
                    let azureDeviceCode = new AzureDeviceCode (
                        providerSettings, azureController.storageService, azureController.cacheService, azureLogger,
                        azureController.azureMessageDisplayer, azureController.azureErrorLookup, azureController.azureUserInteraction,
                        azureController.azureStringLookup, azureController.authRequest
                    );
                    account = await azureDeviceCode.startLogin();
                    await accountStore.addAccount(account, azureDeviceCode);
                    const token = await azureDeviceCode.getAccountSecurityToken(
                        account, azureDeviceCode.getHomeTenant(account).id, providerSettings.resources.databaseResource
                    );
                    profile.azureAccountToken = token.token;
                }
            } else {
                let aadResource: AADResource = answers.AAD;
                let account = accountStore.getAccount(aadResource.key.id);
                if (!account) {
                    throw new Error('account not found');
                }
                if (account.properties.azureAuthType === 0) {
                    // Auth Code Grant
                    let azureLogger = new AzureLogger();
                    let azureController = new AzureController(context, azureLogger);
                    await azureController.init();
                    let azureCodeGrant = new AzureCodeGrant(
                        providerSettings, azureController.storageService, azureController.cacheService, azureLogger,
                        azureController.azureMessageDisplayer, azureController.azureErrorLookup, azureController.azureUserInteraction,
                        azureController.azureStringLookup, azureController.authRequest
                    );
                    let newAccount = await azureCodeGrant.refreshAccess(account);
                    await accountStore.addAccount(newAccount, azureCodeGrant);
                    const token = await azureCodeGrant.getAccountSecurityToken(
                        account, azureCodeGrant.getHomeTenant(account).id, providerSettings.resources.databaseResource
                    );
                    profile.azureAccountToken = token.token;
                } else if (account.properties.azureAuthType === 1) {
                    // Device Code
                    let azureLogger = new AzureLogger();
                    let azureController = new AzureController(context, azureLogger);
                    await azureController.init();
                    let azureDeviceCode = new AzureDeviceCode(
                        providerSettings, azureController.storageService, azureController.cacheService, azureLogger,
                        azureController.azureMessageDisplayer, azureController.azureErrorLookup, azureController.azureUserInteraction,
                        azureController.azureStringLookup, azureController.authRequest
                    );
                    let newAccount = await azureDeviceCode.refreshAccess(account);
                    await accountStore.addAccount(newAccount, azureDeviceCode);
                    const token = await azureDeviceCode.getAccountSecurityToken(
                        account, azureDeviceCode.getHomeTenant(account).id, providerSettings.resources.databaseResource
                    );
                    profile.azureAccountToken = token.token;
                }
            }
            if (answers && profile.isValidProfile()) {
                return profile;
            }
            // returning undefined to indicate failure to create the profile
            return undefined;
        });
    }

    // Assumption: having connection string or server + profile name indicates all requirements were met
    private isValidProfile(): boolean {
        if (this.connectionString) {
            return true;
        }

        if (this.authenticationType) {
            if (this.authenticationType === AuthenticationTypes[AuthenticationTypes.Integrated] ||
                this.authenticationType === AuthenticationTypes[AuthenticationTypes.AzureMFA]) {
                return utils.isNotEmpty(this.server);
            } else {
                return utils.isNotEmpty(this.server)
                    && utils.isNotEmpty(this.user);
            }
        }
        return false;
    }

    private isAzureActiveDirectory(): boolean {
        return this.authenticationType === AuthenticationTypes[AuthenticationTypes.AzureMFA];
    }

    public static getAzureAuthChoices(): INameValueChoice[] {
        let choices: INameValueChoice[] = [
            { name: LocalizedConstants.azureAuthTypeCodeGrant, value: utils.azureAuthTypeToString(AzureAuthType.AuthCodeGrant) },
            { name: LocalizedConstants.azureAuthTypeDeviceCode, value: utils.azureAuthTypeToString(AzureAuthType.DeviceCode) }
        ];

        return choices;
    }

    public static getAccountChoices(accountStore: AccountStore): INameValueChoice[] {
        let accounts = accountStore.getAccounts();
        let choices: Array<INameValueChoice> = [];

        if (accounts.length > 0) {
            for (let account of accounts) {
                choices.push({ name: account.displayInfo.displayName, value: account });
            }
        }
        return choices;
    }
}
