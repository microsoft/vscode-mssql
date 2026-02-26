/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LocalizedConstants from "../constants/locConstants";
import { IConnectionProfile, AuthenticationTypes } from "./interfaces";
import { ConnectionCredentials } from "./connectionCredentials";
import { INameValueChoice } from "../prompts/question";
import * as utils from "./utils";
import { AccountStore } from "../azure/accountStore";
import { AzureAuthType } from "./contracts/azure";
import { ConfigTarget } from "../connectionconfig/connectionconfig";

// Concrete implementation of the IConnectionProfile interface

/**
 * A concrete implementation of an IConnectionProfile with support for profile creation and validation
 */
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public id: string;
    public groupId: string;
    public configSource: ConfigTarget;
    public savePassword: boolean;
    public emptyPasswordInput: boolean;
    public azureAuthType: AzureAuthType;
    declare public azureAccountToken: string | undefined;
    declare public expiresOn: number | undefined;
    public accountStore: AccountStore;
    declare public accountId: string;
    declare public tenantId: string;

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

    public static async getAccountChoices(accountStore: AccountStore): Promise<INameValueChoice[]> {
        let accounts = await accountStore.getAccounts();
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
