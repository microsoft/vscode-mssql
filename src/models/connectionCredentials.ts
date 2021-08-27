/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LocalizedConstants from '../constants/localizedConstants';
import { ConnectionDetails } from './contracts/connection';
import { IConnectionProfile, AuthenticationTypes } from './interfaces';
import { ConnectionStore } from './connectionStore';
import * as utils from './utils';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IConnectionInfo } from 'vscode-mssql';

// Concrete implementation of the IConnectionCredentials interface
export class ConnectionCredentials implements IConnectionInfo {
    public server: string;
    public database: string;
    public user: string;
    public password: string;
    public email: string | undefined;
    public accountId: string | undefined;
    public port: number;
    public authenticationType: string;
    public azureAccountToken: string | undefined;
    public encrypt: boolean;
    public trustServerCertificate: boolean | undefined;
    public persistSecurityInfo: boolean | undefined;
    public connectTimeout: number | undefined;
    public connectRetryCount: number | undefined;
    public connectRetryInterval: number | undefined;
    public applicationName: string | undefined;
    public workstationId: string | undefined;
    public applicationIntent: string | undefined;
    public currentLanguage: string | undefined;
    public pooling: boolean | undefined;
    public maxPoolSize: number | undefined;
    public minPoolSize: number | undefined;
    public loadBalanceTimeout: number | undefined;
    public replication: boolean | undefined;
    public attachDbFilename: string | undefined;
    public failoverPartner: string | undefined;
    public multiSubnetFailover: boolean | undefined;
    public multipleActiveResultSets: boolean | undefined;
    public packetSize: number | undefined;
    public typeSystemVersion: string | undefined;
    public connectionString: string | undefined;


    /**
     * Create a connection details contract from connection credentials.
     */
    public static createConnectionDetails(credentials: IConnectionInfo): ConnectionDetails {
        let details: ConnectionDetails = new ConnectionDetails();

        details.options['connectionString'] = credentials.connectionString;
        details.options['server'] = credentials.server;
        if (credentials.port && details.options['server'].indexOf(',') === -1) {
            // Port is appended to the server name in a connection string
            details.options['server'] += (',' + credentials.port);
        }
        details.options['database'] = credentials.database;
        details.options['databaseDisplayName'] = credentials.database;
        details.options['user'] = credentials.user;
        details.options['password'] = credentials.password;
        details.options['authenticationType'] = credentials.authenticationType;
        details.options['azureAccountToken'] = credentials.azureAccountToken;
        details.options['encrypt'] = credentials.encrypt;
        details.options['trustServerCertificate'] = credentials.trustServerCertificate;
        details.options['persistSecurityInfo'] = credentials.persistSecurityInfo;
        details.options['connectTimeout'] = credentials.connectTimeout;
        details.options['connectRetryCount'] = credentials.connectRetryCount;
        details.options['connectRetryInterval'] = credentials.connectRetryInterval;
        details.options['applicationName'] = credentials.applicationName;
        details.options['workstationId'] = credentials.workstationId;
        details.options['applicationIntent'] = credentials.applicationIntent;
        details.options['currentLanguage'] = credentials.currentLanguage;
        details.options['pooling'] = credentials.pooling;
        details.options['maxPoolSize'] = credentials.maxPoolSize;
        details.options['minPoolSize'] = credentials.minPoolSize;
        details.options['loadBalanceTimeout'] = credentials.loadBalanceTimeout;
        details.options['replication'] = credentials.replication;
        details.options['attachDbFilename'] = credentials.attachDbFilename;
        details.options['failoverPartner'] = credentials.failoverPartner;
        details.options['multiSubnetFailover'] = credentials.multiSubnetFailover;
        details.options['multipleActiveResultSets'] = credentials.multipleActiveResultSets;
        details.options['packetSize'] = credentials.packetSize;
        details.options['typeSystemVersion'] = credentials.typeSystemVersion;

        return details;
    }

