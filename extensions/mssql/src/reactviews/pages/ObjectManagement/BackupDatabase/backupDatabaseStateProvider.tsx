/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from "react";
import {
    BackupDatabaseFormState,
    BackupDatabaseProvider,
    BackupDatabaseReducers,
} from "../../../../sharedInterfaces/backup";
import { getCoreRPCs } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    DisasterRecoveryType,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { WebviewRpc } from "../../../common/rpc";

export interface BackupDatabaseContextProps extends BackupDatabaseProvider {
    extensionRpc: WebviewRpc<BackupDatabaseReducers<BackupDatabaseFormState>>;
}

const BackupDatabaseContext = createContext<BackupDatabaseContextProps | undefined>(undefined);

interface BackupDatabaseProviderProps {
    children: ReactNode;
}

const BackupDatabaseStateProvider: React.FC<BackupDatabaseProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<
        ObjectManagementWebviewState<BackupDatabaseFormState>,
        BackupDatabaseReducers<BackupDatabaseFormState>
    >();

    return (
        <BackupDatabaseContext.Provider
            value={{
                extensionRpc: extensionRpc,
                ...getCoreRPCs(extensionRpc),
                formAction(event) {
                    extensionRpc.action("formAction", { event });
                },
                backupDatabase: function (): void {
                    extensionRpc.action("backupDatabase", {});
                },
                openBackupScript: function (): void {
                    extensionRpc.action("openBackupScript", {});
                },
                setType: function (type: DisasterRecoveryType): void {
                    extensionRpc.action("setType", {
                        type,
                    });
                },
                removeBackupFile: function (filePath: string): void {
                    extensionRpc.action("removeBackupFile", {
                        filePath,
                    });
                },
                openFileBrowser: function (
                    ownerUri: string,
                    expandPath: string,
                    fileFilters: string[],
                    changeFilter: boolean,
                    showFoldersOnly: boolean,
                ): void {
                    extensionRpc.action("openFileBrowser", {
                        ownerUri,
                        expandPath,
                        fileFilters,
                        changeFilter,
                        showFoldersOnly,
                    });
                },
                expandNode(ownerUri: string, nodePath: string): void {
                    extensionRpc.action("expandNode", {
                        ownerUri,
                        nodePath,
                    });
                },
                submitFilePath(selectedPath: string): void {
                    extensionRpc.action("submitFilePath", {
                        selectedPath,
                    });
                },
                closeFileBrowser(ownerUri: string): void {
                    extensionRpc.action("closeFileBrowser", {
                        ownerUri,
                    });
                },
                toggleFileBrowserDialog(foldersOnly: boolean, shouldOpen: boolean): void {
                    extensionRpc.action("toggleFileBrowserDialog", {
                        foldersOnly,
                        shouldOpen,
                    });
                },
                handleFileChange(index: number, newValue: string, isFolderChange: boolean): void {
                    extensionRpc.action("handleFileChange", {
                        index,
                        newValue,
                        isFolderChange,
                    });
                },
                loadAzureComponent(componentName: string): void {
                    extensionRpc.action("loadAzureComponent", {
                        componentName,
                    });
                },
            }}>
            {children}
        </BackupDatabaseContext.Provider>
    );
};

export { BackupDatabaseContext, BackupDatabaseStateProvider };
