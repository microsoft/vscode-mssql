/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import LocalizedConstants = require('../constants/localizedConstants');
import { ConnectionDetails } from './contracts/connection';
import { IConnectionProfile, AuthenticationTypes } from './interfaces';
import { ConnectionStore } from './connectionStore';
import * as utils from './utils';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IConnectionInfo } from 'vscode-mssql';

// Concrete implementation of the IConnectionInfo interface
export class ConnectionInfo implements IConnectionInfo {
    public server: string;
    public database: string;
    public user: string;
    public password: string;
    public email: string;
    public accountId: string;
    public port: number;
    public authenticationType: string;
    public azureAccountToken: string;
    public encrypt: boolean;
    public trustServerCertificate: boolean;
    public persistSecurityInfo: boolean;
    public connectTimeout: number;
    public connectRetryCount: number;
    public connectRetryInterval: number;
    public applicationName: string;
    public workstationId: string;
    public applicationIntent: string;
    public currentLanguage: string;
    public pooling: boolean;
    public maxPoolSize: number;
    public minPoolSize: number;
    public loadBalanceTimeout: number;
    public replication: boolean;
    public attachDbFilename: string;
    public failoverPartner: string;
    public multiSubnetFailover: boolean;
    public multipleActiveResultSets: boolean;
    public packetSize: number;
    public typeSystemVersion: string;
    public connectionString: string;


    /**
     * Create a connection details contract from connection info.
     */
    public static createConnectionDetails(connectionInfo: IConnectionInfo): ConnectionDetails {
        let details: ConnectionDetails = new ConnectionDetails();

        details.options['connectionString'] = connectionInfo.connectionString;
        details.options['server'] = connectionInfo.server;
        if (connectionInfo.port && details.options['server'].indexOf(',') === -1) {
            // Port is appended to the server name in a connection string
            details.options['server'] += (',' + connectionInfo.port);
        }
        details.options['database'] = connectionInfo.database;
        details.options['databaseDisplayName'] = connectionInfo.database;
        details.options['user'] = connectionInfo.user;
        details.options['password'] = connectionInfo.password;
        details.options['authenticationType'] = connectionInfo.authenticationType;
        details.options['azureAccountToken'] = connectionInfo.azureAccountToken;
        details.options['encrypt'] = connectionInfo.encrypt;
        details.options['trustServerCertificate'] = connectionInfo.trustServerCertificate;
        details.options['persistSecurityInfo'] = connectionInfo.persistSecurityInfo;
        details.options['connectTimeout'] = connectionInfo.connectTimeout;
        details.options['connectRetryCount'] = connectionInfo.connectRetryCount;
        details.options['connectRetryInterval'] = connectionInfo.connectRetryInterval;
        details.options['applicationName'] = connectionInfo.applicationName;
        details.options['workstationId'] = connectionInfo.workstationId;
        details.options['applicationIntent'] = connectionInfo.applicationIntent;
        details.options['currentLanguage'] = connectionInfo.currentLanguage;
        details.options['pooling'] = connectionInfo.pooling;
        details.options['maxPoolSize'] = connectionInfo.maxPoolSize;
        details.options['minPoolSize'] = connectionInfo.minPoolSize;
        details.options['loadBalanceTimeout'] = connectionInfo.loadBalanceTimeout;
        details.options['replication'] = connectionInfo.replication;
        details.options['attachDbFilename'] = connectionInfo.attachDbFilename;
        details.options['failoverPartner'] = connectionInfo.failoverPartner;
        details.options['multiSubnetFailover'] = connectionInfo.multiSubnetFailover;
        details.options['multipleActiveResultSets'] = connectionInfo.multipleActiveResultSets;
        details.options['packetSize'] = connectionInfo.packetSize;
        details.options['typeSystemVersion'] = connectionInfo.typeSystemVersion;

        return details;
    }