    public static async ensureRequiredPropertiesSet(
        credentials: IConnectionInfo,
        isProfile: boolean,
        isPasswordRequired: boolean,
        wasPasswordEmptyInConfigFile: boolean,
        prompter: IPrompter,
        connectionStore: ConnectionStore,
        defaultProfileValues?: IConnectionInfo): Promise<IConnectionInfo> {

        let questions: IQuestion[] = await ConnectionCredentials.getRequiredCredentialValuesQuestions(credentials, false,
            isPasswordRequired, connectionStore, defaultProfileValues);
        let unprocessedCredentials: IConnectionInfo = Object.assign({}, credentials);

        // Potentially ask to save password
        questions.push({
            type: QuestionTypes.confirm,
            name: LocalizedConstants.msgSavePassword,
            message: LocalizedConstants.msgSavePassword,
            shouldPrompt: (answers) => {
                if (credentials.connectionString) {
                    return false;
                }

                if (isProfile) {
                    // For profiles, ask to save password if we are using SQL authentication and the user just entered their password for the first time
                    return ConnectionCredentials.isPasswordBasedCredential(credentials) &&
                            typeof((<IConnectionProfile>credentials).savePassword) === 'undefined' &&
                            wasPasswordEmptyInConfigFile;
                } else {
                    // For MRU list items, ask to save password if we are using SQL authentication and the user has not been asked before
                    return ConnectionCredentials.isPasswordBasedCredential(credentials) &&
                            typeof((<IConnectionProfile>credentials).savePassword) === 'undefined';
                }
            },
            onAnswered: (value) => {
                (<IConnectionProfile>credentials).savePassword = value;
            }
        });

        return prompter.prompt(questions).then(answers => {
            if (answers) {
                if (isProfile) {
                    let profile: IConnectionProfile = <IConnectionProfile>credentials;

                    // If this is a profile, and the user has set save password to true and either
                    // stored the password in the config file or purposefully set an empty password,
                    // then transfer the password to the credential store
                    if (profile.savePassword && (!wasPasswordEmptyInConfigFile || profile.emptyPasswordInput)) {
                        // Remove profile, then save profile without plain text password
                        connectionStore.removeProfile(profile).then(() => {
                            connectionStore.saveProfile(profile);
                        });
                    // Or, if the user answered any additional questions for the profile, be sure to save it
                    } else if (profile.authenticationType !== unprocessedCredentials.authenticationType ||
                               profile.savePassword !== (<IConnectionProfile>unprocessedCredentials).savePassword ||
                               profile.password !== unprocessedCredentials.password) {
                        connectionStore.removeProfile(profile).then(() => {
                            connectionStore.saveProfile(profile);
                        });
                    }
                }
                return credentials;
            } else {
                return undefined;
            }
        });
    }

