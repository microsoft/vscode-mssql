/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { existsSync } from "fs";
import { homedir } from "os";
import ConnectionManager from "./connectionManager";
import { DacFxService } from "../services/dacFxService";
import { IConnectionProfile } from "../models/interfaces";
import * as vscodeMssql from "vscode-mssql";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import * as LocConstants from "../constants/locConstants";
import { startActivity } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../sharedInterfaces/telemetry";
import * as dacFxApplication from "../sharedInterfaces/dacFxApplication";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { ListDatabasesRequest } from "../models/contracts/connection";
import { getConnectionDisplayName } from "../models/connectionInfo";

// File extension constants
export const DACPAC_EXTENSION = ".dacpac";
export const BACPAC_EXTENSION = ".bacpac";

/**
 * Controller for the DacFxApplication webview.
 * Manages DACPAC and BACPAC operations (Deploy, Extract, Import, Export) using the Data-tier Application Framework (DacFx).
 */
export class DacFxApplicationWebviewController extends ReactWebviewPanelController<
    dacFxApplication.DacFxApplicationWebviewState,
    void,
    dacFxApplication.DacFxApplicationResult
> {
    private _ownerUri: string;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private connectionManager: ConnectionManager,
        private dacFxService: DacFxService,
        initialState: dacFxApplication.DacFxApplicationWebviewState,
        ownerUri: string,
    ) {
        super(context, vscodeWrapper, "dacFxApplication", "dacFxApplication", initialState, {
            title: LocConstants.DacFxApplication.Title,
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
        this.onRequest(
            dacFxApplication.DeployDacpacWebviewRequest.type,
            async (params: dacFxApplication.DeployDacpacParams) => {
                return await this.handleDeployDacpac(params);
            },
        );

        // Extract DACPAC request handler
        this.onRequest(
            dacFxApplication.ExtractDacpacWebviewRequest.type,
            async (params: dacFxApplication.ExtractDacpacParams) => {
                return await this.handleExtractDacpac(params);
            },
        );

        // Import BACPAC request handler
        this.onRequest(
            dacFxApplication.ImportBacpacWebviewRequest.type,
            async (params: dacFxApplication.ImportBacpacParams) => {
                return await this.handleImportBacpac(params);
            },
        );

        // Export BACPAC request handler
        this.onRequest(
            dacFxApplication.ExportBacpacWebviewRequest.type,
            async (params: dacFxApplication.ExportBacpacParams) => {
                return await this.handleExportBacpac(params);
            },
        );

        // Validate file path request handler
        this.onRequest(
            dacFxApplication.ValidateFilePathWebviewRequest.type,
            async (params: { filePath: string; shouldExist: boolean }) => {
                return this.validateFilePath(params.filePath, params.shouldExist);
            },
        );

        // List databases request handler
        this.onRequest(
            dacFxApplication.ListDatabasesWebviewRequest.type,
            async (params: { ownerUri: string }) => {
                if (!params.ownerUri || params.ownerUri.trim() === "") {
                    this.logger.error("Cannot list databases: ownerUri is empty");
                    return { databases: [] };
                }
                return await this.listDatabases(params.ownerUri);
            },
        );

        // Validate database name request handler
        this.onRequest(
            dacFxApplication.ValidateDatabaseNameWebviewRequest.type,
            async (params: {
                databaseName: string;
                ownerUri: string;
                shouldNotExist: boolean;
                operationType?: dacFxApplication.DacFxOperationType;
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
        this.onRequest(dacFxApplication.ListConnectionsWebviewRequest.type, async () => {
            return await this.listConnections();
        });

        // Initialize connection request handler
        this.onRequest(
            dacFxApplication.InitializeConnectionWebviewRequest.type,
            async (params: {
                initialServerName?: string;
                initialDatabaseName?: string;
                initialOwnerUri?: string;
                initialProfileId?: string;
            }) => {
                return await this.initializeConnection(params);
            },
        );

        // Connect to server request handler
        this.onRequest(
            dacFxApplication.ConnectToServerWebviewRequest.type,
            async (params: { profileId: string }) => {
                return await this.connectToServer(params.profileId);
            },
        );

        // Browse for input file (DACPAC or BACPAC) request handler
        this.onRequest(
            dacFxApplication.BrowseInputFileWebviewRequest.type,
            async (params: { fileExtension: string }) => {
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: LocConstants.DacFxApplication.Select,
                    filters: {
                        [`${params.fileExtension.toUpperCase()} ${LocConstants.DacFxApplication.Files}`]:
                            [params.fileExtension],
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
            dacFxApplication.BrowseOutputFileWebviewRequest.type,
            async (params: { fileExtension: string; defaultFileName?: string }) => {
                const defaultFileName =
                    params.defaultFileName || `database.${params.fileExtension}`;
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                const defaultUri = workspaceFolder
                    ? vscode.Uri.joinPath(workspaceFolder, defaultFileName)
                    : vscode.Uri.file(path.join(homedir(), defaultFileName));

                const fileUri = await vscode.window.showSaveDialog({
                    defaultUri: defaultUri,
                    saveLabel: LocConstants.DacFxApplication.Save,
                    filters: {
                        [`${params.fileExtension.toUpperCase()} ${LocConstants.DacFxApplication.Files}`]:
                            [params.fileExtension],
                    },
                });

                if (!fileUri) {
                    return { filePath: undefined };
                }

                return { filePath: fileUri.fsPath };
            },
        );

        // Get default output path without showing dialog
        this.onRequest(
            dacFxApplication.GetSuggestedOutputPathWebviewRequest.type,
            async (params: {
                databaseName: string;
                operationType: dacFxApplication.DacFxOperationType;
            }) => {
                const fileExtension =
                    params.operationType === dacFxApplication.DacFxOperationType.Extract
                        ? "dacpac"
                        : "bacpac";

                const timestamp = this.formatTimestampForFilename();
                const suggestedFileName = `${params.databaseName}-${timestamp}.${fileExtension}`;

                // Get workspace folder or home directory
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                const defaultUri = workspaceFolder
                    ? vscode.Uri.joinPath(workspaceFolder, suggestedFileName)
                    : vscode.Uri.file(path.join(homedir(), suggestedFileName));

                return { fullPath: defaultUri.fsPath };
            },
        );

        // Get suggested database name from file path
        this.onRequest(
            dacFxApplication.GetSuggestedDatabaseNameWebviewRequest.type,
            async (params: { filePath: string }) => {
                // Remove file extension (.dacpac or .bacpac) to get the database name
                // Keep the full filename including any timestamps that may be present
                const databaseName = path.basename(params.filePath, path.extname(params.filePath));

                return { databaseName };
            },
        );

        // Confirm deploy to existing database request handler
        this.onRequest(dacFxApplication.ConfirmDeployToExistingWebviewRequest.type, async () => {
            const result = await this.vscodeWrapper.showWarningMessageAdvanced(
                LocConstants.DacFxApplication.DeployToExistingMessage,
                { modal: true },
                [LocConstants.DacFxApplication.DeployToExistingConfirm],
            );

            return {
                confirmed: result === LocConstants.DacFxApplication.DeployToExistingConfirm,
            };
        });

        // Cancel operation notification handler
        this.onNotification(dacFxApplication.CancelDacFxApplicationWebviewNotification.type, () => {
            this.dialogResult.resolve(undefined);
            this.panel.dispose();
        });
    }

    /**
     * Handles deploying a DACPAC file to a database
     */
    private async handleDeployDacpac(
        params: dacFxApplication.DeployDacpacParams,
    ): Promise<dacFxApplication.DacFxApplicationResult> {
        const activity = startActivity(
            TelemetryViews.DacFxApplication,
            TelemetryActions.DacFxDeployDacpac,
            undefined,
            {
                isNewDatabase: params.isNewDatabase.toString(),
            },
        );

        try {
            const result = await this.dacFxService.deployDacpac(
                params.packageFilePath,
                params.databaseName,
                !params.isNewDatabase, // upgradeExisting
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: dacFxApplication.DacFxApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                activity.end(ActivityStatus.Succeeded);
                this.dialogResult.resolve(appResult);
            } else {
                activity.endFailed(
                    new Error(result.errorMessage || "Deploy operation failed"),
                    false,
                );
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            activity.endFailed(error instanceof Error ? error : new Error(errorMessage), false);
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
        params: dacFxApplication.ExtractDacpacParams,
    ): Promise<dacFxApplication.DacFxApplicationResult> {
        const activity = startActivity(
            TelemetryViews.DacFxApplication,
            TelemetryActions.DacFxExtractDacpac,
        );

        try {
            const result = await this.dacFxService.extractDacpac(
                params.databaseName,
                params.packageFilePath,
                params.applicationName,
                params.applicationVersion,
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: dacFxApplication.DacFxApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                activity.end(ActivityStatus.Succeeded);
                this.dialogResult.resolve(appResult);
            } else {
                activity.endFailed(
                    new Error(result.errorMessage || "Extract operation failed"),
                    false,
                );
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            activity.endFailed(error instanceof Error ? error : new Error(errorMessage), false);
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
        params: dacFxApplication.ImportBacpacParams,
    ): Promise<dacFxApplication.DacFxApplicationResult> {
        const activity = startActivity(
            TelemetryViews.DacFxApplication,
            TelemetryActions.DacFxImportBacpac,
        );

        try {
            const result = await this.dacFxService.importBacpac(
                params.packageFilePath,
                params.databaseName,
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: dacFxApplication.DacFxApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                activity.end(ActivityStatus.Succeeded);
                this.dialogResult.resolve(appResult);
            } else {
                activity.endFailed(
                    new Error(result.errorMessage || "Import operation failed"),
                    false,
                );
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            activity.endFailed(error instanceof Error ? error : new Error(errorMessage), false);
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
        params: dacFxApplication.ExportBacpacParams,
    ): Promise<dacFxApplication.DacFxApplicationResult> {
        const activity = startActivity(
            TelemetryViews.DacFxApplication,
            TelemetryActions.DacFxExportBacpac,
        );

        try {
            const result = await this.dacFxService.exportBacpac(
                params.databaseName,
                params.packageFilePath,
                params.ownerUri,
                TaskExecutionMode.execute,
            );

            const appResult: dacFxApplication.DacFxApplicationResult = {
                success: result.success,
                errorMessage: result.errorMessage,
                operationId: result.operationId,
            };

            if (result.success) {
                activity.end(ActivityStatus.Succeeded);
                this.dialogResult.resolve(appResult);
            } else {
                activity.endFailed(
                    new Error(result.errorMessage || "Export operation failed"),
                    false,
                );
                this.dialogResult.resolve(appResult);
            }

            return appResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            activity.endFailed(error instanceof Error ? error : new Error(errorMessage), false);
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
                errorMessage: LocConstants.DacFxApplication.FilePathRequired,
            };
        }

        const fileFound = existsSync(filePath);

        if (shouldExist && !fileFound) {
            return {
                isValid: false,
                errorMessage: LocConstants.DacFxApplication.FileNotFound,
            };
        }

        const extension = path.extname(filePath).toLowerCase();
        if (extension !== DACPAC_EXTENSION && extension !== BACPAC_EXTENSION) {
            return {
                isValid: false,
                errorMessage: LocConstants.DacFxApplication.InvalidFileExtension,
            };
        }

        if (!shouldExist) {
            // Check if the directory exists and is writable
            const directory = path.dirname(filePath);
            if (!fs.existsSync(directory)) {
                return {
                    isValid: false,
                    errorMessage: LocConstants.DacFxApplication.DirectoryNotFound,
                };
            }

            // Check if file already exists (for output files)
            if (fileFound) {
                // This is just a warning - the operation can continue with user confirmation
                return {
                    isValid: true,
                    errorMessage: LocConstants.DacFxApplication.FileAlreadyExists,
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
     * Lists all available connections from the connection store
     */
    private async listConnections(): Promise<{
        connections: dacFxApplication.ConnectionProfile[];
    }> {
        try {
            const connections: dacFxApplication.ConnectionProfile[] = [];

            // Get all saved connections from connection store (saved profiles only, not recent connections)
            const savedConnections =
                await this.connectionManager.connectionStore.readAllConnections();

            // Build the connection profile list from saved connections
            for (const conn of savedConnections) {
                const profile = conn as IConnectionProfile;
                const displayName = getConnectionDisplayName(profile);
                const profileId = profile.id || `${profile.server}_${profile.database || ""}`;

                connections.push({
                    displayName,
                    server: profile.server,
                    database: profile.database,
                    authenticationType: this.getAuthenticationTypeString(
                        profile.authenticationType,
                    ),
                    userName: profile.user,
                    profileId,
                });
            }

            return { connections };
        } catch (error) {
            this.logger.error(`Failed to list connections: ${error}`);
            return { connections: [] };
        }
    }

    /**
     * Initializes connection based on initial state from Object Explorer or previous session
     * Handles auto-matching and auto-connecting to provide seamless user experience
     */
    private async initializeConnection(params: {
        initialServerName?: string;
        initialDatabaseName?: string;
        initialOwnerUri?: string;
        initialProfileId?: string;
    }): Promise<{
        connections: dacFxApplication.ConnectionProfile[];
        selectedConnection?: dacFxApplication.ConnectionProfile;
        ownerUri?: string;
        autoConnected: boolean;
        errorMessage?: string;
    }> {
        try {
            // Get all connections
            const { connections } = await this.listConnections();

            // Find matching connection based on initial parameters
            const matchingConnection = await this.findMatchingConnection(params, connections);

            if (!matchingConnection) {
                // No match found - return all connections, let user choose
                this.logger.verbose("No matching connection found in initial state");
                return {
                    connections,
                    autoConnected: false,
                };
            }

            // Handle existing connection from Object Explorer
            if (params.initialOwnerUri) {
                return this.useExistingConnection(
                    connections,
                    matchingConnection,
                    params.initialOwnerUri,
                );
            }

            // Attempt to connect to the matched profile
            return await this.connectToMatchedProfile(connections, matchingConnection);
        } catch (error) {
            this.logger.error(`Failed to initialize connection: ${error}`);
            // Fallback: return empty state
            return {
                connections: [],
                autoConnected: false,
                errorMessage: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Finds a matching connection profile based on profile ID or server/database name
     */
    private async findMatchingConnection(
        params: {
            initialProfileId?: string;
            initialServerName?: string;
            initialDatabaseName?: string;
        },
        connections: dacFxApplication.ConnectionProfile[],
    ): Promise<dacFxApplication.ConnectionProfile | undefined> {
        // Priority 1: Match by profile ID if provided
        if (params.initialProfileId) {
            const matchingConnection = connections.find(
                (conn) => conn.profileId === params.initialProfileId,
            );
            if (matchingConnection) {
                this.logger.verbose(`Found connection by profile ID: ${params.initialProfileId}`);
                return matchingConnection;
            }
        }

        // Priority 2: Use findMatchingProfile if we have server name
        if (params.initialServerName) {
            return await this.findConnectionByServerName(
                params.initialServerName,
                params.initialDatabaseName,
                connections,
            );
        }

        return undefined;
    }

    /**
     * Finds a connection by server and database name using the connection store's matching logic
     */
    private async findConnectionByServerName(
        serverName: string,
        databaseName: string | undefined,
        connections: dacFxApplication.ConnectionProfile[],
    ): Promise<dacFxApplication.ConnectionProfile | undefined> {
        // Create a temporary profile to search with
        const searchProfile = {
            server: serverName,
            database: databaseName || "",
        } as IConnectionProfile;

        const matchResult =
            await this.connectionManager.connectionStore.findMatchingProfile(searchProfile);

        if (matchResult?.profile) {
            // Find the matching connection in our list
            const profileId =
                matchResult.profile.id ||
                `${matchResult.profile.server}_${matchResult.profile.database || ""}`;
            const matchingConnection = connections.find((conn) => conn.profileId === profileId);

            if (matchingConnection) {
                this.logger.verbose(
                    `Found connection by server/database using findMatchingProfile: ${serverName}/${databaseName || "default"}`,
                );
                return matchingConnection;
            }
        }

        return undefined;
    }

    /**
     * Returns result for an existing connection (from Object Explorer)
     */
    private useExistingConnection(
        connections: dacFxApplication.ConnectionProfile[],
        matchingConnection: dacFxApplication.ConnectionProfile,
        ownerUri: string,
    ): {
        connections: dacFxApplication.ConnectionProfile[];
        selectedConnection: dacFxApplication.ConnectionProfile;
        ownerUri: string;
        autoConnected: boolean;
    } {
        this.logger.verbose(`Using existing connection from Object Explorer: ${ownerUri}`);
        return {
            connections,
            selectedConnection: matchingConnection,
            ownerUri,
            autoConnected: false, // Was already connected
        };
    }

    /**
     * Attempts to connect to a matched profile and returns the result
     */
    private async connectToMatchedProfile(
        connections: dacFxApplication.ConnectionProfile[],
        matchingConnection: dacFxApplication.ConnectionProfile,
    ): Promise<{
        connections: dacFxApplication.ConnectionProfile[];
        selectedConnection: dacFxApplication.ConnectionProfile;
        ownerUri?: string;
        autoConnected: boolean;
        errorMessage?: string;
    }> {
        this.logger.verbose(`Connecting to profile: ${matchingConnection.profileId}`);
        try {
            const connectResult = await this.connectToServer(matchingConnection.profileId);

            if (connectResult.isConnected && connectResult.ownerUri) {
                this.logger.info(`Connected to: ${matchingConnection.server}`);
                return {
                    connections,
                    selectedConnection: matchingConnection,
                    ownerUri: connectResult.ownerUri,
                    autoConnected: true,
                };
            } else {
                // Connection failed
                this.logger.error(
                    `Connection failed: ${connectResult.errorMessage || "Unknown error"}`,
                );
                return {
                    connections,
                    selectedConnection: matchingConnection,
                    autoConnected: false,
                    errorMessage: connectResult.errorMessage,
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Connection exception: ${errorMsg}`);
            return {
                connections,
                selectedConnection: matchingConnection,
                autoConnected: false,
                errorMessage: errorMsg,
            };
        }
    }

    /**
     * Connects to a server using the specified profile ID
     */
    private async connectToServer(
        profileId: string,
    ): Promise<{ ownerUri: string; isConnected: boolean; errorMessage?: string }> {
        try {
            // Find the profile in saved connections
            const savedConnections =
                await this.connectionManager.connectionStore.readAllConnections();
            const profile = savedConnections.find((conn: vscodeMssql.IConnectionInfo) => {
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

            // Check if already connected and the connection is valid
            let ownerUri = this.connectionManager.getUriForConnection(profile);
            if (ownerUri && this.connectionManager.isConnected(ownerUri)) {
                // Connection is active and valid
                return {
                    ownerUri,
                    isConnected: true,
                };
            }

            // Not connected or connection is stale - establish new connection
            // Pass empty string to let connect() generate the URI
            // This will prompt for password if needed
            const result = await this.connectionManager.connect("", profile);

            if (result) {
                // Get the actual ownerUri that was used for the connection
                ownerUri = this.connectionManager.getUriForConnection(profile);
                return {
                    ownerUri,
                    isConnected: true,
                };
            } else {
                // Check if connection failed due to error or if it was never initiated
                // (e.g., user cancelled password prompt)
                ownerUri = this.connectionManager.getUriForConnection(profile);
                const connectionInfo = ownerUri
                    ? this.connectionManager.activeConnections[ownerUri]
                    : undefined;
                const errorMessage = connectionInfo?.errorMessage || "Failed to connect to server";
                return {
                    ownerUri: "",
                    isConnected: false,
                    errorMessage,
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
     * Formats the current date/time as yyyy-MM-dd-HH-mm for use in filenames
     */
    private formatTimestampForFilename(): string {
        const pad = (n: number) => String(n).padStart(2, "0");
        const now = new Date();
        const year = now.getFullYear();
        const month = pad(now.getMonth() + 1);
        const day = pad(now.getDate());
        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        return `${year}-${month}-${day}-${hours}-${minutes}`;
    }

    /**
     * Validates a database name
     */
    private async validateDatabaseName(
        databaseName: string,
        ownerUri: string,
        shouldNotExist: boolean,
        operationType?: dacFxApplication.DacFxOperationType,
    ): Promise<{ isValid: boolean; errorMessage?: string }> {
        if (!databaseName || databaseName.trim() === "") {
            return {
                isValid: false,
                errorMessage: LocConstants.DacFxApplication.DatabaseNameRequired,
            };
        }

        // Check for invalid characters
        const invalidChars = /[<>*?"/\\|]/;
        if (invalidChars.test(databaseName)) {
            return {
                isValid: false,
                errorMessage: LocConstants.DacFxApplication.InvalidDatabaseName,
            };
        }

        // Check length (SQL Server max identifier length is 128)
        if (databaseName.length > 128) {
            return {
                isValid: false,
                errorMessage: LocConstants.DacFxApplication.DatabaseNameTooLong,
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
            if (operationType === dacFxApplication.DacFxOperationType.Deploy && exists) {
                return {
                    isValid: true, // Allow the operation but with a warning
                    errorMessage: LocConstants.DacFxApplication.DatabaseAlreadyExists,
                };
            }

            // For new database operations (Import), database should not exist
            if (shouldNotExist && exists) {
                return {
                    isValid: true, // Allow the operation but with a warning
                    errorMessage: LocConstants.DacFxApplication.DatabaseAlreadyExists,
                };
            }

            // For Extract/Export operations, database must exist
            if (!shouldNotExist && !exists) {
                return {
                    isValid: false,
                    errorMessage: LocConstants.DacFxApplication.DatabaseNotFound,
                };
            }

            return { isValid: true };
        } catch (error) {
            const errorMessage =
                error instanceof Error
                    ? `Failed to validate database name: ${error.message}`
                    : LocConstants.DacFxApplication.ValidationFailed;
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
