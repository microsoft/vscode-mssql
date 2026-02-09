/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useMemo } from "react";
import { BackupDatabaseProvider } from "../../../../sharedInterfaces/backup";
import { getCoreRPCs } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider2";
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
    const { extensionRpc } = useVscodeWebview<
        ObjectManagementWebviewState,
        ObjectManagementReducers
    >();

    const commands = useMemo(() => {
        return {
            extensionRpc,
            ...getCoreRPCs(extensionRpc),
            formAction(event: any) {
                extensionRpc.action("formAction", { event });
            },
            backupDatabase(): void {
                extensionRpc.action("backupDatabase", {});
            },
            openBackupScript(): void {
                extensionRpc.action("openBackupScript", {});
            },
            setSaveLocation(saveToUrl: boolean): void {
                extensionRpc.action("setSaveLocation", { saveToUrl });
            },
            removeBackupFile(filePath: string): void {
                extensionRpc.action("removeBackupFile", { filePath });
            },
            openFileBrowser(
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
                extensionRpc.action("expandNode", { ownerUri, nodePath });
            },
            submitFilePath(selectedPath: string): void {
                extensionRpc.action("submitFilePath", { selectedPath });
            },
            closeFileBrowser(ownerUri: string): void {
                extensionRpc.action("closeFileBrowser", { ownerUri });
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
                extensionRpc.action("loadAzureComponent", { componentName });
            },
        };
    }, [extensionRpc]);

    return (
        <BackupDatabaseContext.Provider value={commands}>{children}</BackupDatabaseContext.Provider>
    );
};

export { BackupDatabaseContext, BackupDatabaseStateProvider };