    public static async ensureRequiredPropertiesSet(
        connectionInfo: IConnectionInfo,
        isProfile: boolean,
        isPasswordRequired: boolean,
        wasPasswordEmptyInConfigFile: boolean,
        prompter: IPrompter,
        connectionStore: ConnectionStore,
        defaultProfileValues?: IConnectionInfo): Promise<IConnectionInfo> {

        let questions: IQuestion[] = await ConnectionInfo.getRequiredCredentialValuesQuestions(connectionInfo, false,
            isPasswordRequired, connectionStore, defaultProfileValues);
        let unprocessedConnectionInfo: IConnectionInfo = Object.assign({}, connectionInfo);

        // Potentially ask to save password
        questions.push({
            type: QuestionTypes.confirm,
            name: LocalizedConstants.msgSavePassword,
            message: LocalizedConstants.msgSavePassword,
            shouldPrompt: (answers) => {
                if (connectionInfo.connectionString) {
                    return false;
                }

                if (isProfile) {
                    // For profiles, ask to save password if we are using SQL authentication and the user just entered their password for the first time
                    return ConnectionInfo.isPasswordBasedCredential(connectionInfo) &&
                            typeof((<IConnectionProfile>connectionInfo).savePassword) === 'undefined' &&
                            wasPasswordEmptyInConfigFile;
                } else {
                    // For MRU list items, ask to save password if we are using SQL authentication and the user has not been asked before
                    return ConnectionInfo.isPasswordBasedCredential(connectionInfo) &&
                            typeof((<IConnectionProfile>connectionInfo).savePassword) === 'undefined';
                }
            },
            onAnswered: (value) => {
                (<IConnectionProfile>connectionInfo).savePassword = value;
            }
        });

        return prompter.prompt(questions).then(answers => {
            if (answers) {
                if (isProfile) {
                    let profile: IConnectionProfile = <IConnectionProfile>connectionInfo;

                    // If this is a profile, and the user has set save password to true and either
                    // stored the password in the config file or purposefully set an empty password,
                    // then transfer the password to the credential store
                    if (profile.savePassword && (!wasPasswordEmptyInConfigFile || profile.emptyPasswordInput)) {
                        // Remove profile, then save profile without plain text password
                        connectionStore.removeProfile(profile).then(() => {
                            connectionStore.saveProfile(profile);
                        });
                    // Or, if the user answered any additional questions for the profile, be sure to save it
                    } else if (profile.authenticationType !== unprocessedConnectionInfo.authenticationType ||
                               profile.savePassword !== (<IConnectionProfile>unprocessedConnectionInfo).savePassword ||
                               profile.password !== unprocessedConnectionInfo.password) {
                        connectionStore.removeProfile(profile).then(() => {
                            connectionStore.saveProfile(profile);
                        });
                    }
                }
                return connectionInfo;
            } else {
                return undefined;
            }
        });
    }

