/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';
import { IConnectionProfile, AuthenticationTypes } from './interfaces';
import { ConnectionCredentials } from './connectionCredentials';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';
import * as utils from './utils';
import { ConnectionStore } from './connectionStore';
import { AzureAuthType } from '@microsoft/ads-adal-library';
import { AzureController } from '../azure/azureController';
import { AccountStore } from '../azure/accountStore';
import { IAccount } from './contracts/azure/accountInterfaces';
import providerSettings from '../azure/providerSettings';

// Concrete implementation of the IConnectionProfile interface

/**
 * A concrete implementation of an IConnectionProfile with support for profile creation and validation
 */
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public savePassword: boolean;
    public emptyPasswordInput: boolean;
    public azureAuthType: AzureAuthType;
    public azureAccountToken: string | undefined;
    public expiresOn: number | undefined;
    public accountStore: AccountStore;
    public accountId: string;

    constructor(connectionCredentials?: ConnectionCredentials) {
        super();
        if (connectionCredentials) {
            this.accountId = connectionCredentials.accountId;
            this.authenticationType = connectionCredentials.authenticationType;
            this.azureAccountToken = connectionCredentials.azureAccountToken;
            this.expiresOn = connectionCredentials.expiresOn;
            this.database = connectionCredentials.database;
            this.email = connectionCredentials.email;
            this.password = connectionCredentials.password;
            this.server = connectionCredentials.server;
        }
    }
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
        azureController: AzureController,
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
        let azureAccountChoices: INameValueChoice[] = ConnectionProfile.getAccountChoices(accountStore);
        let accountAnswer: IAccount;
        azureAccountChoices.unshift({ name: LocalizedConstants.azureAddAccount, value: 'addAccount'});


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
                name: LocalizedConstants.aad,
                message: LocalizedConstants.azureChooseAccount,
                choices: azureAccountChoices,
                shouldPrompt: (answers) => profile.isAzureActiveDirectory(),
                onAnswered: (value: IAccount) => accountAnswer = value
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
            if (answers.authenticationType === 'AzureMFA') {
                if (answers.AAD === 'addAccount') {
                    profile = await azureController.getTokens(profile, accountStore, providerSettings.resources.databaseResource);
                } else {
                    try {
                        profile = await azureController.refreshTokenWrapper(profile, accountStore, accountAnswer, providerSettings.resources.databaseResource);
                    } catch (error) {
                        console.log(`Refreshing tokens failed: ${error}`);
                    }
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
    public isValidProfile(): boolean {
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

    public isAzureActiveDirectory(): boolean {
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
                choices.push({ name: account?.displayInfo?.displayName, value: account });
            }
        }
        return choices;
    }
}
