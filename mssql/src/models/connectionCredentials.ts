/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LocalizedConstants from "../constants/locConstants";
import { IConnectionProfile, AuthenticationTypes } from "./interfaces";
import * as utils from "./utils";
import { INameValueChoice } from "../prompts/question";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";

// Concrete implementation of the IConnectionInfo interface
export class ConnectionCredentials implements IConnectionInfo {
    public server: string;
    public database: string;
    public user: string;
    public password: string;
    public email: string | undefined;
    public accountId: string | undefined;
    public tenantId: string | undefined;
    public port: number;
    public authenticationType: string;
    public azureAccountToken: string | undefined;
    public expiresOn: number | undefined;
    public encrypt: string | boolean;
    public trustServerCertificate: boolean | undefined;
    public hostNameInCertificate: string | undefined;
    public persistSecurityInfo: boolean | undefined;
    public secureEnclaves: string | undefined;
    public columnEncryptionSetting: string | undefined;
    public attestationProtocol: string | undefined;
    public enclaveAttestationUrl: string | undefined;
    public connectTimeout: number | undefined;
    public commandTimeout: number | undefined;
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
    public containerName: string | undefined;

    /**
     * Create a connection details contract from connection credentials.
     */
    public static createConnectionDetails(credentials: IConnectionInfo): ConnectionDetails {
        let details: ConnectionDetails = {
            options: {},
        };

        if ((credentials as IConnectionProfile).id) {
            details.options["id"] = (credentials as IConnectionProfile).id;
        }
        details.options["connectionString"] = credentials.connectionString;
        details.options["server"] = credentials.server;
        if (credentials.port && details.options["server"].indexOf(",") === -1) {
            // Port is appended to the server name in a connection string
            details.options["server"] += "," + credentials.port;
        }
        details.options["database"] = credentials.database;
        details.options["databaseDisplayName"] = credentials.database;
        details.options["user"] = credentials.user || credentials.email;
        details.options["password"] = credentials.password;
        details.options["authenticationType"] = credentials.authenticationType;
        details.options["email"] = credentials.email;
        details.options["accountId"] = credentials.accountId;
        details.options["tenantId"] = credentials.tenantId;
        details.options["azureAccountToken"] = credentials.azureAccountToken;
        details.options["expiresOn"] = credentials.expiresOn;
        details.options["encrypt"] = credentials.encrypt;
        details.options["trustServerCertificate"] = credentials.trustServerCertificate;
        details.options["hostNameInCertificate"] = credentials.hostNameInCertificate;
        details.options["persistSecurityInfo"] = credentials.persistSecurityInfo;
        details.options["secureEnclaves"] = credentials.secureEnclaves;
        details.options["columnEncryptionSetting"] = credentials.columnEncryptionSetting;
        details.options["attestationProtocol"] = credentials.attestationProtocol;
        details.options["enclaveAttestationUrl"] = credentials.enclaveAttestationUrl;
        details.options["connectTimeout"] = credentials.connectTimeout;
        details.options["commandTimeout"] = credentials.commandTimeout;
        details.options["connectRetryCount"] = credentials.connectRetryCount;
        details.options["connectRetryInterval"] = credentials.connectRetryInterval;
        details.options["applicationName"] = credentials.applicationName;
        details.options["workstationId"] = credentials.workstationId;
        details.options["applicationIntent"] = credentials.applicationIntent;
        details.options["currentLanguage"] = credentials.currentLanguage;
        details.options["pooling"] = credentials.pooling;
        details.options["maxPoolSize"] = credentials.maxPoolSize;
        details.options["minPoolSize"] = credentials.minPoolSize;
        details.options["loadBalanceTimeout"] = credentials.loadBalanceTimeout;
        details.options["replication"] = credentials.replication;
        details.options["attachDbFilename"] = credentials.attachDbFilename;
        details.options["failoverPartner"] = credentials.failoverPartner;
        details.options["multiSubnetFailover"] = credentials.multiSubnetFailover;
        details.options["multipleActiveResultSets"] = credentials.multipleActiveResultSets;
        details.options["packetSize"] = credentials.packetSize;
        details.options["typeSystemVersion"] = credentials.typeSystemVersion;
        details.options["containerName"] = credentials.containerName;

        return details;
    }