    // gets a set of questions that ensure all required and core values are set
    protected static async getRequiredCredentialValuesQuestions(
        connectionInfo: IConnectionInfo,
        promptForDbName: boolean,
        isPasswordRequired: boolean,
        connectionStore: ConnectionStore,
        defaultProfileValues?: IConnectionInfo): Promise<IQuestion[]> {

        let authenticationChoices: INameValueChoice[] = ConnectionInfo.getAuthenticationTypesChoice();

        let connectionStringSet: () => boolean = () => Boolean(connectionInfo.connectionString);

        let questions: IQuestion[] = [
            // Server or connection string must be present
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.serverPrompt,
                message: LocalizedConstants.serverPrompt,
                placeHolder: LocalizedConstants.serverPlaceholder,
                default: defaultProfileValues ? defaultProfileValues.server : undefined,
                shouldPrompt: (answers) => utils.isEmpty(connectionInfo.server),
                validate: (value) => ConnectionInfo.validateRequiredString(LocalizedConstants.serverPrompt, value),
                onAnswered: (value) => ConnectionInfo.processServerOrConnectionString(value, connectionInfo)
            },
            // Database name is not required, prompt is optional
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.databasePrompt,
                message: LocalizedConstants.databasePrompt,
                placeHolder: LocalizedConstants.databasePlaceholder,
                default: defaultProfileValues ? defaultProfileValues.database : undefined,
                shouldPrompt: (answers) => !connectionStringSet() && promptForDbName,
                onAnswered: (value) => connectionInfo.database = value
            },
            // AuthenticationType is required if there is more than 1 option on this platform
            {
                type: QuestionTypes.expand,
                name: LocalizedConstants.authTypeName,
                message: LocalizedConstants.authTypePrompt,
                choices: authenticationChoices,
                shouldPrompt: (answers) => !connectionStringSet() && utils.isEmpty(connectionInfo.authenticationType) && authenticationChoices.length > 1,
                validate: (value) => {
                    if (value === utils.authTypeToString(AuthenticationTypes.Integrated)
                        && SqlToolsServerClient.instance.getServiceVersion() === 1
                    ) {
                        return LocalizedConstants.macSierraRequiredErrorMessage;
                    } else if (value === utils.authTypeToString(AuthenticationTypes.AzureMFA)) {
                        return undefined;
                    }
                    return undefined;
                },
                onAnswered: (value) => {
                    connectionInfo.authenticationType = value;
                }
            },
            // Username must be present
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.usernamePrompt,
                message: LocalizedConstants.usernamePrompt,
                placeHolder: LocalizedConstants.usernamePlaceholder,
                default: defaultProfileValues ? defaultProfileValues.user : undefined,
                shouldPrompt: (answers) => !connectionStringSet() && ConnectionInfo.shouldPromptForUser(connectionInfo),
                validate: (value) => ConnectionInfo.validateRequiredString(LocalizedConstants.usernamePrompt, value),
                onAnswered: (value) => connectionInfo.user = value
            },
            // Password may or may not be necessary
            {
                type: QuestionTypes.password,
                name: LocalizedConstants.passwordPrompt,
                message: LocalizedConstants.passwordPrompt,
                placeHolder: LocalizedConstants.passwordPlaceholder,
                shouldPrompt: (answers) => !connectionStringSet() && ConnectionInfo.shouldPromptForPassword(connectionInfo),
                validate: (value) => {
                    if (isPasswordRequired) {
                        return ConnectionInfo.validateRequiredString(LocalizedConstants.passwordPrompt, value);
                    }
                    return undefined;
                },
                onAnswered: (value) => {
                    if (connectionInfo) {
                        connectionInfo.password = value;
                        if (typeof((<IConnectionProfile>connectionInfo)) !== 'undefined') {
                            (<IConnectionProfile>connectionInfo).emptyPasswordInput = utils.isEmpty(connectionInfo.password);
                        }
                    }
                },
                default: defaultProfileValues ? await connectionStore.lookupPassword(defaultProfileValues) : undefined
            }
        ];
        return questions;
    }

    // Detect if a given value is a server name or a connection string, and assign the result accordingly
    private static processServerOrConnectionString(value: string, connectionInfo: IConnectionInfo): void {
        // If the value contains a connection string server name key, assume it is a connection string
        const dataSourceKeys = ['data source=', 'server=', 'address=', 'addr=', 'network address='];
        let isConnectionString = dataSourceKeys.some(key => value.toLowerCase().indexOf(key) !== -1);

        if (isConnectionString) {
            connectionInfo.connectionString = value;
        } else {
            connectionInfo.server = value;
        }
    }

    private static shouldPromptForUser(connectionInfo: IConnectionInfo): boolean {
        return utils.isEmpty(connectionInfo.user) && ConnectionInfo.isPasswordBasedCredential(connectionInfo);
    }

    // Prompt for password if this is a password based credential and the password for the profile was empty
    // and not explicitly set as empty. If it was explicitly set as empty, only prompt if pw not saved
    public static shouldPromptForPassword(connectionInfo: IConnectionInfo): boolean {
        let isSavedEmptyPassword: boolean = (<IConnectionProfile>connectionInfo).emptyPasswordInput
            && (<IConnectionProfile>connectionInfo).savePassword;

        return utils.isEmpty(connectionInfo.password)
            && ConnectionInfo.isPasswordBasedCredential(connectionInfo)
            && !isSavedEmptyPassword;

    }

    public static isPasswordBasedCredential(connectionInfo: IConnectionInfo): boolean {
        // TODO consider enum based verification and handling of AD auth here in the future
        let authenticationType = connectionInfo.authenticationType;
        if (typeof connectionInfo.authenticationType === 'undefined') {
            authenticationType = utils.authTypeToString(AuthenticationTypes.SqlLogin);
        }
        return authenticationType === utils.authTypeToString(AuthenticationTypes.SqlLogin);
    }

    public static isPasswordBasedConnectionString(connectionString: string): boolean {
        const connString = connectionString.toLowerCase();
        return connString.includes('user') &&
            connString.includes('password') &&
            !connString.includes('Integrated Security');
    }

    // Validates a string is not empty, returning undefined if true and an error message if not
    protected static validateRequiredString(property: string, value: string): string {
        if (utils.isEmpty(value)) {
            return property + LocalizedConstants.msgIsRequired;
        }
        return undefined;
    }

    public static getAuthenticationTypesChoice(): INameValueChoice[] {
        let choices: INameValueChoice[] = [
            { name: LocalizedConstants.authTypeSql, value: utils.authTypeToString(AuthenticationTypes.SqlLogin) },
            { name: LocalizedConstants.authTypeIntegrated, value: utils.authTypeToString(AuthenticationTypes.Integrated) },
            { name: LocalizedConstants.authTypeAzureActiveDirectory, value: utils.authTypeToString(AuthenticationTypes.AzureMFA)}
        ];

        return choices;
    }
}

