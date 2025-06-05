/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import { DbCellValue, IConnectionProfile, IDbColumn } from "../models/interfaces";
import { generateGuid } from "../models/utils";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";

const CONNECTION_SHARING_PERMISSIONS_KEY = "mssql.connectionSharing.extensionPermissions";

type ConnectionSharingApproval = "approved" | "denied";
// Map of extension IDs to connection sharing approval status
type ConnectionSharingApprovalMap = Record<string, ConnectionSharingApproval>;

/**
 * Interface for connection sharing service
 * This service allows external extensions to use connections established by the mssql extension.
 */
export interface IConnectionSharingService {
    /**
     * Get the connection ID for the active editor.
     * @param extensionId The ID of the extension.
     * @returns The connection ID if an active editor is connected, or undefined if there is no active editor or the editor is not connected.
     */
    getConnectionIdForActiveEditor(extensionId: string): string | undefined;
    /**
     * Connect to an existing connection using the connection ID.
     * This will return the connection URI if successful.
     * @param extensionId The ID of the extension.
     * @param connectionId The ID of the connection.
     * @returns The connection URI if the connection is established successfully.
     * @throws Error if the connection cannot be established.
     */
    connect(extensionId: string, connectionId: string): Promise<string | undefined>;
    /**
     * Disconnect from a connection using the connection URI.
     * @param connectionUri The URI of the connection to disconnect from.
     */
    disconnect(connectionUri: string): void;
    /**
     * Check if a connection is currently established using the connection URI.
     * @param connectionUri The URI of the connection to check.
     * @returns True if the connection is established, false otherwise.
     */
    isConnected(connectionUri: string): boolean;
    /**
     * Execute a simple query on the database using the connection URI.
     * @param connectionUri The URI of the connection to use for executing the query.
     * @param queryString The SQL query to execute.
     * @returns A promise that resolves with the result of the query execution.
     */
    executeSimpleQuery(connectionUri: string, queryString: string): Promise<SimpleExecuteResult>;
    /**
     * Get server information using the connection URI.
     * @param connectionUri The URI of the connection to get server information from.
     * @returns A promise that resolves with the server information.
     */
    getServerInfo(connectionUri: string): mssql.IServerInfo;
}

export interface SimpleExecuteResult {
    rowCount: number;
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
}