    /**
     * Create an IConnectionInfo object from a ConnectionDetails contract.
     */
    public static createConnectionInfo(connDetails: ConnectionDetails): IConnectionInfo {
        const options = connDetails.options || {};

        const connInfo: IConnectionInfo = {
            connectionString: options["connectionString"],
            server: options["server"],
            port: options["server"]?.includes(",")
                ? parseInt(options["server"].split(",")[1])
                : undefined,
            database: options["database"],
            user: options["user"],
            password: options["password"],
            authenticationType: options["authenticationType"],
            azureAccountToken: options["azureAccountToken"],
            encrypt: options["encrypt"],
            trustServerCertificate: options["trustServerCertificate"],
            hostNameInCertificate: options["hostNameInCertificate"],
            persistSecurityInfo: options["persistSecurityInfo"],
            secureEnclaves: options["secureEnclaves"],
            columnEncryptionSetting: options["columnEncryptionSetting"],
            attestationProtocol: options["attestationProtocol"],
            enclaveAttestationUrl: options["enclaveAttestationUrl"],
            connectTimeout: options["connectTimeout"],
            commandTimeout: options["commandTimeout"],
            connectRetryCount: options["connectRetryCount"],
            connectRetryInterval: options["connectRetryInterval"],
            applicationName: options["applicationName"],
            workstationId: options["workstationId"],
            applicationIntent: options["applicationIntent"],
            currentLanguage: options["currentLanguage"],
            pooling: options["pooling"],
            maxPoolSize: options["maxPoolSize"],
            minPoolSize: options["minPoolSize"],
            loadBalanceTimeout: options["loadBalanceTimeout"],
            replication: options["replication"],
            attachDbFilename: options["attachDbFilename"],
            failoverPartner: options["failoverPartner"],
            multiSubnetFailover: options["multiSubnetFailover"],
            multipleActiveResultSets: options["multipleActiveResultSets"],
            packetSize: options["packetSize"],
            typeSystemVersion: options["typeSystemVersion"],
            email: options["email"],
            accountId: options["accountId"],
            tenantId: options["tenantId"],
            expiresOn: options["expiresOn"],
            containerName: options["containerName"],
        };

        return connInfo;
    }

    public static removeUndefinedProperties(connection: IConnectionInfo): IConnectionInfo {
        // TODO: ideally this compares against the default values acquired from a source of truth (e.g. STS),
        // so that it can clean up more than just undefined properties.

        const output = Object.assign({}, connection);
        for (const key of Object.keys(output)) {
            if (
                output[key] === undefined ||
                // eslint-disable-next-line no-restricted-syntax
                output[key] === null
            ) {
                delete output[key];
            }
        }

        return output;
    }

    /**
     * Prompt for password if this is a password based credential and the password for the profile was empty
     * and not explicitly set as empty. If it was explicitly set as empty, only prompt if pw not saved
     */
    public static shouldPromptForPassword(credentials: IConnectionInfo): boolean {
        let isSavedEmptyPassword: boolean =
            (<IConnectionProfile>credentials).emptyPasswordInput &&
            (<IConnectionProfile>credentials).savePassword;

        return (
            utils.isEmpty(credentials.password) &&
            ConnectionCredentials.isPasswordBasedCredential(credentials) &&
            !isSavedEmptyPassword
        );
    }

    public static isPasswordBasedCredential(credentials: IConnectionInfo): boolean {
        // TODO consider enum based verification and handling of AD auth here in the future
        let authenticationType = credentials.authenticationType;
        if (typeof credentials.authenticationType === "undefined") {
            authenticationType = utils.authTypeToString(AuthenticationTypes.SqlLogin);
        }
        return authenticationType === utils.authTypeToString(AuthenticationTypes.SqlLogin);
    }

    public static isPasswordBasedConnectionString(connectionString: string): boolean {
        const connString = connectionString.toLowerCase();
        return (
            (connString.includes("user") ||
                connString.includes("uid") ||
                connString.includes("userid")) &&
            (connString.includes("password") || connString.includes("pwd")) &&
            !connString.includes("Integrated Security")
        );
    }

    /**
     * Validates a string is not empty, returning undefined if true and an error message if not
     */
    protected static validateRequiredString(property: string, value: string): string {
        if (utils.isEmpty(value)) {
            return property + LocalizedConstants.msgIsRequired;
        }
        return undefined;
    }

    public static getAuthenticationTypesChoice(): INameValueChoice[] {
        let choices: INameValueChoice[] = [
            {
                name: LocalizedConstants.authTypeSql,
                value: utils.authTypeToString(AuthenticationTypes.SqlLogin),
            },
            {
                name: LocalizedConstants.authTypeIntegrated,
                value: utils.authTypeToString(AuthenticationTypes.Integrated),
            },
            {
                name: LocalizedConstants.authTypeAzureActiveDirectory,
                value: utils.authTypeToString(AuthenticationTypes.AzureMFA),
            },
        ];

        return choices;
    }
}
