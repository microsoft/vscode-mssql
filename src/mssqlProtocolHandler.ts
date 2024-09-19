/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "./models/utils";
import { IConnectionInfo } from "vscode-mssql";

enum Command {
    connect = "/connect",
    openConnectionDialog = "/openConnectionDialog",
}

/**
 * Handles MSSQL protocol URIs.
 */
export class MssqlProtocolHandler {
    constructor() {}

    /**
     * Handles the given URI and returns connection information if applicable. Examples of URIs handled:
     * - vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&user=sa&authenticationType=SqlLogin
     * - vscode://ms-mssql.mssql/connect?connectionString=Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;
     *
     * @param uri - The URI to handle.
     * @returns The connection information or undefined if not applicable.
     */
    public handleUri(uri: vscode.Uri): IConnectionInfo | undefined {
        Utils.logDebug(
            `[MssqlProtocolHandler][handleUri] URI: ${uri.toString()}`,
        );

        switch (uri.path) {
            case Command.connect:
                Utils.logDebug(
                    `[MssqlProtocolHandler][handleUri] connect: ${uri.path}`,
                );

                return this.connect(uri);

            case Command.openConnectionDialog:
                return undefined;

            default:
                Utils.logDebug(
                    `[MssqlProtocolHandler][handleUri] Unknown URI path, defaulting to connect: ${uri.path}`,
                );

                return this.connect(uri);
        }
    }

    /**
     * Connects using the given URI.
     *
     * @param uri - The URI containing connection information.
     * @returns The connection information or undefined if not applicable.
     */
    private connect(uri: vscode.Uri): IConnectionInfo | undefined {
        return this.readProfileFromArgs(uri.query);
    }

