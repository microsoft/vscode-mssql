/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { existsSync } from "fs";
import ConnectionManager from "./connectionManager";
import { DacFxService } from "../services/dacFxService";
import { IConnectionProfile } from "../models/interfaces";
import * as vscodeMssql from "vscode-mssql";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import * as LocConstants from "../constants/locConstants";
import {
    BrowseInputFileWebviewRequest,
    BrowseOutputFileWebviewRequest,
    CancelDataTierApplicationWebviewNotification,
    ConfirmDeployToExistingWebviewRequest,
    ConnectionProfile,
    ConnectToServerWebviewRequest,
    DataTierApplicationResult,
    DataTierApplicationWebviewState,
    DataTierOperationType,
    DeployDacpacParams,
    DeployDacpacWebviewRequest,
    ExportBacpacParams,
    ExportBacpacWebviewRequest,
    ExtractDacpacParams,
    ExtractDacpacWebviewRequest,
    ImportBacpacParams,
    ImportBacpacWebviewRequest,
    ListConnectionsWebviewRequest,
    ListDatabasesWebviewRequest,
    ValidateDatabaseNameWebviewRequest,
    ValidateFilePathWebviewRequest,
} from "../sharedInterfaces/dataTierApplication";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { ListDatabasesRequest } from "../models/contracts/connection";

/**
 * Controller for the Data-tier Application webview
 * Manages DACPAC and BACPAC operations (Deploy, Extract, Import, Export)
 */
export class DataTierApplicationWebviewController extends ReactWebviewPanelController<
    DataTierApplicationWebviewState,
    void,
    DataTierApplicationResult
