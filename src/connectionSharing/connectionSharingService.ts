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
                async (extensionId?: string) => this.editConnectionSharingPermissions(extensionId),
            ),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.clearAllConnectionSharingPermissions",
                async () => {
                    await this.setApprovedExtensions({});
                    vscode.window.showInformationMessage(
                        "All connection sharing permissions have been cleared.",
                    );
                },
            ),
        );
    }

    private async getExtensionPermissionsList(): Promise<ConnectionSharingApprovalMap> {
        const serializedList = await this.context.secrets.get(CONNECTION_SHARING_PERMISSIONS_KEY);
        console.log("serializedList", serializedList);
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
    ): Promise<ConnectionSharingApproval | undefined> {
        const approvedExtensions = await this.getExtensionPermissionsList();
        console.log("approvedExtensions", approvedExtensions);
        return approvedExtensions[extensionId];
    }

    private async requestConnectionSharingApproval(extensionId: string): Promise<boolean> {
        const currentApproval = await this.getConnectionSharingApproval(extensionId);
        if (currentApproval === "approved") {
            return true; // Already approved
        } else if (currentApproval === "denied") {
            return false; // Already denied
        } else {
            console.log("Default case for connection sharing approval");
            const addToApprovedRequest = await vscode.window.showInformationMessage(
                LocalizedConstants.ConnectionSharing.connectionSharingRequestNotification(
                    extensionId,
                ),
                {},
                "Approve",
                "Deny",
            );

            if (!addToApprovedRequest) {
                // User canceled the action
                return false;
            }
            switch (addToApprovedRequest) {
                case "Approve":
                    await this.updateExtensionApproval(extensionId, "approved");
                    return true;
                case "Deny":
                    await this.updateExtensionApproval(extensionId, "denied");
                    return false;
            }
        }
    }

    public async editConnectionSharingPermissions(
        extensionId?: string,
    ): Promise<ConnectionSharingApproval | undefined> {
        const extensionsQuickPickItems: vscode.QuickPickItem[] = vscode.extensions.all.map(
            (extension) => {
                return {
                    label: this.getExtensionDisplayName(extension.id),
                    detail: extension.id,
                } as vscode.QuickPickItem;
            },
        );

        if (!extensionId) {
            extensionId = (
                await vscode.window.showQuickPick(extensionsQuickPickItems, {
                    canPickMany: false,
                    placeHolder: "Select an extension to edit connection sharing permissions",
                })
            ).detail;
        }

        console.log("selectedExtensionId", extensionId);

        const currentApproval = await this.getConnectionSharingApproval(extensionId);

        console.log("currentApproval", currentApproval);

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

        console.log("newPermission", newPermission);

        if (!newPermission) {
            return; // User canceled the selection
        }

        const newApproval: ConnectionSharingApproval =
            newPermission.detail as ConnectionSharingApproval;
        await this.updateExtensionApproval(extensionId, newApproval);

        return newApproval;
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
            throw new Error(
                `Connection sharing not approved for extension ${extensionId}. Please approve the extension to share connections.`,
            );
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
        const approved = await this.requestConnectionSharingApproval(extensionId);
        if (!approved) {
            throw new Error(
                `Connection sharing not approved for extension ${extensionId}. Please approve the extension to share connections.`,
            );
        }
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
    ): Promise<mssql.SimpleExecuteResult> {
        const result = await this._client.sendRequest(
            new RequestType<
                { ownerUri: string; queryString: string },
                mssql.SimpleExecuteResult,
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
