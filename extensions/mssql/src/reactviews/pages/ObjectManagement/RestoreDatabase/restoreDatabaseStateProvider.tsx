/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from "react";
import {
    RestoreDatabaseFormState,
    RestoreDatabaseProvider,
    RestoreDatabaseReducers,
} from "../../../../sharedInterfaces/restore";
import { getCoreRPCs } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    DisasterRecoveryType,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { WebviewRpc } from "../../../common/rpc";

export interface RestoreDatabaseContextProps extends RestoreDatabaseProvider {
    extensionRpc: WebviewRpc<RestoreDatabaseReducers<RestoreDatabaseFormState>>;
}

const RestoreDatabaseContext = createContext<RestoreDatabaseContextProps | undefined>(undefined);

interface RestoreDatabaseProviderProps {
    children: ReactNode;
}

const RestoreDatabaseStateProvider: React.FC<RestoreDatabaseProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<
        ObjectManagementWebviewState<RestoreDatabaseFormState>,
        RestoreDatabaseReducers<RestoreDatabaseFormState>
    >();

    return (
        <RestoreDatabaseContext.Provider
            value={{
                extensionRpc,
                ...getCoreRPCs(extensionRpc),
                formAction(event) {
                    extensionRpc.action("formAction", { event });
                },
                restoreDatabase: function (): void {
                    extensionRpc.action("restoreDatabase", {});
                },
                openRestoreScript: function (): void {
                    extensionRpc.action("openRestoreScript", {});
                },
                setType: function (type: DisasterRecoveryType): void {
                    extensionRpc.action("setType", {
                        type,
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
                submitFilePath(selectedPath: string, propertyName?: string): void {
                    extensionRpc.action("submitFilePath", {
                        selectedPath,
                        propertyName,
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
                loadAzureComponent(componentName: string): void {
                    extensionRpc.action("loadAzureComponent", {
                        componentName,
                    });
                },
                removeBackupFile: function (filePath: string): void {
                    extensionRpc.action("removeBackupFile", {
                        filePath,
                    });
                },
                updateSelectedBackupSets: function (selectedBackupSets: number[]): void {
                    extensionRpc.action("updateSelectedBackupSets", {
                        selectedBackupSets,
                    });
                },
            }}>
            {children}
        </RestoreDatabaseContext.Provider>
    );
};

export { RestoreDatabaseContext, RestoreDatabaseStateProvider };
