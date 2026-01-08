/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    BackupDatabaseFormState,
    BackupDatabaseProvider,
    BackupDatabaseReducers,
    BackupDatabaseState,
} from "../../../sharedInterfaces/objectManagement";
import { FormEvent } from "../../../sharedInterfaces/form";
import { ReactNode, createContext } from "react";
import { getCoreRPCs } from "../../common/utils";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const BackupDatabaseContext = createContext<BackupDatabaseProvider | undefined>(undefined);

interface BackupDatabaseProviderProps {
    children: ReactNode;
}

const BackupDatabaseStateProvider: React.FC<BackupDatabaseProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<BackupDatabaseState, BackupDatabaseReducers>();

    return (
        <BackupDatabaseContext.Provider
            value={{
                state: webviewState?.state as any,
                themeKind: webviewState?.themeKind,
                keyBindings: webviewState?.keyBindings,
                ...getCoreRPCs(webviewState),
                formAction: function (event): void {
                    webviewState?.extensionRpc.action("formAction", {
                        event: event as FormEvent<BackupDatabaseFormState>,
                    });
                },
                backupDatabase: function (): void {
                    webviewState?.extensionRpc.action("backupDatabase", {});
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
                toggleFileBrowserDialog(shouldOpen: boolean): void {
                    webviewState?.extensionRpc.action("toggleFileBrowserDialog", {
                        shouldOpen,
                    });
                },
            }}>
            {children}
        </BackupDatabaseContext.Provider>
    );
};

export { BackupDatabaseContext, BackupDatabaseStateProvider };