    // gets a set of questions that ensure all required and core values are set
    protected static async getRequiredCredentialValuesQuestions(
        credentials: IConnectionInfo,
        promptForDbName: boolean,
        isPasswordRequired: boolean,
        connectionStore: ConnectionStore,
        defaultProfileValues?: IConnectionInfo): Promise<IQuestion[]> {

        let authenticationChoices: INameValueChoice[] = ConnectionCredentials.getAuthenticationTypesChoice();

        let connectionStringSet: () => boolean = () => Boolean(credentials.connectionString);

        let questions: IQuestion[] = [
            // Server or connection string must be present
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.serverPrompt,
                message: LocalizedConstants.serverPrompt,
                placeHolder: LocalizedConstants.serverPlaceholder,
                default: defaultProfileValues ? defaultProfileValues.server : undefined,
                shouldPrompt: (answers) => utils.isEmpty(credentials.server),
                validate: (value) => ConnectionCredentials.validateRequiredString(LocalizedConstants.serverPrompt, value),
                onAnswered: (value) => ConnectionCredentials.processServerOrConnectionString(value, credentials)
            },
            // Database name is not required, prompt is optional
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.databasePrompt,
                message: LocalizedConstants.databasePrompt,
                placeHolder: LocalizedConstants.databasePlaceholder,
                default: defaultProfileValues ? defaultProfileValues.database : undefined,
                shouldPrompt: (answers) => !connectionStringSet() && promptForDbName,
                onAnswered: (value) => credentials.database = value
            },
            // AuthenticationType is required if there is more than 1 option on this platform
            {
                type: QuestionTypes.expand,
                name: LocalizedConstants.authTypeName,
                message: LocalizedConstants.authTypePrompt,
                choices: authenticationChoices,
                shouldPrompt: (answers) => !connectionStringSet() && utils.isEmpty(credentials.authenticationType) && authenticationChoices.length > 1,
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
                    credentials.authenticationType = value;
                }
            },
            // Username must be present
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.usernamePrompt,
                message: LocalizedConstants.usernamePrompt,
                placeHolder: LocalizedConstants.usernamePlaceholder,
                default: defaultProfileValues ? defaultProfileValues.user : undefined,
                shouldPrompt: (answers) => !connectionStringSet() && ConnectionCredentials.shouldPromptForUser(credentials),
                validate: (value) => ConnectionCredentials.validateRequiredString(LocalizedConstants.usernamePrompt, value),
                onAnswered: (value) => credentials.user = value
            },
            // Password may or may not be necessary
            {
                type: QuestionTypes.password,
                name: LocalizedConstants.passwordPrompt,
                message: LocalizedConstants.passwordPrompt,
                placeHolder: LocalizedConstants.passwordPlaceholder,
                shouldPrompt: (answers) => !connectionStringSet() && ConnectionCredentials.shouldPromptForPassword(credentials),
                validate: (value) => {
                    if (isPasswordRequired) {
                        return ConnectionCredentials.validateRequiredString(LocalizedConstants.passwordPrompt, value);
                    }
                    return undefined;
                },
                onAnswered: (value) => {
                    if (credentials) {
                        credentials.password = value;
                        if (typeof((<IConnectionProfile>credentials)) !== 'undefined') {
                            (<IConnectionProfile>credentials).emptyPasswordInput = utils.isEmpty(credentials.password);
                        }
                    }
                },
                default: defaultProfileValues ? await connectionStore.lookupPassword(defaultProfileValues) : undefined
            }
        ];
        return questions;
    }

    // Detect if a given value is a server name or a connection string, and assign the result accordingly
    private static processServerOrConnectionString(value: string, credentials: IConnectionInfo): void {
        // If the value contains a connection string server name key, assume it is a connection string
        const dataSourceKeys = ['data source=', 'server=', 'address=', 'addr=', 'network address='];
        let isConnectionString = dataSourceKeys.some(key => value.toLowerCase().indexOf(key) !== -1);

        if (isConnectionString) {
            credentials.connectionString = value;
        } else {
            credentials.server = value;
        }
    }

    private static shouldPromptForUser(credentials: IConnectionInfo): boolean {
        return utils.isEmpty(credentials.user) && ConnectionCredentials.isPasswordBasedCredential(credentials);
    }

    // Prompt for password if this is a password based credential and the password for the profile was empty
    // and not explicitly set as empty. If it was explicitly set as empty, only prompt if pw not saved
    public static shouldPromptForPassword(credentials: IConnectionInfo): boolean {
        let isSavedEmptyPassword: boolean = (<IConnectionProfile>credentials).emptyPasswordInput
            && (<IConnectionProfile>credentials).savePassword;

        return utils.isEmpty(credentials.password)
            && ConnectionCredentials.isPasswordBasedCredential(credentials)
            && !isSavedEmptyPassword;

    }

    public static isPasswordBasedCredential(credentials: IConnectionInfo): boolean {
        // TODO consider enum based verification and handling of AD auth here in the future
        let authenticationType = credentials.authenticationType;
        if (typeof credentials.authenticationType === 'undefined') {
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