> {
    private _ownerUri: string;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private connectionManager: ConnectionManager,
        private dacFxService: DacFxService,
        initialState: DataTierApplicationWebviewState,
        ownerUri: string,
    ) {
        super(context, vscodeWrapper, "dataTierApplication", "dataTierApplication", initialState, {
            title: LocConstants.DataTierApplication.Title,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
            },
            preserveFocus: true,
        });

        this._ownerUri = ownerUri;
        this.registerRpcHandlers();
    }

    /**
     * Registers all RPC handlers for webview communication
     */
    private registerRpcHandlers(): void {
        // Deploy DACPAC request handler
        this.onRequest(DeployDacpacWebviewRequest.type, async (params: DeployDacpacParams) => {
            return await this.handleDeployDacpac(params);
        });

        // Extract DACPAC request handler
        this.onRequest(ExtractDacpacWebviewRequest.type, async (params: ExtractDacpacParams) => {
            return await this.handleExtractDacpac(params);
        });

        // Import BACPAC request handler
        this.onRequest(ImportBacpacWebviewRequest.type, async (params: ImportBacpacParams) => {
            return await this.handleImportBacpac(params);
        });

        // Export BACPAC request handler
        this.onRequest(ExportBacpacWebviewRequest.type, async (params: ExportBacpacParams) => {
            return await this.handleExportBacpac(params);
        });

        // Validate file path request handler
        this.onRequest(
            ValidateFilePathWebviewRequest.type,
            async (params: { filePath: string; shouldExist: boolean }) => {
                return this.validateFilePath(params.filePath, params.shouldExist);
            },
        );

        // List databases request handler
        this.onRequest(ListDatabasesWebviewRequest.type, async (params: { ownerUri: string }) => {
            if (!params.ownerUri || params.ownerUri.trim() === "") {
                this.logger.error("Cannot list databases: ownerUri is empty");
                return { databases: [] };
            }
            return await this.listDatabases(params.ownerUri);
        });

        // Validate database name request handler
        this.onRequest(
            ValidateDatabaseNameWebviewRequest.type,
            async (params: {
                databaseName: string;
                ownerUri: string;
                shouldNotExist: boolean;
                operationType?: DataTierOperationType;
            }) => {
                if (!params.ownerUri || params.ownerUri.trim() === "") {
                    this.logger.error("Cannot validate database name: ownerUri is empty");
                    return {
                        isValid: false,
                        errorMessage:
                            "No active connection. Please ensure you are connected to a SQL Server instance.",
                    };
                }
                return await this.validateDatabaseName(
                    params.databaseName,
                    params.ownerUri,
                    params.shouldNotExist,
                    params.operationType,
                );
            },
        );

        // List connections request handler
        this.onRequest(ListConnectionsWebviewRequest.type, async () => {
            return await this.listConnections();
        });

        // Connect to server request handler
        this.onRequest(
            ConnectToServerWebviewRequest.type,
            async (params: { profileId: string }) => {
                return await this.connectToServer(params.profileId);
            },
        );

        // Browse for input file (DACPAC or BACPAC) request handler
        this.onRequest(
            BrowseInputFileWebviewRequest.type,
            async (params: { fileExtension: string }) => {
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: LocConstants.DataTierApplication.Select,
                    filters: {
                        [`${params.fileExtension.toUpperCase()} Files`]: [params.fileExtension],
                    },
                });

                if (!fileUri || fileUri.length === 0) {
                    return { filePath: undefined };
                }

                return { filePath: fileUri[0].fsPath };
            },
        );

        // Browse for output file (DACPAC or BACPAC) request handler
        this.onRequest(
            BrowseOutputFileWebviewRequest.type,
            async (params: { fileExtension: string; defaultFileName?: string }) => {
                const defaultFileName =
                    params.defaultFileName || `database.${params.fileExtension}`;
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                const defaultUri = workspaceFolder
                    ? vscode.Uri.joinPath(workspaceFolder, defaultFileName)
                    : vscode.Uri.file(path.join(require("os").homedir(), defaultFileName));

                const fileUri = await vscode.window.showSaveDialog({
                    defaultUri: defaultUri,
                    saveLabel: LocConstants.DataTierApplication.Save,
                    filters: {
                        [`${params.fileExtension.toUpperCase()} Files`]: [params.fileExtension],
                    },
                });

                if (!fileUri) {
                    return { filePath: undefined };
                }

                return { filePath: fileUri.fsPath };
            },
        );

        // Confirm deploy to existing database request handler
        this.onRequest(ConfirmDeployToExistingWebviewRequest.type, async () => {
            const result = await this.vscodeWrapper.showWarningMessageAdvanced(
                LocConstants.DataTierApplication.DeployToExistingMessage,
                { modal: true },
                [LocConstants.DataTierApplication.DeployToExistingConfirm],
            );

            return {
                confirmed: result === LocConstants.DataTierApplication.DeployToExistingConfirm,
            };
        });

        // Cancel operation notification handler
        this.onNotification(CancelDataTierApplicationWebviewNotification.type, () => {
            this.dialogResult.resolve(undefined);
            this.panel.dispose();
        });
    }

    /**
     * Handles deploying a DACPAC file to a database
     */
    private async handleDeployDacpac(
        params: DeployDacpacParams,
    ): Promise<DataTierApplicationResult> {
        try {
            const result = await this.dacFxService.deployDacpac(
                params.packageFilePath,
                params.databaseName,
                !params.isNewDatabase, // upgradeExisting
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: DataTierApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                this.dialogResult.resolve(appResult);
                // Don't dispose immediately to allow user to see success message
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                errorMessage: errorMessage,
            };
        }
    }

    /**
     * Handles extracting a DACPAC file from a database
     */
    private async handleExtractDacpac(
        params: ExtractDacpacParams,
    ): Promise<DataTierApplicationResult> {
        try {
            const result = await this.dacFxService.extractDacpac(
                params.databaseName,
                params.packageFilePath,
                params.applicationName,
                params.applicationVersion,
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: DataTierApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                errorMessage: errorMessage,
            };
        }
    }

    /**
     * Handles importing a BACPAC file to create a new database
     */
    private async handleImportBacpac(
        params: ImportBacpacParams,
    ): Promise<DataTierApplicationResult> {
        try {
            const result = await this.dacFxService.importBacpac(
                params.packageFilePath,
                params.databaseName,
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: DataTierApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                errorMessage: errorMessage,
            };
        }
    }

    /**
     * Handles exporting a database to a BACPAC file
     */
    private async handleExportBacpac(
        params: ExportBacpacParams,
    ): Promise<DataTierApplicationResult> {
        try {
            const result = await this.dacFxService.exportBacpac(
                params.databaseName,
                params.packageFilePath,
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: DataTierApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                errorMessage: errorMessage,
            };
        }
    }

    /**
     * Validates a file path
     */
    private validateFilePath(
        filePath: string,
        shouldExist: boolean,
    ): { isValid: boolean; errorMessage?: string } {
        if (!filePath || filePath.trim() === "") {
            return {
                isValid: false,
                errorMessage: LocConstants.DataTierApplication.FilePathRequired,
            };
        }

        const fileFound = existsSync(filePath);

        if (shouldExist && !fileFound) {
            return {
                isValid: false,
                errorMessage: LocConstants.DataTierApplication.FileNotFound,
            };
        }

        const extension = path.extname(filePath).toLowerCase();
        if (extension !== ".dacpac" && extension !== ".bacpac") {
            return {
                isValid: false,
                errorMessage: LocConstants.DataTierApplication.InvalidFileExtension,
            };
        }

        if (!shouldExist) {
            // Check if the directory exists and is writable
            const directory = path.dirname(filePath);
            if (!fs.existsSync(directory)) {
                return {
                    isValid: false,
                    errorMessage: LocConstants.DataTierApplication.DirectoryNotFound,
                };
            }

            // Check if file already exists (for output files)
            if (fileFound) {
                // This is just a warning - the operation can continue with user confirmation
                return {
                    isValid: true,
                    errorMessage: LocConstants.DataTierApplication.FileAlreadyExists,
                };
            }
        }

        return { isValid: true };
    }

    /**
     * Lists databases on the connected server
     */
    private async listDatabases(ownerUri: string): Promise<{ databases: string[] }> {
        try {
            const result = await this.connectionManager.client.sendRequest(
                ListDatabasesRequest.type,
                { ownerUri: ownerUri },
            );

            return { databases: result.databaseNames || [] };
        } catch (error) {
            this.logger.error(`Failed to list databases: ${error}`);
            return { databases: [] };
        }
    }

    /**
     * Lists all available connections (recent and active)
     */
    private async listConnections(): Promise<{ connections: ConnectionProfile[] }> {
        try {
            const connections: ConnectionProfile[] = [];

            // Get recently used connections from connection store
            const recentConnections =
                this.connectionManager.connectionStore.getRecentlyUsedConnections();

            // Get active connections
            const activeConnections = this.connectionManager.activeConnections;

            // Build the connection profile list from recent connections
            for (const conn of recentConnections) {
                const profile = conn as IConnectionProfile;
                const displayName = this.buildConnectionDisplayName(profile);
                const profileId = profile.id || `${profile.server}_${profile.database || ""}`;

                // Check if this connection is active
                const isConnected = Object.values(activeConnections).some(
                    (activeConn) =>
                        activeConn.credentials.server === profile.server &&
                        (activeConn.credentials.database === profile.database ||
                            (!activeConn.credentials.database && !profile.database)),
                );

                connections.push({
                    displayName,
                    server: profile.server,
                    database: profile.database,
                    authenticationType: this.getAuthenticationTypeString(
                        profile.authenticationType,
                    ),
                    userName: profile.user,
                    isConnected,
                    profileId,
                });
            }

            const existingProfileIds = new Set(connections.map((conn) => conn.profileId));

            // Include active connections that may not appear in the recent list
            for (const activeConnection of Object.values(activeConnections)) {
                const profile = activeConnection.credentials as IConnectionProfile;
                const profileId = profile.id || `${profile.server}_${profile.database || ""}`;

                if (existingProfileIds.has(profileId)) {
                    continue;
                }

                const displayName = this.buildConnectionDisplayName(profile);

                connections.push({
                    displayName,
                    server: profile.server,
                    database: profile.database,
                    authenticationType: this.getAuthenticationTypeString(
                        profile.authenticationType,
                    ),
                    userName: profile.user,
                    isConnected: true,
                    profileId,
                });
                existingProfileIds.add(profileId);
            }

            return { connections };
        } catch (error) {
            this.logger.error(`Failed to list connections: ${error}`);
            return { connections: [] };
        }
    }

    /**
     * Connects to a server using the specified profile ID
     */
    private async connectToServer(
        profileId: string,
    ): Promise<{ ownerUri: string; isConnected: boolean; errorMessage?: string }> {
        try {
            // Find the profile in recent connections
            const recentConnections =
                this.connectionManager.connectionStore.getRecentlyUsedConnections();
            const profile = recentConnections.find((conn: vscodeMssql.IConnectionInfo) => {
                const connProfile = conn as IConnectionProfile;
                const connId = connProfile.id || `${conn.server}_${conn.database || ""}`;
                return connId === profileId;
            }) as IConnectionProfile | undefined;

            if (!profile) {
                return {
                    ownerUri: "",
                    isConnected: false,
                    errorMessage: "Connection profile not found",
                };
            }

            // Check if already connected
            let ownerUri = this.connectionManager.getUriForConnection(profile);
            const existingConnection =
                ownerUri && this.connectionManager.activeConnections[ownerUri];

            if (existingConnection) {
                return {
                    ownerUri,
                    isConnected: true,
                };
            }

            // Generate a new ownerUri if we don't have one (for new connections)
            // Pass empty string to let connect() generate the URI
            const result = await this.connectionManager.connect("", profile);

            if (result) {
                // Get the actual ownerUri that was used for the connection
                ownerUri = this.connectionManager.getUriForConnection(profile);
                return {
                    ownerUri,
                    isConnected: true,
                };
            } else {
                return {
                    ownerUri: "",
                    isConnected: false,
                    errorMessage: "Failed to connect to server",
                };
            }
        } catch (error) {
            this.logger.error(`Failed to connect to server: ${error}`);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                ownerUri: "",
                isConnected: false,
                errorMessage: `Connection failed: ${errorMessage}`,
            };
        }
    }

    /**
     * Builds a display name for a connection profile
     */
    private buildConnectionDisplayName(profile: IConnectionProfile): string {
        let displayName = profile.profileName || profile.server;
        if (profile.database) {
            displayName += ` (${profile.database})`;
        }
        if (profile.user) {
            displayName += ` - ${profile.user}`;
        }
        return displayName;
    }

    /**
     * Gets a string representation of the authentication type
     */
    private getAuthenticationTypeString(authType: number | string | undefined): string {
        switch (authType) {
            case 1:
                return "Integrated";
            case 2:
                return "SQL Login";
            case 3:
                return "Azure MFA";
            default:
                return "Unknown";
        }
    }

    /**
     * Validates a database name
     */
    private async validateDatabaseName(
        databaseName: string,
        ownerUri: string,
        shouldNotExist: boolean,
        operationType?: DataTierOperationType,
    ): Promise<{ isValid: boolean; errorMessage?: string }> {
        if (!databaseName || databaseName.trim() === "") {
            return {
                isValid: false,
                errorMessage: LocConstants.DataTierApplication.DatabaseNameRequired,
            };
        }

        // Check for invalid characters
        const invalidChars = /[<>*?"/\\|]/;
        if (invalidChars.test(databaseName)) {
            return {
                isValid: false,
                errorMessage: LocConstants.DataTierApplication.InvalidDatabaseName,
            };
        }

        // Check length (SQL Server max identifier length is 128)
        if (databaseName.length > 128) {
            return {
                isValid: false,
                errorMessage: LocConstants.DataTierApplication.DatabaseNameTooLong,
            };
        }

        // Check if database exists
        try {
            const result = await this.connectionManager.client.sendRequest(
                ListDatabasesRequest.type,
                { ownerUri: ownerUri },
            );

            const databases = result.databaseNames || [];
            const exists = databases.some((db) => db.toLowerCase() === databaseName.toLowerCase());

            // For Deploy operations, always warn if database exists to trigger confirmation
            // This ensures confirmation dialog is shown in both cases:
            // 1. User selected "New Database" but database already exists (shouldNotExist=true)
            // 2. User selected "Existing Database" and selected existing database (shouldNotExist=false)
            if (operationType === DataTierOperationType.Deploy && exists) {
                return {
                    isValid: true, // Allow the operation but with a warning
                    errorMessage: LocConstants.DataTierApplication.DatabaseAlreadyExists,
                };
            }

            // For new database operations (Import), database should not exist
            if (shouldNotExist && exists) {
                return {
                    isValid: true, // Allow the operation but with a warning
                    errorMessage: LocConstants.DataTierApplication.DatabaseAlreadyExists,
                };
            }

            // For Extract/Export operations, database must exist
            if (!shouldNotExist && !exists) {
                return {
                    isValid: false,
                    errorMessage: LocConstants.DataTierApplication.DatabaseNotFound,
                };
            }

            return { isValid: true };
        } catch (error) {
            const errorMessage =
                error instanceof Error
                    ? `Failed to validate database name: ${error.message}`
                    : LocConstants.DataTierApplication.ValidationFailed;
            this.logger.error(errorMessage);
            return {
                isValid: false,
                errorMessage: errorMessage,
            };
        }
    }

    /**
     * Gets the owner URI for the current connection
     */
    public get ownerUri(): string {
        return this._ownerUri;
    }
}
