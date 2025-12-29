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
import VscodeWrapper from "../controllers/vscodeWrapper";
import { Logger } from "../models/logger";
import * as Constants from "../constants/constants";
import { ScriptingService } from "../scripting/scriptingService";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";

const CONNECTION_SHARING_PERMISSIONS_KEY = "mssql.connectionSharing.extensionPermissions";

type ExtensionPermission = "approved" | "denied";
type ExtensionPermissionsMap = Record<string, ExtensionPermission>;

export enum ConnectionSharingErrorCode {
    PERMISSION_DENIED = "PERMISSION_DENIED",
    PERMISSION_REQUIRED = "PERMISSION_REQUIRED",
    NO_ACTIVE_EDITOR = "NO_ACTIVE_EDITOR",
    NO_ACTIVE_CONNECTION = "NO_ACTIVE_CONNECTION",
    CONNECTION_NOT_FOUND = "CONNECTION_NOT_FOUND",
    CONNECTION_FAILED = "CONNECTION_FAILED",
    INVALID_CONNECTION_URI = "INVALID_CONNECTION_URI",
    QUERY_EXECUTION_FAILED = "QUERY_EXECUTION_FAILED",
    EXTENSION_NOT_FOUND = "EXTENSION_NOT_FOUND",
}

export class ConnectionSharingError extends Error {
    constructor(
        public readonly code: ConnectionSharingErrorCode,
        message: string,
        public readonly extensionId?: string,
        public readonly connectionId?: string,
    ) {
        super(message);
        this.name = "ConnectionSharingError";
    }
}

