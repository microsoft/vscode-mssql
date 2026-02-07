/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from "react";
import {
    RestoreDatabaseFormState,
    RestoreDatabaseProvider,
    RestoreDatabaseReducers,
    RestoreType,
} from "../../../../sharedInterfaces/restore";
import { getCoreRPCs } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { ObjectManagementWebviewState } from "../../../../sharedInterfaces/objectManagement";
import { WebviewRpc } from "../../../common/rpc";

export interface RestoreDatabaseContextProps extends RestoreDatabaseProvider {
    extensionRpc: WebviewRpc<RestoreDatabaseReducers<RestoreDatabaseFormState>>;
}

const RestoreDatabaseContext = createContext<RestoreDatabaseContextProps | undefined>(undefined);

interface RestoreDatabaseProviderProps {
    children: ReactNode;
}

const RestoreDatabaseStateProvider: React.FC<RestoreDatabaseProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<
        ObjectManagementWebviewState<RestoreDatabaseFormState>,
        RestoreDatabaseReducers<RestoreDatabaseFormState>
    >();

    return (
        <RestoreDatabaseContext.Provider
            value={{
                extensionRpc: webviewState!.extensionRpc,
                state: webviewState?.state as ObjectManagementWebviewState<RestoreDatabaseFormState>,
                themeKind: webviewState?.themeKind,
                keyBindings: webviewState?.keyBindings,
                ...getCoreRPCs(webviewState),
                formAction(event) {
                    webviewState?.extensionRpc.action("formAction", { event });
                },
                restoreDatabase: function (): void {
                    webviewState?.extensionRpc.action("restoreDatabase", {});
                },
                openRestoreScript: function (): void {
                    webviewState?.extensionRpc.action("openRestoreScript", {});
                },
                setRestoreType: function (restoreType: RestoreType): void {
                    webviewState?.extensionRpc.action("setRestoreType", {
                        restoreType,
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
                loadAzureComponent(componentName: string): void {
                    webviewState?.extensionRpc.action("loadAzureComponent", {
                        componentName,
                    });
                },
            }}>
            {children}
        </RestoreDatabaseContext.Provider>
    );
};

export { RestoreDatabaseContext, RestoreDatabaseStateProvider };
