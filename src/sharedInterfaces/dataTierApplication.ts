/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";

/**
 * The type of Data-tier Application operation to perform
 */
export enum DataTierOperationType {
    Deploy = "deploy",
    Extract = "extract",
    Import = "import",
    Export = "export",
}

/**
 * Simplified connection profile for display in UI
 */
export interface ConnectionProfile {
    /**
     * Display name for the connection
     */
    displayName: string;
    /**
     * Server name
     */
    server: string;
    /**
     * Database name (if specified)
     */
    database?: string;
    /**
     * Authentication type
     */
    authenticationType: string;
    /**
     * User name (for SQL Auth)
     */
    userName?: string;
    /**
     * Whether this connection is currently active
     */
    isConnected: boolean;
    /**
     * The profile ID used to identify this connection
     */
    profileId: string;
}

/**
 * The state of the Data-tier Application webview
 */
export interface DataTierApplicationWebviewState {
    /**
     * The currently selected operation type
     */
    operationType: DataTierOperationType;
    /**
     * The selected DACPAC/BACPAC file path
     */
    filePath?: string;
    /**
     * The connection owner URI
     */
    ownerUri?: string;
    /**
     * The target/source server name
     */
    serverName?: string;
    /**
     * The target/source database name
     */
    databaseName?: string;
    /**
     * The currently selected connection profile ID
     */
    selectedProfileId?: string;
    /**
     * List of available connection profiles
     */
    availableConnections?: ConnectionProfile[];
    /**
     * Whether to create a new database or upgrade existing (for Deploy)
     */
    isNewDatabase?: boolean;
    /**
     * List of available databases on the server
     */
    availableDatabases?: string[];
    /**
     * Application name for Extract operation
     */
    applicationName?: string;
    /**
     * Application version for Extract operation
     */
    applicationVersion?: string;
    /**
     * Whether an operation is currently in progress
     */
    isOperationInProgress?: boolean;
    /**
     * The current operation progress message
     */
    progressMessage?: string;
    /**
     * Validation errors for the current form state
     */
    validationErrors?: Record<string, string>;
}

/**
 * Parameters for deploying a DACPAC
 */
export interface DeployDacpacParams {
    packageFilePath: string;
    databaseName: string;
    isNewDatabase: boolean;
    ownerUri: string;
}

/**
 * Parameters for extracting a DACPAC
 */
export interface ExtractDacpacParams {
    databaseName: string;
    packageFilePath: string;
    applicationName?: string;
    applicationVersion?: string;
    ownerUri: string;
}

/**
 * Parameters for importing a BACPAC
 */
export interface ImportBacpacParams {
    packageFilePath: string;
    databaseName: string;
    ownerUri: string;
}

/**
 * Parameters for exporting a BACPAC
 */
export interface ExportBacpacParams {
    databaseName: string;
    packageFilePath: string;
    ownerUri: string;
}

/**
 * Result from a Data-tier Application operation
 */
export interface DataTierApplicationResult {
    success: boolean;
    errorMessage?: string;
    operationId?: string;
}

/**
 * Request to deploy a DACPAC from the webview
 */
export namespace DeployDacpacWebviewRequest {
    export const type = new RequestType<DeployDacpacParams, DataTierApplicationResult, void>(
        "dataTierApplication/deployDacpac",
    );
}

/**
 * Request to extract a DACPAC from the webview
 */
export namespace ExtractDacpacWebviewRequest {
    export const type = new RequestType<ExtractDacpacParams, DataTierApplicationResult, void>(
        "dataTierApplication/extractDacpac",
    );
}

/**
 * Request to import a BACPAC from the webview
 */
export namespace ImportBacpacWebviewRequest {
    export const type = new RequestType<ImportBacpacParams, DataTierApplicationResult, void>(
        "dataTierApplication/importBacpac",
    );
}

/**
 * Request to export a BACPAC from the webview
 */
export namespace ExportBacpacWebviewRequest {
    export const type = new RequestType<ExportBacpacParams, DataTierApplicationResult, void>(
        "dataTierApplication/exportBacpac",
    );
}

/**
 * Request to validate a file path from the webview
 */
export namespace ValidateFilePathWebviewRequest {
    export const type = new RequestType<
        { filePath: string; shouldExist: boolean },
        { isValid: boolean; errorMessage?: string },
        void
    >("dataTierApplication/validateFilePath");
}

/**
 * Request to list databases on a server from the webview
 */
export namespace ListDatabasesWebviewRequest {
    export const type = new RequestType<{ ownerUri: string }, { databases: string[] }, void>(
        "dataTierApplication/listDatabases",
    );
}

/**
 * Request to validate a database name from the webview
 */
export namespace ValidateDatabaseNameWebviewRequest {
    export const type = new RequestType<
        {
            databaseName: string;
            ownerUri: string;
            shouldNotExist: boolean;
            operationType?: DataTierOperationType;
        },
        { isValid: boolean; errorMessage?: string },
        void
    >("dataTierApplication/validateDatabaseName");
}

/**
 * Request to list available connections from the webview
 */
export namespace ListConnectionsWebviewRequest {
    export const type = new RequestType<void, { connections: ConnectionProfile[] }, void>(
        "dataTierApplication/listConnections",
    );
}

/**
 * Request to connect to a server from the webview
 */
export namespace ConnectToServerWebviewRequest {
    export const type = new RequestType<
        { profileId: string },
        { ownerUri: string; isConnected: boolean; errorMessage?: string },
        void
    >("dataTierApplication/connectToServer");
}

/**
 * Notification sent from the webview to cancel the operation
 */
export namespace CancelDataTierApplicationWebviewNotification {
    export const type = new NotificationType<void>("dataTierApplication/cancel");
}

/**
 * Notification sent to the webview to update progress
 */
export namespace DataTierApplicationProgressNotification {
    export const type = new NotificationType<{ message: string; percentage?: number }>(
        "dataTierApplication/progress",
    );
}

/**
 * Request to browse for an input file (DACPAC or BACPAC) from the webview
 */
export namespace BrowseInputFileWebviewRequest {
    export const type = new RequestType<{ fileExtension: string }, { filePath?: string }, void>(
        "dataTierApplication/browseInputFile",
    );
}

/**
 * Request to browse for an output file (DACPAC or BACPAC) from the webview
 */
export namespace BrowseOutputFileWebviewRequest {
    export const type = new RequestType<
        { fileExtension: string; defaultFileName?: string },
        { filePath?: string },
        void
    >("dataTierApplication/browseOutputFile");
}

/**
 * Request to show a confirmation dialog for deploying to an existing database
 */
export namespace ConfirmDeployToExistingWebviewRequest {
    export const type = new RequestType<void, { confirmed: boolean }, void>(
        "dataTierApplication/confirmDeployToExisting",
    );
}
