/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { IConnectionDialogProfile } from "./connectionDialog";

/**
 * The type of DacFx Application operation to perform
 */
export enum DacFxOperationType {
    Deploy = "deploy",
    Extract = "extract",
    Import = "import",
    Export = "export",
}

/**
 * The state of the DacFx Application webview
 */
export interface DacFxApplicationWebviewState {
    /**
     * The currently selected operation type
     */
    operationType: DacFxOperationType;
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
    availableConnections?: IConnectionDialogProfile[];
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
 * Base parameters for DacFx operations
 */
interface DacFxOperationParams {
    databaseName: string;
    packageFilePath: string;
    ownerUri: string;
}

/**
 * Parameters for exporting a BACPAC
 */
export interface ExportBacpacParams extends DacFxOperationParams {}

/**
 * Parameters for deploying a DACPAC
 */
export interface DeployDacpacParams extends DacFxOperationParams {
    isNewDatabase: boolean;
}

/**
 * Parameters for extracting a DACPAC
 */
export interface ExtractDacpacParams extends DacFxOperationParams {
    applicationName?: string;
    applicationVersion?: string;
}

/**
 * Parameters for importing a BACPAC
 */
export interface ImportBacpacParams extends DacFxOperationParams {}

/**
 * Parameters for exporting a BACPAC
 */
export interface ExportBacpacParams extends DacFxOperationParams {}

/**
 * Result from a DacFx Application operation
 */
export interface DacFxApplicationResult {
    success: boolean;
    errorMessage?: string;
    operationId?: string;
}

/**
 * Request to deploy a DACPAC from the webview
 */
export namespace DeployDacpacWebviewRequest {
    export const type = new RequestType<DeployDacpacParams, DacFxApplicationResult, void>(
        "dacFxApplication/deployDacpac",
    );
}

/**
 * Request to extract a DACPAC from the webview
 */
export namespace ExtractDacpacWebviewRequest {
    export const type = new RequestType<ExtractDacpacParams, DacFxApplicationResult, void>(
        "dacFxApplication/extractDacpac",
    );
}

/**
 * Request to import a BACPAC from the webview
 */
export namespace ImportBacpacWebviewRequest {
    export const type = new RequestType<ImportBacpacParams, DacFxApplicationResult, void>(
        "dacFxApplication/importBacpac",
    );
}

/**
 * Request to export a BACPAC from the webview
 */
export namespace ExportBacpacWebviewRequest {
    export const type = new RequestType<ExportBacpacParams, DacFxApplicationResult, void>(
        "dacFxApplication/exportBacpac",
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
    >("dacFxApplication/validateFilePath");
}

/**
 * Request to list databases on a server from the webview
 */
export namespace ListDatabasesWebviewRequest {
    export const type = new RequestType<{ ownerUri: string }, { databases: string[] }, void>(
        "dacFxApplication/listDatabases",
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
            operationType?: DacFxOperationType;
        },
        { isValid: boolean; errorMessage?: string },
        void
    >("dacFxApplication/validateDatabaseName");
}

/**
 * Request to list available connections from the webview
 */
export namespace ListConnectionsWebviewRequest {
    export const type = new RequestType<void, { connections: IConnectionDialogProfile[] }, void>(
        "dacFxApplication/listConnections",
    );
}

/**
 * Request to initialize connection based on initial state
 * This handles auto-matching and auto-connecting if needed
 */
export namespace InitializeConnectionWebviewRequest {
    export const type = new RequestType<
        {
            initialServerName?: string;
            initialDatabaseName?: string;
            initialOwnerUri?: string;
            initialProfileId?: string;
        },
        {
            connections: IConnectionDialogProfile[];
            selectedConnection?: IConnectionDialogProfile;
            ownerUri?: string;
            autoConnected: boolean;
            errorMessage?: string;
        },
        void
    >("dacFxApplication/initializeConnection");
}

/**
 * Request to connect to a server from the webview
 */
export namespace ConnectToServerWebviewRequest {
    export const type = new RequestType<
        { profileId: string },
        { ownerUri: string; isConnected: boolean; errorMessage?: string },
        void
    >("dacFxApplication/connectToServer");
}

/**
 * Notification sent from the webview to cancel the operation
 */
export namespace CancelDacFxApplicationWebviewNotification {
    export const type = new NotificationType<void>("dacFxApplication/cancel");
}

/**
 * Notification sent to the webview to update progress
 */
export namespace DacFxApplicationProgressNotification {
    export const type = new NotificationType<{ message: string; percentage?: number }>(
        "dacFxApplication/progress",
    );
}

/**
 * Request to browse for an input file (DACPAC or BACPAC) from the webview
 */
export namespace BrowseInputFileWebviewRequest {
    export const type = new RequestType<{ fileExtension: string }, { filePath?: string }, void>(
        "dacFxApplication/browseInputFile",
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
    >("dacFxApplication/browseOutputFile");
}

/**
 * Request to get the suggested full path for an output file without showing dialog
 * Generates path with timestamp based on database name and operation type
 */
export namespace GetSuggestedOutputPathWebviewRequest {
    export const type = new RequestType<
        { databaseName: string; operationType: DacFxOperationType },
        { fullPath: string },
        void
    >("dacFxApplication/getSuggestedOutputPath");
}

/**
 * Request to get the suggested filename (with timestamp) for an output file
 * Used when browsing to suggest a default filename
 */
export namespace GetSuggestedFilenameWebviewRequest {
    export const type = new RequestType<
        { databaseName: string; fileExtension: string },
        { filename: string },
        void
    >("dacFxApplication/getSuggestedFilename");
}

/**
 * Request to get the suggested database name from a file path
 * Extracts database name from the filename without extension or timestamps
 */
export namespace GetSuggestedDatabaseNameWebviewRequest {
    export const type = new RequestType<{ filePath: string }, { databaseName: string }, void>(
        "dacFxApplication/getSuggestedDatabaseName",
    );
}

/**
 * Request to show a confirmation dialog for deploying to an existing database
 */
export namespace ConfirmDeployToExistingWebviewRequest {
    export const type = new RequestType<void, { confirmed: boolean }, void>(
        "dacFxApplication/confirmDeployToExisting",
    );
}
