/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { IConnectionDialogProfile } from "./connectionDialog";

/**
 * The type of DacPacDialog Application operation to perform
 */
export enum DacPacDialogOperationType {
    Deploy = "deploy",
    Extract = "extract",
    Import = "import",
    Export = "export",
}

/**
 * The state of the DacPacDialog Application webview
 */
export interface DacpacDialogWebviewState {
    /**
     * The currently selected operation type
     */
    operationType: DacPacDialogOperationType;
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
 * Base parameters for DacPacDialog operations
 */
interface DacPacDialogOperationParams {
    databaseName: string;
    packageFilePath: string;
    ownerUri: string;
}

/**
 * Parameters for exporting a BACPAC
 */
export interface ExportBacpacParams extends DacPacDialogOperationParams {}

/**
 * Parameters for deploying a DACPAC
 */
export interface DeployDacpacParams extends DacPacDialogOperationParams {
    isNewDatabase: boolean;
}

/**
 * Parameters for extracting a DACPAC
 */
export interface ExtractDacpacParams extends DacPacDialogOperationParams {
    applicationName?: string;
    applicationVersion?: string;
}

/**
 * Parameters for importing a BACPAC
 */
export interface ImportBacpacParams extends DacPacDialogOperationParams {}

/**
 * Parameters for exporting a BACPAC
 */
export interface ExportBacpacParams extends DacPacDialogOperationParams {}

/**
 * Result from a DacPacDialog Application operation
 */
export interface DacpacDialogResult {
    success: boolean;
    errorMessage?: string;
    operationId?: string;
}

/**
 * Request to deploy a DACPAC from the webview
 */
export namespace DeployDacpacWebviewRequest {
    export const type = new RequestType<DeployDacpacParams, DacpacDialogResult, void>(
        "dacpacDialog/deployDacpac",
    );
}

/**
 * Request to extract a DACPAC from the webview
 */
export namespace ExtractDacpacWebviewRequest {
    export const type = new RequestType<ExtractDacpacParams, DacpacDialogResult, void>(
        "dacpacDialog/extractDacpac",
    );
}

/**
 * Request to import a BACPAC from the webview
 */
export namespace ImportBacpacWebviewRequest {
    export const type = new RequestType<ImportBacpacParams, DacpacDialogResult, void>(
        "dacpacDialog/importBacpac",
    );
}

/**
 * Request to export a BACPAC from the webview
 */
export namespace ExportBacpacWebviewRequest {
    export const type = new RequestType<ExportBacpacParams, DacpacDialogResult, void>(
        "dacpacDialog/exportBacpac",
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
    >("dacpacDialog/validateFilePath");
}

/**
 * Request to list databases on a server from the webview
 */
export namespace ListDatabasesWebviewRequest {
    export const type = new RequestType<{ ownerUri: string }, { databases: string[] }, void>(
        "dacpacDialog/listDatabases",
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
            operationType?: DacPacDialogOperationType;
        },
        { isValid: boolean; errorMessage?: string },
        void
    >("dacpacDialog/validateDatabaseName");
}

/**
 * Request to list available connections from the webview
 */
export namespace ListConnectionsWebviewRequest {
    export const type = new RequestType<void, { connections: IConnectionDialogProfile[] }, void>(
        "dacpacDialog/listConnections",
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
            isFabric?: boolean;
        },
        void
    >("dacpacDialog/initializeConnection");
}

/**
 * Request to connect to a server from the webview
 */
export namespace ConnectToServerWebviewRequest {
    export const type = new RequestType<
        { profileId: string },
        { ownerUri: string; isConnected: boolean; errorMessage?: string; isFabric?: boolean },
        void
    >("dacpacDialog/connectToServer");
}

/**
 * Notification sent from the webview to cancel the operation
 */
export namespace CancelDacpacDialogWebviewNotification {
    export const type = new NotificationType<void>("dacpacDialog/cancel");
}

/**
 * Notification sent to the webview to update progress
 */
export namespace DacpacDialogProgressNotification {
    export const type = new NotificationType<{ message: string; percentage?: number }>(
        "dacpacDialog/progress",
    );
}

/**
 * Request to browse for an input file (DACPAC or BACPAC) from the webview
 */
export namespace BrowseInputFileWebviewRequest {
    export const type = new RequestType<{ fileExtension: string }, { filePath?: string }, void>(
        "dacpacDialog/browseInputFile",
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
    >("dacpacDialog/browseOutputFile");
}

/**
 * Request to get the suggested full path for an output file without showing dialog
 * Generates path with timestamp based on database name and operation type
 */
export namespace GetSuggestedOutputPathWebviewRequest {
    export const type = new RequestType<
        { databaseName: string; operationType: DacPacDialogOperationType },
        { fullPath: string },
        void
    >("dacpacDialog/getSuggestedOutputPath");
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
    >("dacpacDialog/getSuggestedFilename");
}

/**
 * Request to get the suggested database name from a file path
 * Extracts database name from the filename without extension or timestamps
 */
export namespace GetSuggestedDatabaseNameWebviewRequest {
    export const type = new RequestType<{ filePath: string }, { databaseName: string }, void>(
        "dacpacDialog/getSuggestedDatabaseName",
    );
}

/**
 * Request to show a confirmation dialog for deploying to an existing database
 */
export namespace ConfirmDeployToExistingWebviewRequest {
    export const type = new RequestType<void, { confirmed: boolean }, void>(
        "dacpacDialog/confirmDeployToExisting",
    );
}