export class ConnectionSharingService implements mssql.IConnectionSharingService {
    private _logger: Logger;
    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: SqlToolsServiceClient,
        private readonly _connectionManager: ConnectionManager,
        private readonly _vscodeWrapper: VscodeWrapper,
        private readonly _scriptingService: ScriptingService,
    ) {
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ConnectionSharingService");
        this.registerCommands();
    }

    private registerCommands(): void {
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getActiveEditorConnectionId",
                (extensionId: string) => this.getActiveEditorConnectionId(extensionId),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getActiveDatabase",
                (extensionId: string) => this.getActiveDatabase(extensionId),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getDatabaseForConnectionId",
                (extensionId: string, connectionId: string) =>
                    this.getDatabaseForConnectionId(extensionId, connectionId),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.connect",
                (extensionId: string, connectionId: string, databaseName?: string) =>
                    this.connect(extensionId, connectionId, databaseName),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.disconnect",
                (connectionUri: string) => this.disconnect(connectionUri),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.isConnected",
                (connectionUri: string) => this.isConnected(connectionUri),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.executeSimpleQuery",
                (connectionUri: string, query: string) =>
                    this.executeSimpleQuery(connectionUri, query),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getServerInfo",
                (connectionUri: string) => this.getServerInfo(connectionUri),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.editConnectionSharingPermissions",
                async (extensionId?: string) => this.editConnectionSharingPermissions(extensionId),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.listDatabases",
                (connectionUri: string) => this.listDatabases(connectionUri),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.scriptOperation",
                (
                    connectionUri: string,
                    operation: ScriptOperation,
                    scriptingObject: mssql.IScriptingObject,
                ) => this.scriptObject(connectionUri, operation, scriptingObject),
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.clearAllConnectionSharingPermissions",
                async () => {
                    const response = await vscode.window.showInformationMessage(
                        LocalizedConstants.ConnectionSharing.ClearAllPermissions,
                        LocalizedConstants.ConnectionSharing.Clear,
                        LocalizedConstants.ConnectionSharing.Cancel,
                    );

                    if (response !== LocalizedConstants.ConnectionSharing.Clear) {
                        this._logger.info("User canceled clearing connection sharing permissions.");
                        return;
                    }
                    await this.setApprovedExtensions({});
                    vscode.window.showInformationMessage(
                        LocalizedConstants.ConnectionSharing.AllPermissionsCleared,
                    );
                },
            ),
        );

        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                "mssql.connectionSharing.getConnectionString",
                (extensionId: string, connectionId: string) =>
                    this.getConnectionString(extensionId, connectionId),
            ),
        );
    }

    private async getStoredExtensionPermissions(): Promise<ExtensionPermissionsMap> {
        const serializedPermissions = await this._context.secrets.get(
            CONNECTION_SHARING_PERMISSIONS_KEY,
        );

        if (!serializedPermissions) {
            // If no approved extensions are found, initialize with an empty array
            const emptyPermissions: ExtensionPermissionsMap = {};
            await this.storeExtensionPermissions(emptyPermissions);
            return emptyPermissions;
        }
        try {
            return JSON.parse(serializedPermissions) as ExtensionPermissionsMap;
        } catch (error) {
            this._logger.error("Failed to parse stored extension permissions:", error);
            const emptyPermissions: ExtensionPermissionsMap = {};
            await this.storeExtensionPermissions(emptyPermissions);
            return emptyPermissions;
        }
    }

    private async storeExtensionPermissions(permissions: ExtensionPermissionsMap): Promise<void> {
        await this._context.secrets.store(
            CONNECTION_SHARING_PERMISSIONS_KEY,
            JSON.stringify(permissions),
        );
    }

    private async getExtensionPermission(
        extensionId: string,
    ): Promise<ExtensionPermission | undefined> {
        const approvedExtensions = await this.getStoredExtensionPermissions();
        return approvedExtensions[extensionId];
    }

    private async updateExtensionPermission(
        extensionId: string,
        newPermission: ExtensionPermission,
    ): Promise<void> {
        const currentPermissions = await this.getStoredExtensionPermissions();
        const updatedPermissions = {
            ...currentPermissions,
            [extensionId]: newPermission,
        };
        await this.storeExtensionPermissions(updatedPermissions);
    }

    private async setApprovedExtensions(extensions: ExtensionPermissionsMap): Promise<void> {
        await this._context.secrets.store(
            CONNECTION_SHARING_PERMISSIONS_KEY,
            JSON.stringify(extensions),
        );
    }

    private async requestConnectionSharingPermission(extensionId: string): Promise<boolean> {
        this._logger.info(`Requesting connection sharing permission for extension: ${extensionId}`);

        const currentPermission = await this.getExtensionPermission(extensionId);

        if (currentPermission === "approved") {
            this._logger.info(`Connection sharing already approved for extension: ${extensionId}`);
            return true;
        }

        if (currentPermission === "denied") {
            this._logger.info(`Connection sharing denied for extension: ${extensionId}`);
            return false;
        }

        this._logger.info(
            `No existing permission for extension: ${extensionId}, requesting approval`,
        );

        const userChoice = await vscode.window.showInformationMessage(
            LocalizedConstants.ConnectionSharing.connectionSharingRequestNotification(extensionId),
            {},
            LocalizedConstants.ConnectionSharing.Approve,
            LocalizedConstants.ConnectionSharing.Deny,
        );

        if (!userChoice) {
            this._logger.info(
                `User canceled connection sharing request for extension: ${extensionId}`,
            );
            return false;
        }

        switch (userChoice) {
            case "Approve":
                this._logger.info(`User approved connection sharing for extension: ${extensionId}`);
                await this.updateExtensionPermission(extensionId, "approved");
                return true;
            case "Deny":
                this._logger.info(`User denied connection sharing for extension: ${extensionId}`);
                await this.updateExtensionPermission(extensionId, "denied");
                return false;
        }
    }

    private async validateExtensionPermission(extensionId: string): Promise<void> {
        const hasPermission = await this.requestConnectionSharingPermission(extensionId);

        if (!hasPermission) {
            const currentStatus = await this.getExtensionPermission(extensionId);

            if (currentStatus === "denied") {
                throw new ConnectionSharingError(
                    ConnectionSharingErrorCode.PERMISSION_DENIED,
                    LocalizedConstants.ConnectionSharing.permissionDenied(extensionId),
                    extensionId,
                );
            } else {
                throw new ConnectionSharingError(
                    ConnectionSharingErrorCode.PERMISSION_REQUIRED,
                    LocalizedConstants.ConnectionSharing.permissionRequired(extensionId),
                    extensionId,
                );
            }
        }
    }

    private validateConnection(connectionUri: string) {
        if (!connectionUri) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                LocalizedConstants.ConnectionSharing.invalidConnectionUri,
            );
        }

        if (!this._connectionManager.isConnected(connectionUri)) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                LocalizedConstants.ConnectionSharing.connectionNotActive,
            );
        }
    }

    private getExtensionDisplayName(extensionId: string): string {
        const extension = vscode.extensions.getExtension(extensionId);
        if (extension) {
            return `${extension.packageJSON.displayName} (${extensionId}), ${extension.packageJSON.publisher})`;
        }
        return extensionId;
    }

    public async getActiveEditorConnectionId(extensionId: string): Promise<string | undefined> {
        await this.validateExtensionPermission(extensionId);

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                LocalizedConstants.ConnectionSharing.noActiveEditorError,
                extensionId,
            );
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

    public async getActiveDatabase(extensionId: string): Promise<string | undefined> {
        await this.validateExtensionPermission(extensionId);

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                LocalizedConstants.ConnectionSharing.noActiveEditorError,
                extensionId,
            );
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

        return connectionDetails.database;
    }

    public async getDatabaseForConnectionId(
        extensionId: string,
        connectionId: string,
    ): Promise<string | undefined> {
        await this.validateExtensionPermission(extensionId);

        const connections =
            await this._connectionManager.connectionStore.connectionConfig.getConnections();
        const targetConnection = connections.find((conn) => conn.id === connectionId);

        if (!targetConnection) {
            return undefined; // Connection not found
        }

        return targetConnection.database;
    }

    public async connect(
        extensionId: string,
        connectionId: string,
        databaseName?: string,
    ): Promise<string | undefined> {
        await this.validateExtensionPermission(extensionId);

        const connections =
            await this._connectionManager.connectionStore.connectionConfig.getConnections();
        const targetConnection = connections.find((conn) => conn.id === connectionId);

        if (!targetConnection) {
            this._logger.error(
                `Connection with ID "${connectionId}" not found for extension "${extensionId}".`,
            );
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                LocalizedConstants.ConnectionSharing.connectionNotFoundError(connectionId),
                extensionId,
                connectionId,
            );
        }

        const connectionUri = generateGuid();
        if (databaseName) {
            targetConnection.database = databaseName; // Set the database if provided
        }
        const connectionResult = await this._connectionManager.connect(
            connectionUri,
            targetConnection,
            {
                connectionSource: "connectionSharingService",
            },
        );

        if (!connectionResult) {
            this._logger.error(
                `Failed to establish connection with ID "${connectionId}" for extension "${extensionId}".`,
            );
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.CONNECTION_FAILED,
                LocalizedConstants.ConnectionSharing.failedToEstablishConnectionError(connectionId),
                extensionId,
                connectionId,
            );
        }
        this._logger.info(
            `Successfully connected to database with ID "${connectionId}" for extension "${extensionId}".`,
        );
        return connectionUri; // Return the connection URI
    }

    public disconnect(connectionUri: string): void {
        if (!connectionUri) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                LocalizedConstants.ConnectionSharing.invalidConnectionUri,
            );
        }
        void this._connectionManager.disconnect(connectionUri);
    }

    public isConnected(connectionUri: string): boolean {
        if (!connectionUri) {
            return false;
        }
        return this._connectionManager.isConnected(connectionUri);
    }

    public async executeSimpleQuery(
        connectionUri: string,
        queryString: string,
    ): Promise<mssql.SimpleExecuteResult> {
        if (!connectionUri) {
            this._logger.error("Invalid connection URI provided for query execution.");
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                LocalizedConstants.ConnectionSharing.invalidConnectionUri,
            );
        }

        if (!this.isConnected(connectionUri)) {
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                LocalizedConstants.ConnectionSharing.connectionNotActive,
            );
        }

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
        this._logger.info(`Retrieving server info for connection URI: ${connectionUri}`);
        this.validateConnection(connectionUri);
        const connectionDetails = this._connectionManager.getConnectionInfoFromUri(connectionUri);
        return this._connectionManager.getServerInfo(connectionDetails);
    }

    public async listDatabases(connectionUri: string): Promise<string[]> {
        this._logger.info(`Listing databases for connection URI: ${connectionUri}`);
        this.validateConnection(connectionUri);
        return await this._connectionManager.listDatabases(connectionUri);
    }

    public async scriptObject(
        connectionUri: string,
        operation: ScriptOperation,
        scriptingObject: mssql.IScriptingObject,
    ) {
        this._logger.info(
            `Executing script operation "${operation}" for connection URI: ${connectionUri}`,
        );
        this.validateConnection(connectionUri);
        const serverInfo = this.getServerInfo(connectionUri); // Ensure connection is valid
        const scriptingParams = this._scriptingService.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            connectionUri,
            operation,
        );
        return await this._scriptingService.script(scriptingParams);
    }

    public async editConnectionSharingPermissions(
        extensionId?: string,
    ): Promise<ExtensionPermission | undefined> {
        this._logger.info(
            `Editing connection sharing permissions for extension: ${extensionId ?? "not specified"}`,
        );
        if (!extensionId) {
            this._logger.info("No extension ID provided, prompting user to select an extension.");
            const extensionQuickPickItems: vscode.QuickPickItem[] = vscode.extensions.all
                .filter((ext) => ext.id !== Constants.extensionId) // Exclude self
                .map((extension) => ({
                    label: this.getExtensionDisplayName(extension.id),
                    detail: extension.id,
                    description: extension.packageJSON.description,
                }));

            const selectedExtension = await vscode.window.showQuickPick(extensionQuickPickItems, {
                canPickMany: false,
                placeHolder: LocalizedConstants.ConnectionSharing.SelectAnExtensionToManage,
                matchOnDescription: true,
            });

            if (!selectedExtension?.detail) {
                this._logger.info("User cancelled the extension selection.");
                return undefined; // User cancelled selection
            }
            this._logger.info(`User selected extension: ${selectedExtension.detail}`);
            extensionId = selectedExtension.detail;
        }

        const currentPermission = await this.getExtensionPermission(extensionId);
        const extensionDisplayName = this.getExtensionDisplayName(extensionId);

        this._logger.info(
            `Current permission for extension "${extensionDisplayName}" (${extensionId}): ${currentPermission}`,
        );

        const newPermission = await vscode.window.showQuickPick(
            [
                {
                    label:
                        currentPermission === "approved"
                            ? LocalizedConstants.ConnectionSharing.GrantAccessCurrent
                            : LocalizedConstants.ConnectionSharing.GrantAccess,
                    description:
                        LocalizedConstants.ConnectionSharing
                            .AllowThisExtensionToAccessYourConnections,
                    detail: "approved",
                },
                {
                    label:
                        currentPermission === "denied"
                            ? LocalizedConstants.ConnectionSharing.DenyAccessCurrent
                            : LocalizedConstants.ConnectionSharing.DenyAccess,
                    description:
                        LocalizedConstants.ConnectionSharing
                            .BlockThisExtensionFromAccessingYourConnections,
                    detail: "denied",
                },
            ],
            {
                placeHolder:
                    LocalizedConstants.ConnectionSharing.SelectNewPermission(extensionDisplayName),
            },
        );

        this._logger.info(`User selected new permission: ${newPermission?.detail}`);

        if (!newPermission) {
            return; // User canceled the selection
        }

        const newApproval: ExtensionPermission = newPermission.detail as ExtensionPermission;
        await this.updateExtensionPermission(extensionId, newApproval);
        this._logger.info(
            `Updated permission for extension "${extensionDisplayName}" (${extensionId}) to: ${newApproval}`,
        );
        return newApproval;
    }

    public async getConnectionString(
        extensionId: string,
        connectionId: string,
    ): Promise<string | undefined> {
        await this.validateExtensionPermission(extensionId);

        const connections =
            await this._connectionManager.connectionStore.connectionConfig.getConnections();
        const targetConnection = connections.find((conn) => conn.id === connectionId);

        if (!targetConnection) {
            this._logger.error(
                `Connection with ID "${connectionId}" not found for extension "${extensionId}".`,
            );
            throw new ConnectionSharingError(
                ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                LocalizedConstants.ConnectionSharing.connectionNotFoundError(connectionId),
                extensionId,
                connectionId,
            );
        }

        // Use ConnectionManager's getConnectionString method
        const connectionDetails = this._connectionManager.createConnectionDetails(targetConnection);
        const connectionString = await this._connectionManager.getConnectionString(
            connectionDetails,
            true, // includePassword
            false, // do not include appName
        );

        this._logger.info(
            `Retrieved connection string for connection ID "${connectionId}" for extension "${extensionId}".`,
        );
        return connectionString;
    }
}
