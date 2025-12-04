/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import * as dacpacDialog from "../../../sharedInterfaces/dacpacDialog";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";

/**
 * RPC helper methods for DacPac operations
 */
export interface DacpacDialogRpcMethods {
    // Operation execution methods
    deployDacpac: (
        params: dacpacDialog.DeployDacpacParams,
    ) => Promise<dacpacDialog.DacpacDialogResult | undefined>;
    extractDacpac: (
        params: dacpacDialog.ExtractDacpacParams,
    ) => Promise<dacpacDialog.DacpacDialogResult | undefined>;
    importBacpac: (
        params: dacpacDialog.ImportBacpacParams,
    ) => Promise<dacpacDialog.DacpacDialogResult | undefined>;
    exportBacpac: (
        params: dacpacDialog.ExportBacpacParams,
    ) => Promise<dacpacDialog.DacpacDialogResult | undefined>;

    // Validation methods
    validateFilePath: (params: {
        filePath: string;
        shouldExist: boolean;
    }) => Promise<{ isValid: boolean; errorMessage?: string } | undefined>;
    validateDatabaseName: (params: {
        databaseName: string;
        ownerUri: string;
        shouldNotExist: boolean;
        operationType?: dacpacDialog.DacPacDialogOperationType;
    }) => Promise<{ isValid: boolean; errorMessage?: string } | undefined>;

    // Connection methods
    initializeConnection: (params: {
        initialServerName?: string;
        initialDatabaseName?: string;
        initialOwnerUri?: string;
        initialProfileId?: string;
    }) => Promise<
        | {
              connections: IConnectionDialogProfile[];
              selectedConnection?: IConnectionDialogProfile;
              ownerUri?: string;
              autoConnected: boolean;
              errorMessage?: string;
              isFabric?: boolean;
          }
        | undefined
    >;
    connectToServer: (params: {
        profileId: string;
    }) => Promise<
        | { ownerUri: string; isConnected: boolean; errorMessage?: string; isFabric?: boolean }
        | undefined
    >;
    listDatabases: (params: { ownerUri: string }) => Promise<{ databases: string[] } | undefined>;

    // File browsing methods
    browseInputFile: (params: {
        fileExtension: string;
    }) => Promise<{ filePath?: string } | undefined>;
    browseOutputFile: (params: {
        fileExtension: string;
        defaultFileName?: string;
    }) => Promise<{ filePath?: string } | undefined>;

    // Helper methods
    getSuggestedOutputPath: (params: {
        databaseName: string;
        operationType: dacpacDialog.DacPacDialogOperationType;
    }) => Promise<{ fullPath: string } | undefined>;
    getSuggestedFilename: (params: {
        databaseName: string;
        fileExtension: string;
    }) => Promise<{ filename: string } | undefined>;
    getSuggestedDatabaseName: (params: {
        filePath: string;
    }) => Promise<{ databaseName: string } | undefined>;

    // Confirmation dialog
    confirmDeployToExisting: () => Promise<{ confirmed: boolean } | undefined>;

    // Cancel operation
    cancel: () => Promise<void>;
}

export interface DacpacDialogReactProvider extends DacpacDialogRpcMethods {
    extensionRpc: WebviewRpc<void>;
}

export const DacpacDialogContext = createContext<DacpacDialogReactProvider | undefined>(undefined);

interface DacpacDialogProviderProps {
    children: ReactNode;
}

const DacpacDialogStateProvider: React.FC<DacpacDialogProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<dacpacDialog.DacpacDialogWebviewState, void>();

    // Operation execution methods
    const deployDacpac = async (params: dacpacDialog.DeployDacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.DeployDacpacWebviewRequest.type,
            params,
        );
    };

    const extractDacpac = async (params: dacpacDialog.ExtractDacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ExtractDacpacWebviewRequest.type,
            params,
        );
    };

    const importBacpac = async (params: dacpacDialog.ImportBacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ImportBacpacWebviewRequest.type,
            params,
        );
    };

    const exportBacpac = async (params: dacpacDialog.ExportBacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ExportBacpacWebviewRequest.type,
            params,
        );
    };

    // Validation methods
    const validateFilePath = async (params: { filePath: string; shouldExist: boolean }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ValidateFilePathWebviewRequest.type,
            params,
        );
    };

    const validateDatabaseName = async (params: {
        databaseName: string;
        ownerUri: string;
        shouldNotExist: boolean;
        operationType?: dacpacDialog.DacPacDialogOperationType;
    }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ValidateDatabaseNameWebviewRequest.type,
            params,
        );
    };

    // Connection methods
    const initializeConnection = async (params: {
        initialServerName?: string;
        initialDatabaseName?: string;
        initialOwnerUri?: string;
        initialProfileId?: string;
    }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.InitializeConnectionWebviewRequest.type,
            params,
        );
    };

    const connectToServer = async (params: { profileId: string }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ConnectToServerWebviewRequest.type,
            params,
        );
    };

    const listDatabases = async (params: { ownerUri: string }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ListDatabasesWebviewRequest.type,
            params,
        );
    };

    // File browsing methods
    const browseInputFile = async (params: { fileExtension: string }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.BrowseInputFileWebviewRequest.type,
            params,
        );
    };

    const browseOutputFile = async (params: {
        fileExtension: string;
        defaultFileName?: string;
    }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.BrowseOutputFileWebviewRequest.type,
            params,
        );
    };

    // Helper methods
    const getSuggestedOutputPath = async (params: {
        databaseName: string;
        operationType: dacpacDialog.DacPacDialogOperationType;
    }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.GetSuggestedOutputPathWebviewRequest.type,
            params,
        );
    };

    const getSuggestedFilename = async (params: {
        databaseName: string;
        fileExtension: string;
    }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.GetSuggestedFilenameWebviewRequest.type,
            params,
        );
    };

    const getSuggestedDatabaseName = async (params: { filePath: string }) => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.GetSuggestedDatabaseNameWebviewRequest.type,
            params,
        );
    };

    // Confirmation dialog
    const confirmDeployToExisting = async () => {
        return await extensionRpc?.sendRequest(
            dacpacDialog.ConfirmDeployToExistingWebviewRequest.type,
            undefined,
        );
    };

    // Cancel operation
    const cancel = async () => {
        await extensionRpc?.sendNotification(
            dacpacDialog.CancelDacpacDialogWebviewNotification.type,
        );
    };

    const providerValue: DacpacDialogReactProvider = {
        extensionRpc,
        deployDacpac,
        extractDacpac,
        importBacpac,
        exportBacpac,
        validateFilePath,
        validateDatabaseName,
        initializeConnection,
        connectToServer,
        listDatabases,
        browseInputFile,
        browseOutputFile,
        getSuggestedOutputPath,
        getSuggestedFilename,
        getSuggestedDatabaseName,
        confirmDeployToExisting,
        cancel,
    };

    return (
        <DacpacDialogContext.Provider value={providerValue}>
            {children}
        </DacpacDialogContext.Provider>
    );
};

export { DacpacDialogStateProvider };
