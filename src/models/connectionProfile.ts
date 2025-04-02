/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import { IConnectionProfile, AuthenticationTypes } from "./interfaces";
import { ConnectionCredentials } from "./connectionCredentials";
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from "../prompts/question";
import * as utils from "./utils";
import { ConnectionStore } from "./connectionStore";
import { AzureController } from "../azure/azureController";
import { AccountStore } from "../azure/accountStore";
import providerSettings from "../azure/providerSettings";
import { AzureAuthType, IAccount, ITenant } from "./contracts/azure";
import { getEnableSqlAuthenticationProviderConfig } from "../azure/utils";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";

// Concrete implementation of the IConnectionProfile interface

/**
 * A concrete implementation of an IConnectionProfile with support for profile creation and validation
 */
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public id: string;
    public groupId: string;
    public savePassword: boolean;
    public emptyPasswordInput: boolean;
    public azureAuthType: AzureAuthType;
    public declare azureAccountToken: string | undefined;
    public declare expiresOn: number | undefined;
    public accountStore: AccountStore;
    public declare accountId: string;
    public declare tenantId: string;

    constructor(connectionCredentials?: ConnectionCredentials) {
        super();
        if (connectionCredentials) {
            this.accountId = connectionCredentials.accountId;
            this.tenantId = connectionCredentials.tenantId;
            this.authenticationType = connectionCredentials.authenticationType;
            this.azureAccountToken = connectionCredentials.azureAccountToken;
            this.expiresOn = connectionCredentials.expiresOn;
            this.database = connectionCredentials.database;
            this.email = connectionCredentials.email;
            this.user = connectionCredentials.email;
            this.password = connectionCredentials.password;
            this.server = connectionCredentials.server;
        }
    }

    /**
     * Creates a new profile by prompting the user for information.
     * @param prompter that asks user the questions needed to complete a profile
     * @param (optional) default profile values that will be prefilled for questions, if any
     * @returns Promise - resolves to undefined if profile creation was not completed, or IConnectionProfile if completed
     */
    public static async createProfile(
        prompter: IPrompter,
        connectionStore: ConnectionStore,
        context: vscode.ExtensionContext,
        azureController: AzureController,
        accountStore?: AccountStore,
        defaultProfileValues?: IConnectionProfile,
    ): Promise<IConnectionProfile | undefined> {
        let profile: ConnectionProfile = new ConnectionProfile();
        // Ensure all core properties are entered
        let authOptions: INameValueChoice[] = ConnectionCredentials.getAuthenticationTypesChoice();
        if (authOptions.length === 1) {
            // Set default value as there is only 1 option
            profile.authenticationType = authOptions[0].value;
        }
        let azureAccountChoices: INameValueChoice[] =
            ConnectionProfile.getAccountChoices(accountStore);
        let accountAnswer: IAccount;
        azureAccountChoices.unshift({
            name: LocalizedConstants.azureAddAccount,
            value: "addAccount",
        });
        let tenantChoices: INameValueChoice[] = [];

        let questions: IQuestion[] =
            await ConnectionCredentials.getRequiredCredentialValuesQuestions(
                profile,
                true,
                false,
                connectionStore,
                defaultProfileValues,
            );

        // Check if password needs to be saved
        questions.push(
            {
                type: QuestionTypes.confirm,
                name: LocalizedConstants.msgSavePassword,
                message: LocalizedConstants.msgSavePassword,
                shouldPrompt: () =>
                    !profile.connectionString &&
                    ConnectionCredentials.isPasswordBasedCredential(profile),
                onAnswered: (value) => (profile.savePassword = value),
            },
            {
                type: QuestionTypes.expand,
                name: LocalizedConstants.aad,
                message: LocalizedConstants.azureChooseAccount,
                choices: azureAccountChoices,
                shouldPrompt: () => profile.isAzureActiveDirectory(),
                onAnswered: async (value) => {
                    accountAnswer = value;
                    if (value !== "addAccount") {
                        let account = value;
                        profile.accountId = account?.key.id;
                        tenantChoices.push(
                            ...account?.properties?.tenants!.map((t) => ({
                                name: t.displayName,
                                value: t,
                            })),
                        );
                        if (tenantChoices.length === 1) {
                            profile.tenantId = tenantChoices[0].value.id;
                        }
                        try {
                            profile = await azureController.refreshTokenWrapper(
                                profile,
                                accountStore,
                                accountAnswer,
                                providerSettings.resources.databaseResource,
                            );
                        } catch (error) {
                            console.log(`Refreshing tokens failed: ${error}`);
                        }
                    } else {
                        try {
                            profile = await azureController.populateAccountProperties(
                                profile,
                                accountStore,
                                providerSettings.resources.databaseResource,
                            );
                            if (profile) {
                                vscode.window.showInformationMessage(
                                    LocalizedConstants.accountAddedSuccessfully(profile.email),
                                );
                            }
                        } catch (e) {
                            console.error(`Could not add account: ${e}`);
                            vscode.window.showErrorMessage(e);
                        }
                    }
                },
            },
            {
                type: QuestionTypes.expand,
                name: LocalizedConstants.tenant,
                message: LocalizedConstants.azureChooseTenant,
                choices: tenantChoices,
                default: defaultProfileValues ? defaultProfileValues.tenantId : undefined,
                // Need not prompt for tenant question when 'Sql Authentication Provider' is enabled,
                // since tenant information is received from Server with authority URI in the Login flow.
                shouldPrompt: () =>
                    profile.isAzureActiveDirectory() &&
                    tenantChoices.length > 1 &&
                    !getEnableSqlAuthenticationProviderConfig(),
                onAnswered: (value: ITenant) => {
                    profile.tenantId = value.id;
                },
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
                },
            },
        );

        const answers = await prompter.prompt(questions, true);

        if (answers && profile.isValidProfile()) {
            sendActionEvent(
                TelemetryViews.ConnectionPrompt,
                TelemetryActions.CreateConnectionResult,
                {
                    authenticationType: profile.authenticationType,
                    passwordSaved: profile.savePassword ? "true" : "false",
                },
            );

            ConnectionProfile.addIdIfMissing(profile);

            return profile;
        }

        // returning undefined to indicate failure to create the profile
        return undefined;
    }

    public static addIdIfMissing(profile: IConnectionProfile): boolean {
        if (profile && profile.id === undefined) {
            profile.id = utils.generateGuid();
            return true;
        }

        return false;
    }

    // Assumption: having connection string or server + profile name indicates all requirements were met
    public isValidProfile(): boolean {
        if (this.connectionString) {
            return true;
        }

        if (this.authenticationType) {
            if (
                this.authenticationType === AuthenticationTypes[AuthenticationTypes.Integrated] ||
                this.authenticationType === AuthenticationTypes[AuthenticationTypes.AzureMFA]
            ) {
                return utils.isNotEmpty(this.server);
            } else {
                return utils.isNotEmpty(this.server) && utils.isNotEmpty(this.user);
            }
        }
        return false;
    }

    public isAzureActiveDirectory(): boolean {
        return this.authenticationType === AuthenticationTypes[AuthenticationTypes.AzureMFA];
    }

    public static getAzureAuthChoices(): INameValueChoice[] {
        let choices: INameValueChoice[] = [
            {
                name: LocalizedConstants.azureAuthTypeCodeGrant,
                value: utils.azureAuthTypeToString(AzureAuthType.AuthCodeGrant),
            },
            {
                name: LocalizedConstants.azureAuthTypeDeviceCode,
                value: utils.azureAuthTypeToString(AzureAuthType.DeviceCode),
            },
        ];

        return choices;
    }

    public static getAccountChoices(accountStore: AccountStore): INameValueChoice[] {
        let accounts = accountStore.getAccounts();
        let choices: Array<INameValueChoice> = [];

        if (accounts.length > 0) {
            for (let account of accounts) {
                choices.push({
                    name: account?.displayInfo?.displayName,
                    value: account,
                });
            }
        }
        return choices;
    }
}
