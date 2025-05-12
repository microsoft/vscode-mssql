/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "./models/utils";
import { AuthenticationType, IConnectionInfo } from "vscode-mssql";
import SqlToolsServiceClient from "./languageservice/serviceclient";
import { CapabilitiesResult, GetCapabilitiesRequest } from "./models/contracts/connection";
import { IConnectionProfile } from "./models/interfaces";

enum Command {
    connect = "/connect",
    openConnectionDialog = "/openConnectionDialog",
}

interface ConnectionOptionProperty {
    name: keyof IConnectionInfo;
    type: "string" | "number" | "boolean" | "category" | "password";
}

/**
 * Handles MSSQL protocol URIs.
 */
export class MssqlProtocolHandler {
    constructor(private client: SqlToolsServiceClient) {}

    /**
     * Handles the given URI and returns connection information if applicable. Examples of URIs handled:
     * - vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&user=sa&authenticationType=SqlLogin
     * - vscode://ms-mssql.mssql/connect?connectionString=Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;
     *
     * @param uri - The URI to handle.
     * @returns The connection information or undefined if not applicable.
     */
    public handleUri(uri: vscode.Uri): Promise<IConnectionProfile | undefined> {
        Utils.logDebug(`[MssqlProtocolHandler][handleUri] URI: ${uri.toString()}`);

        switch (uri.path) {
            case Command.connect:
                Utils.logDebug(`[MssqlProtocolHandler][handleUri] connect: ${uri.path}`);

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
    private connect(uri: vscode.Uri): Promise<IConnectionProfile | undefined> {
        return this.readProfileFromArgs(uri.query);
    }

    /**
     * Reads the profile information from the query string and returns an IConnectionInfo object.
     *
     * @param query - The query string containing connection information.
     * @returns The connection information object or undefined if the query is empty.
     */
    private async readProfileFromArgs(query: string): Promise<IConnectionProfile | undefined> {
        if (!query) {
            return undefined;
        }

        const capabilitiesResult: CapabilitiesResult = await this.client.sendRequest(
            GetCapabilitiesRequest.type,
            {},
        );
        const connectionOptions = capabilitiesResult.capabilities.connectionProvider.options;

        const connectionInfo = {};
        const args = new URLSearchParams(query);

        const profileName = args.get("profileName");
        if (profileName) {
            connectionInfo["profileName"] = profileName;
        }

        const connectionString = args.get("connectionString");
        if (connectionString) {
            connectionInfo["connectionString"] = connectionString;
            return connectionInfo as IConnectionProfile;
        }

        const connectionOptionProperties: ConnectionOptionProperty[] = connectionOptions.map(
            (option) =>
                ({
                    name: option.name as keyof IConnectionProfile,
                    type: option.valueType,
                }) as ConnectionOptionProperty,
        );

        for (const property of connectionOptionProperties) {
            const propName = property.name as string;
            const propValue: string | undefined = args.get(propName);

            if (propValue === undefined || propValue === null) {
                continue;
            }

            switch (property.type) {
                case "string":
                case "category":
                case "password":
                    connectionInfo[propName] = propValue;
                    break;

                case "number":
                    const numericalValue = parseInt(propValue);
                    if (!isNaN(numericalValue)) {
                        connectionInfo[propName] = numericalValue;
                    }
                    break;

                case "boolean":
                    connectionInfo[propName] = propValue === "true" || propValue === "1";
                    break;

                default:
                    break;
            }
        }

        const result = connectionInfo as IConnectionProfile;
        result.authenticationType ??= AuthenticationType.SqlLogin;
        result.savePassword ??= !!result.password; // propose saving password if one is provided

        return result;
    }
}