    /**
     * Reads the profile information from the query string and returns an IConnectionInfo object.
     *
     * @param query - The query string containing connection information.
     * @returns The connection information object or undefined if the query is empty.
     */
    private readProfileFromArgs(query: string): IConnectionInfo | undefined {
        if (!query) {
            return undefined;
        }

        const args = new URLSearchParams(query);

        const connectionString = args.get("connectionString") ?? undefined;
        if (connectionString !== undefined) {
            return {
                connectionString,
            } as IConnectionInfo;
        }

        const server = args.get("server") ?? "";
        const database = args.get("database") ?? "";
        const user = args.get("user") ?? "";
        const email = args.get("email") ?? "";
        const accountId = args.get("accountId") ?? "";
        const tenantId = args.get("tenantId") ?? "";

        const portValue = parseInt(args.get("port"));
        const port = isNaN(portValue) ? 0 : portValue;

        /*
            Authentication Type:
            1. Take --authenticationType, if not
            2. Take --integrated, if not
            3. take --aad, if not
            4. If user exists, and user has @, then it's azureMFA
            5. If user exists but doesn't have @, then its SqlLogin
            6. If user doesn't exist, then integrated
        */
        const authenticationType = args.get("authenticationType")
            ? args.get("authenticationType")
            : args.get("integrated")
              ? "Integrated"
              : args.get("aad")
                ? "AzureMFA"
                : user && user.length > 0
                  ? user.includes("@")
                      ? "AzureMFA"
                      : "SqlLogin"
                  : "Integrated";

        const azureAccountToken = args.get("azureAccountToken") ?? undefined;

        const expiresOnValue = parseInt(args.get("expiresOn"));
        const expiresOn = isNaN(expiresOnValue) ? undefined : expiresOnValue;

        const encryptValueFlag = parseInt(args.get("encrypt"));
        const encryptValueStr = args.get("encrypt") ?? "Mandatory"; // default to Mandatory
        const encrypt = isNaN(encryptValueFlag)
            ? encryptValueStr
            : encryptValueFlag === 1;

        const trustServerCertificateValue = parseInt(
            args.get("trustServerCertificate"),
        );
        const trustServerCertificate = isNaN(trustServerCertificateValue)
            ? undefined
            : trustServerCertificateValue === 1;

        const hostNameInCertificate =
            args.get("hostNameInCertificate") ?? undefined;

        const persistSecurityInfoValue = parseInt(
            args.get("persistSecurityInfo"),
        );
        const persistSecurityInfo = isNaN(persistSecurityInfoValue)
            ? undefined
            : persistSecurityInfoValue === 1;

        const columnEncryptionSetting =
            args.get("columnEncryptionSetting") ?? undefined;
        const attestationProtocol =
            args.get("attestationProtocol") ?? undefined;
        const enclaveAttestationUrl =
            args.get("enclaveAttestationUrl") ?? undefined;

        const connectTimeoutValue = parseInt(args.get("connectTimeout"));
        const connectTimeout = isNaN(connectTimeoutValue)
            ? undefined
            : connectTimeoutValue;

        const commandTimeoutValue = parseInt(args.get("commandTimeout"));
        const commandTimeout = isNaN(commandTimeoutValue)
            ? undefined
            : commandTimeoutValue;

        const connectRetryCountValue = parseInt(args.get("connectRetryCount"));
        const connectRetryCount = isNaN(connectRetryCountValue)
            ? undefined
            : connectRetryCountValue;

        const connectRetryIntervalValue = parseInt(
            args.get("connectRetryInterval"),
        );
        const connectRetryInterval = isNaN(connectRetryIntervalValue)
            ? undefined
            : connectRetryIntervalValue;

        const applicationName = args.get("applicationName")
            ? `${args.get("applicationName")}-azdata`
            : "azdata";

        const workstationId = args.get("workstationId") ?? undefined;
        const applicationIntent = args.get("applicationIntent") ?? undefined;
        const currentLanguage = args.get("currentLanguage") ?? undefined;

        const poolingValue = parseInt(args.get("pooling"));
        const pooling = isNaN(poolingValue) ? undefined : poolingValue === 1;

        const maxPoolSizeValue = parseInt(args.get("maxPoolSize"));
        const maxPoolSize = isNaN(maxPoolSizeValue)
            ? undefined
            : maxPoolSizeValue;

        const minPoolSizeValue = parseInt(args.get("minPoolSize"));
        const minPoolSize = isNaN(minPoolSizeValue)
            ? undefined
            : minPoolSizeValue;

        const loadBalanceTimeoutValue = parseInt(
            args.get("loadBalanceTimeout"),
        );
        const loadBalanceTimeout = isNaN(loadBalanceTimeoutValue)
            ? undefined
            : loadBalanceTimeoutValue;

        const replicationValue = parseInt(args.get("replication"));
        const replication = isNaN(replicationValue)
            ? undefined
            : replicationValue === 1;

        const attachDbFilename = args.get("attachDbFilename") ?? undefined;
        const failoverPartner = args.get("failoverPartner") ?? undefined;

        const multiSubnetFailoverValue = parseInt(
            args.get("multiSubnetFailover"),
        );
        const multiSubnetFailover = isNaN(multiSubnetFailoverValue)
            ? undefined
            : multiSubnetFailoverValue === 1;

        const multipleActiveResultSetsValue = parseInt(
            args.get("multipleActiveResultSets"),
        );
        const multipleActiveResultSets = isNaN(multipleActiveResultSetsValue)
            ? undefined
            : multipleActiveResultSetsValue === 1;

        const packetSizeValue = parseInt(args.get("packetSize"));
        const packetSize = isNaN(packetSizeValue) ? undefined : packetSizeValue;

        const typeSystemVersion = args.get("typeSystemVersion") ?? undefined;

        return {
            server,
            database,
            user,
            email,
            accountId,
            tenantId,
            port,
            authenticationType,
            azureAccountToken,
            expiresOn,
            encrypt,
            trustServerCertificate,
            hostNameInCertificate,
            persistSecurityInfo,
            columnEncryptionSetting,
            attestationProtocol,
            enclaveAttestationUrl,
            connectTimeout,
            commandTimeout,
            connectRetryCount,
            connectRetryInterval,
            applicationName,
            workstationId,
            applicationIntent,
            currentLanguage,
            pooling,
            maxPoolSize,
            minPoolSize,
            loadBalanceTimeout,
            replication,
            attachDbFilename,
            failoverPartner,
            multiSubnetFailover,
            multipleActiveResultSets,
            packetSize,
            typeSystemVersion,
            connectionString,
        } as IConnectionInfo;
    }
}
