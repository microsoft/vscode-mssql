/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import * as dacFxApplication from "../../../sharedInterfaces/dacFxApplication";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";

/**
 * RPC helper methods for DacFx operations
 */
export interface DacFxApplicationRpcMethods {
    // Operation execution methods
    deployDacpac: (
        params: dacFxApplication.DeployDacpacParams,
    ) => Promise<dacFxApplication.DacFxApplicationResult | undefined>;
    extractDacpac: (
        params: dacFxApplication.ExtractDacpacParams,
    ) => Promise<dacFxApplication.DacFxApplicationResult | undefined>;
    importBacpac: (
        params: dacFxApplication.ImportBacpacParams,
    ) => Promise<dacFxApplication.DacFxApplicationResult | undefined>;
    exportBacpac: (
        params: dacFxApplication.ExportBacpacParams,
    ) => Promise<dacFxApplication.DacFxApplicationResult | undefined>;

    // Validation methods
    validateFilePath: (params: {
        filePath: string;
        shouldExist: boolean;
    }) => Promise<{ isValid: boolean; errorMessage?: string } | undefined>;
    validateDatabaseName: (params: {
        databaseName: string;
        ownerUri: string;
        shouldNotExist: boolean;
        operationType?: dacFxApplication.DacFxOperationType;
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
          }
        | undefined
    >;
    connectToServer: (params: {
        profileId: string;
    }) => Promise<{ ownerUri: string; isConnected: boolean; errorMessage?: string } | undefined>;
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
        operationType: dacFxApplication.DacFxOperationType;
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

export interface DacFxApplicationReactProvider extends DacFxApplicationRpcMethods {
    extensionRpc: WebviewRpc<void>;
}

export const DacFxApplicationContext = createContext<DacFxApplicationReactProvider | undefined>(
    undefined,
);

interface DacFxApplicationProviderProps {
    children: ReactNode;
}

const DacFxApplicationStateProvider: React.FC<DacFxApplicationProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<
        dacFxApplication.DacFxApplicationWebviewState,
        void
    >();

    // Operation execution methods
    const deployDacpac = async (params: dacFxApplication.DeployDacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.DeployDacpacWebviewRequest.type,
            params,
        );
    };

    const extractDacpac = async (params: dacFxApplication.ExtractDacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ExtractDacpacWebviewRequest.type,
            params,
        );
    };

    const importBacpac = async (params: dacFxApplication.ImportBacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ImportBacpacWebviewRequest.type,
            params,
        );
    };

    const exportBacpac = async (params: dacFxApplication.ExportBacpacParams) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ExportBacpacWebviewRequest.type,
            params,
        );
    };

    // Validation methods
    const validateFilePath = async (params: { filePath: string; shouldExist: boolean }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ValidateFilePathWebviewRequest.type,
            params,
        );
    };

    const validateDatabaseName = async (params: {
        databaseName: string;
        ownerUri: string;
        shouldNotExist: boolean;
        operationType?: dacFxApplication.DacFxOperationType;
    }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ValidateDatabaseNameWebviewRequest.type,
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
            dacFxApplication.InitializeConnectionWebviewRequest.type,
            params,
        );
    };

    const connectToServer = async (params: { profileId: string }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ConnectToServerWebviewRequest.type,
            params,
        );
    };

    const listDatabases = async (params: { ownerUri: string }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ListDatabasesWebviewRequest.type,
            params,
        );
    };

    // File browsing methods
    const browseInputFile = async (params: { fileExtension: string }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.BrowseInputFileWebviewRequest.type,
            params,
        );
    };

    const browseOutputFile = async (params: {
        fileExtension: string;
        defaultFileName?: string;
    }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.BrowseOutputFileWebviewRequest.type,
            params,
        );
    };

    // Helper methods
    const getSuggestedOutputPath = async (params: {
        databaseName: string;
        operationType: dacFxApplication.DacFxOperationType;
    }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.GetSuggestedOutputPathWebviewRequest.type,
            params,
        );
    };

    const getSuggestedFilename = async (params: {
        databaseName: string;
        fileExtension: string;
    }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.GetSuggestedFilenameWebviewRequest.type,
            params,
        );
    };

    const getSuggestedDatabaseName = async (params: { filePath: string }) => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.GetSuggestedDatabaseNameWebviewRequest.type,
            params,
        );
    };

    // Confirmation dialog
    const confirmDeployToExisting = async () => {
        return await extensionRpc?.sendRequest(
            dacFxApplication.ConfirmDeployToExistingWebviewRequest.type,
            undefined,
        );
    };

    // Cancel operation
    const cancel = async () => {
        await extensionRpc?.sendNotification(
            dacFxApplication.CancelDacFxApplicationWebviewNotification.type,
        );
    };

    const providerValue: DacFxApplicationReactProvider = {
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
        <DacFxApplicationContext.Provider value={providerValue}>
            {children}
        </DacFxApplicationContext.Provider>
    );
};

export { DacFxApplicationStateProvider };
