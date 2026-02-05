/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from "react";
import { BackupDatabaseProvider } from "../../../../sharedInterfaces/backup";
import { getCoreRPCs } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    ObjectManagementReducers,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { WebviewRpc } from "../../../common/rpc";

export interface BackupDatabaseContextProps extends BackupDatabaseProvider {
    extensionRpc: WebviewRpc<ObjectManagementReducers>;
}

const BackupDatabaseContext = createContext<BackupDatabaseContextProps | undefined>(undefined);

interface BackupDatabaseProviderProps {
    children: ReactNode;
}

const BackupDatabaseStateProvider: React.FC<BackupDatabaseProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<ObjectManagementWebviewState, ObjectManagementReducers>();

    return (
        <BackupDatabaseContext.Provider
            value={{
                extensionRpc: webviewState!.extensionRpc,
                state: webviewState?.state as any,
                themeKind: webviewState?.themeKind,
                keyBindings: webviewState?.keyBindings,
                ...getCoreRPCs(webviewState),
                formAction(event) {
                    webviewState?.extensionRpc.action("formAction", { event });
                },
                backupDatabase: function (): void {
                    webviewState?.extensionRpc.action("backupDatabase", {});
                },
                openBackupScript: function (): void {
                    webviewState?.extensionRpc.action("openBackupScript", {});
                },
                setSaveLocation: function (saveToUrl: boolean): void {
                    webviewState?.extensionRpc.action("setSaveLocation", {
                        saveToUrl,
                    });
                },
                removeBackupFile: function (filePath: string): void {
                    webviewState?.extensionRpc.action("removeBackupFile", {
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
                    webviewState?.extensionRpc.action("openFileBrowser", {
                        ownerUri,
                        expandPath,
                        fileFilters,
                        changeFilter,
                        showFoldersOnly,
                    });
                },
                expandNode(ownerUri: string, nodePath: string): void {
                    webviewState?.extensionRpc.action("expandNode", {
                        ownerUri,
                        nodePath,
                    });
                },
                submitFilePath(selectedPath: string): void {
                    webviewState?.extensionRpc.action("submitFilePath", {
                        selectedPath,
                    });
                },
                closeFileBrowser(ownerUri: string): void {
                    webviewState?.extensionRpc.action("closeFileBrowser", {
                        ownerUri,
                    });
                },
                toggleFileBrowserDialog(foldersOnly: boolean, shouldOpen: boolean): void {
                    webviewState?.extensionRpc.action("toggleFileBrowserDialog", {
                        foldersOnly,
                        shouldOpen,
                    });
                },
                handleFileChange(index: number, newValue: string, isFolderChange: boolean): void {
                    webviewState?.extensionRpc.action("handleFileChange", {
                        index,
                        newValue,
                        isFolderChange,
                    });
                },
                loadAzureComponent(componentName: string): void {
                    webviewState?.extensionRpc.action("loadAzureComponent", {
                        componentName,
                    });
                },
            }}>
            {children}
        </BackupDatabaseContext.Provider>
    );
};

export { BackupDatabaseContext, BackupDatabaseStateProvider };
