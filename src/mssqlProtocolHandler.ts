/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import * as Loc from "./constants/locConstants";
import SqlToolsServiceClient from "./languageservice/serviceclient";
import { CapabilitiesResult, GetCapabilitiesRequest } from "./models/contracts/connection";
import { IConnectionProfile } from "./models/interfaces";
import { AuthenticationType } from "./sharedInterfaces/connectionDialog";
import { Logger } from "./models/logger";
import VscodeWrapper from "./controllers/vscodeWrapper";
import MainController from "./controllers/mainController";
import { cmdAddObjectExplorer } from "./constants/constants";
import { getConnectionDisplayName } from "./models/connectionInfo";
import { MatchScore } from "./models/utils";

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
        const parsedProfile = await this.readProfileFromArgs(uri.query);

        if (!parsedProfile) {
            this.openConnectionDialog(parsedProfile);
            return;
        }

        // Just the server and database are required to match, but it will also consider other factors
        // like auth and auxiliary settings to pick the best one.
        const { profile: foundProfile, score } =
            await this.mainController.connectionManager.findMatchingProfile(parsedProfile);

        // If the database is specified, only connect automatically if both server and database match.
        // If no database is specified, connecting based on server alone is sufficient.
        if (
            foundProfile && // minimum requirement is a server match
            (!parsedProfile.database || score >= MatchScore.ServerAndDatabase) && // also require database match if specified
            ((!parsedProfile.accountId && !parsedProfile.user) || // also require auth match if specified
                score >= MatchScore.ServerDatabaseAndAuth)
        ) {
            this._logger.info(`Matching profile found for ${uri.query}; connecting...`);
            await this.connectProfile(foundProfile);
        } else {
            this._logger.info(
                `No matching profile found for ${uri.query}; opening connection dialog...`,
            );
            this.openConnectionDialog(parsedProfile);
        }
    }

    private async connectProfile(profile: IConnectionProfile): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: Loc.Connection.connectingToProfile(getConnectionDisplayName(profile)),
                cancellable: false,
            },
            async () => {
                const node = await this.mainController.createObjectExplorerSession(profile);
                await this.mainController.objectExplorerTree.reveal(node, {
                    focus: true,
                    select: true,
                    expand: true,
                });

                await vscode.commands.executeCommand("objectExplorer.focus");
            },
        );
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

        const connectionInfo: IConnectionProfile = {} as IConnectionProfile;
        const args = new URLSearchParams(query);

        this.fillConnectionProperty(connectionInfo, args, "profileName");

        const connString = this.fillConnectionProperty(connectionInfo, args, "connectionString");
        if (connString) {
            return connectionInfo as IConnectionProfile;
        }

        this.fillConnectionProperty(connectionInfo, args, "tenantId");
        this.fillConnectionProperty(connectionInfo, args, "accountId");

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

    /**
     * Fills a connection property from the URL parameters.
     * Used for additional connection metadata that isn't one of the standard connection options supplied by SQL Tools Service.
     */
    private fillConnectionProperty(
        connectionInfo: IConnectionProfile,
        args: URLSearchParams,
        property: keyof IConnectionProfile,
    ): string | undefined {
        const value = args.get(property as string);
        if (value) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (connectionInfo as Record<string, any>)[property] = value;
            return value;
        } else {
            return undefined;
        }
    }
}
