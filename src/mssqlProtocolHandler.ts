/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import SqlToolsServiceClient from "./languageservice/serviceclient";
import { CapabilitiesResult, GetCapabilitiesRequest } from "./models/contracts/connection";
import { IConnectionProfile } from "./models/interfaces";
import { AuthenticationType } from "./sharedInterfaces/connectionDialog";
import { Logger } from "./models/logger";
import VscodeWrapper from "./controllers/vscodeWrapper";
import MainController from "./controllers/mainController";
import { cmdAddObjectExplorer } from "./constants/constants";

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
    private _logger: Logger;

    constructor(
        vscodeWrapper: VscodeWrapper,
        private mainController: MainController,
        private client: SqlToolsServiceClient,
    ) {
        this._logger = Logger.create(vscodeWrapper.outputChannel, "MssqlProtocolHandler");
    }

    /**
     * Handles the given URI and returns connection information if applicable. Examples of URIs handled:
     * - vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&user=sa&authenticationType=SqlLogin
     * - vscode://ms-mssql.mssql/connect?connectionString=Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;
     *
     * @param uri - The URI to handle.
     * @returns The connection information or undefined if not applicable.
     */
    public async handleUri(uri: vscode.Uri): Promise<void> {
        this._logger.info(`URI: ${uri.toString()}`);

        switch (uri.path) {
            // Attempt to find an existing connection profile based on the provided parameters. If not found, open the connection dialog.
            case Command.connect:
                await this.handleConnectCommand(uri);
                return;

            // Open the connection dialog, pre-filled with the provided parameters.
            case Command.openConnectionDialog:
                await this.handleOpenConnectionDialogCommand(uri);
                return;

            // Default behavior for unknown URIs: open the connection dialog with no pre-filled parameters
            default: {
                this._logger.warn(
                    `Unknown URI action '${uri.path}'; defaulting to ${Command.openConnectionDialog}`,
                );

                this.openConnectionDialog(undefined);
                return;
            }
        }
    }

    private async handleOpenConnectionDialogCommand(uri: vscode.Uri) {
        const connProfile = await this.readProfileFromArgs(uri.query);
        this.openConnectionDialog(connProfile);
    }

    private async handleConnectCommand(uri: vscode.Uri) {
        this._logger.info(`connect: ${uri.path}`);
        const parsedProfile = await this.readProfileFromArgs(uri.query);

        if (!parsedProfile) {
            this.openConnectionDialog(parsedProfile);
            return;
        }

        // Just the server and database are required to match, but it will also consider other factors
        // like auth and auxiliary settings to pick the best one.
        const { profile: foundProfile } =
            await this.mainController.connectionManager.findMatchingProfile(parsedProfile);

        if (foundProfile) {
            await this.connectProfile(foundProfile);
        } else {
            this.openConnectionDialog(parsedProfile);
        }
    }

    private async connectProfile(profile: IConnectionProfile): Promise<void> {
        const node = await this.mainController.createObjectExplorerSession(profile);
        await this.mainController.objectExplorerTree.reveal(node, {
            focus: true,
            select: true,
            expand: true,
        });
    }

    private openConnectionDialog(connProfile: IConnectionProfile | undefined): void {
        vscode.commands.executeCommand(cmdAddObjectExplorer, connProfile);
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

            // eslint-disable-next-line no-restricted-syntax
            if (propValue === undefined || propValue === null) {
                if (propName === "savePassword") {
                    connectionInfo[propName] = true; // default to saving password if not specified
                }

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