export class ConnectionSharingService implements IConnectionSharingService {
    constructor(
        private context: vscode.ExtensionContext,
        private _client: SqlToolsServiceClient,
        private _connectionManager: ConnectionManager,
    ) {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getConnectionIdForActiveEditor",
                (extensionId: string) => this.getConnectionIdForActiveEditor(extensionId),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.connect",
                (extensionId: string, connectionId: string) =>
                    this.connect(extensionId, connectionId),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.disconnect",
                (connectionUri: string) => this.disconnect(connectionUri),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.isConnected",
                (connectionUri: string) => this.isConnected(connectionUri),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.executeSimpleQuery",
                (connectionUri: string, query: string) =>
                    this.executeSimpleQuery(connectionUri, query),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getServerInfo",
                (connectionUri: string) => this.getServerInfo(connectionUri),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.editConnectionSharingPermissions",
                async () => this.editConnectionSharingPermissions(),
            ),
        );
    }

    private async getExtensionPermissionsList(): Promise<ConnectionSharingApprovalMap> {
        const serializedList = await this.context.secrets.get(CONNECTION_SHARING_PERMISSIONS_KEY);
        if (!serializedList) {
            // If no approved extensions are found, initialize with an empty array
            await this.context.secrets.store(
                CONNECTION_SHARING_PERMISSIONS_KEY,
                JSON.stringify({} as ConnectionSharingApprovalMap),
            );
            return {};
        }
        return JSON.parse(serializedList) as ConnectionSharingApprovalMap;
    }

    private async setApprovedExtensions(extensions: ConnectionSharingApprovalMap): Promise<void> {
        await this.context.secrets.store(
            CONNECTION_SHARING_PERMISSIONS_KEY,
            JSON.stringify(extensions),
        );
    }

    private async getConnectionSharingApproval(
        extensionId: string,
    ): Promise<ConnectionSharingApproval> {
        const approvedExtensions = await this.getExtensionPermissionsList();
        return approvedExtensions[extensionId];
    }

    public async requestConnectionSharingApproval(extensionId: string): Promise<boolean> {
        const currentApproval = await this.getConnectionSharingApproval(extensionId);
        switch (currentApproval) {
            case "approved":
                return true; // Already approved
            case "denied":
                return false; // Already denied
            default:
                const addToApprovedRequest = await vscode.window.showInformationMessage(
                    LocalizedConstants.ConnectionSharing.connectionSharingRequestNotification(
                        extensionId,
                    ),
                    {},
                    "Approve",
                    "Deny",
                    "Clear",
                );

                switch (addToApprovedRequest) {
                    case "Approve":
                        await this.updateExtensionApproval(extensionId, "approved");
                        return true;
                    case "Deny":
                        await this.updateExtensionApproval(extensionId, "denied");
                        return false;
                    case "Clear":
                        // Clear the approval for this extension
                        const currentPermissions = await this.getExtensionPermissionsList();
                        delete currentPermissions[extensionId];
                        await this.setApprovedExtensions(currentPermissions);
                        return false; // Default to false if cleared
                    default:
                        // User canceled the action
                        if (currentApproval === undefined) {
                            // If no previous approval, default to false
                            return false;
                        }
                        return false;
                }
                return false; // Default to false if no action taken
        }
    }

    private async editConnectionSharingPermissions(): Promise<void> {
        const extensionsQuickPickItems: vscode.QuickPickItem[] = vscode.extensions.all.map(
            (extension) => {
                return {
                    label: this.getExtensionDisplayName(extension.id),
                    detail: extension.id,
                } as vscode.QuickPickItem;
            },
        );

        const selectedExtension = await vscode.window.showQuickPick(extensionsQuickPickItems, {
            canPickMany: false,
            placeHolder: "Select an extension to edit connection sharing permissions",
        });

        if (!selectedExtension) {
            return; // User canceled the selection
        }

        const extensionId = selectedExtension.detail;

        const currentApproval = await this.getConnectionSharingApproval(extensionId);

        const newPermission = await vscode.window.showQuickPick(
            [
                {
                    label: currentApproval === "approved" ? "Approve (Current)" : "Approve",
                    description: "Allow this extension to share connections",
                    detail: "approved",
                },
                {
                    label: currentApproval === "denied" ? "Deny (Current)" : "Deny",
                    description: "Do not allow this extension to share connections",
                    detail: "denied",
                },
            ],
            {
                placeHolder: `Select new permission for extension: ${this.getExtensionDisplayName(
                    extensionId,
                )}`,
            },
        );

        if (!newPermission) {
            return; // User canceled the selection
        }

        const newApproval: ConnectionSharingApproval =
            newPermission.detail as ConnectionSharingApproval;
        await this.updateExtensionApproval(extensionId, newApproval);
    }

    private async updateExtensionApproval(
        extensionId: string,
        newApproval: ConnectionSharingApproval,
    ): Promise<void> {
        return this.setApprovedExtensions({
            ...(await this.getExtensionPermissionsList()),
            [extensionId]: newApproval,
        });
    }

    private getExtensionDisplayName(extensionId: string): string {
        const extension = vscode.extensions.getExtension(extensionId);
        if (extension) {
            return `${extension.packageJSON.displayName} (${extensionId}), ${extension.packageJSON.publisher})`;
        }
        return extensionId;
    }

    public getConnectionIdForActiveEditor(extensionId: string): string | undefined {
        const approved = this.requestConnectionSharingApproval(extensionId);
        if (!approved) {
            return undefined; // Connection sharing not approved for this extension
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return undefined; // No active editor
        }
        const activeEditorUri = activeEditor.document.uri.toString(true);

        const isConnected = this._connectionManager.isConnected(activeEditorUri);

        if (!isConnected) {
            return undefined; // No active connection for the editor
        }
        const connectionDetails = this._connectionManager.getConnectionInfoFromUri(activeEditorUri);
        if (!connectionDetails) {
            return undefined; // No connection details found
        }

        return (connectionDetails as IConnectionProfile).id;
    }

    public async connect(extensionId: string, connectionId: string): Promise<string | undefined> {
        const connections =
            await this._connectionManager.connectionStore.connectionConfig.getConnections(false);
        const connection = connections.find((conn) => conn.id === connectionId);
        if (!connection) {
            throw new Error(
                `Connection with ID ${connectionId} not found. Please check the connection ID.`,
            );
        }
        const guid = generateGuid();
        const result = await this._connectionManager.connect(guid, connection);
        if (!result) {
            throw new Error(
                `Failed to connect to the database with ID ${connectionId}. Please check the connection details.`,
            );
        }
        return guid; // Return the connection URI
    }

    public disconnect(connectionUri: string): void {
        void this._connectionManager.disconnect(connectionUri);
    }

    public isConnected(connectionUri: string): boolean {
        return this._connectionManager.isConnected(connectionUri);
    }

    public async executeSimpleQuery(
        connectionUri: string,
        queryString: string,
    ): Promise<SimpleExecuteResult> {
        const result = await this._client.sendRequest(
            new RequestType<
                { ownerUri: string; queryString: string },
                SimpleExecuteResult,
                void,
                void
            >("query/simpleexecute"),
            {
                ownerUri: connectionUri,
                queryString: queryString,
            },
        );
        return result;
    }

    public getServerInfo(connectionUri: string): mssql.IServerInfo {
        const connectionDetails = this._connectionManager.getConnectionInfoFromUri(connectionUri);
        return this._connectionManager.getServerInfo(connectionDetails);
    }
}
