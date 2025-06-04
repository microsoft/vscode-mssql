/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import { IConnectionProfile } from "../models/interfaces";
import { generateGuid } from "../models/utils";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { SimpleExecuteResult } from "azdata";
import { RequestType } from "vscode-languageclient";

const CONNECTION_SHARING_PERMISSIONS_KEY = "mssql.connectionSharing.extensionPermissions";

type ConnectionSharingApproval = "approved" | "denied";
// Map of extension IDs to connection sharing approval status
type ConnectionSharingApprovalMap = Record<string, ConnectionSharingApproval>;

export class ConnectionSharingService implements mssql.IConnectionSharingService {
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

    async requestConnectionSharingApproval(extensionId: string): Promise<boolean> {
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
                );

                switch (addToApprovedRequest) {
                    case "Approve":
                        await this.updateExtensionApproval(extensionId, "approved");
                        return true;
                    case "Deny":
                        await this.updateExtensionApproval(extensionId, "denied");
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
                    label: "Approve",
                    description: "Allow this extension to share connections",
                    detail: "approved",
                },
                {
                    label: "Deny",
                    description: "Do not allow this extension to share connections",
                    detail: "denied",
                },
            ],
            {
                placeHolder: `Current permission for ${this.getExtensionDisplayName(extensionId)} is "${currentApproval}". Select new permission.`,
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

    getConnectionIdForActiveEditor(extensionId: string): string | undefined {
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

    async connect(extensionId: string, connectionId: string): Promise<string | undefined> {
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

    disconnect(connectionUri: string): void {
        void this._connectionManager.disconnect(connectionUri);
    }

    isConnected(connectionUri: string): boolean {
        return this._connectionManager.isConnected(connectionUri);
    }

    async executeSimpleQuery(connectionUri: string, query: string): Promise<SimpleExecuteResult> {
        const result = await this._client.sendRequest(
            new RequestType<{ ownerUri: string; query: string }, SimpleExecuteResult, void, void>(
                "query/simpleexecute",
            ),
            {
                ownerUri: connectionUri,
                query,
            },
        );
        return result;
    }

    getServerInfo(connectionUri: string): mssql.IServerInfo {
        const connectionDetails = this._connectionManager.getConnectionInfoFromUri(connectionUri);
        return this._connectionManager.getServerInfo(connectionDetails);
    }
}
