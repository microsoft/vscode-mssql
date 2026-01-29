/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormContextProps, FormEvent } from "../../../../sharedInterfaces/form";
import { ReactNode, createContext } from "react";
import { ObjectManagementReactProvider } from "../objectManagementStateProvider";
import {
    ObjectManagementFormItemSpec,
    ObjectManagementFormState,
    ObjectManagementReducers,
    ObjectManagementWebviewState,
} from "../../../../sharedInterfaces/objectManagement";
import { useVscodeWebview2 } from "../../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../../common/utils";

export interface BackupDatabaseProvider
    extends ObjectManagementReactProvider,
        FormContextProps<
            ObjectManagementFormState,
            ObjectManagementWebviewState,
            ObjectManagementFormItemSpec
        > {
    formAction(event: FormEvent<ObjectManagementFormState>): void;
    backupDatabase(): void;
    openBackupScript(): void;
    setSaveLocation(saveToUrl: boolean): void;
    removeBackupFile(filePath: string): void;
    openFileBrowser(
        ownerUri: string,
        expandPath: string,
        fileFilters: string[],
        changeFilter: boolean,
        showFoldersOnly: boolean,
    ): void;
    expandNode(ownerUri: string, nodePath: string): void;
    submitFilePath(selectedPath: string): void;
    closeFileBrowser(ownerUri: string): void;
    toggleFileBrowserDialog(foldersOnly: boolean, shouldOpen: boolean): void;
    handleFileChange(index: number, newValue: string, isFolderChange: boolean): void;
    loadAzureComponent(componentName: string): void;
}

const BackupDatabaseContext = createContext<BackupDatabaseProvider | undefined>(undefined);

interface BackupDatabaseProviderProps {
    children: ReactNode;
}

const BackupDatabaseStateProvider: React.FC<BackupDatabaseProviderProps> = ({ children }) => {
    const { extensionRpc, getSnapshot, themeKind, keyBindings } = useVscodeWebview2<
        ObjectManagementWebviewState,
        ObjectManagementReducers
    >();

    return (
        <BackupDatabaseContext.Provider
            value={{
                extensionRpc,
                ...getCoreRPCs2(extensionRpc),
                state: getSnapshot(),
                themeKind,
                keyBindings,
                formAction(event) {
                    extensionRpc.action("formAction", {
                        event: event as FormEvent<ObjectManagementFormState>,
                    });
                },
                backupDatabase() {
                    extensionRpc.action("backupDatabase", {});
                },
                openBackupScript() {
                    extensionRpc.action("openBackupScript", {});
                },
                setSaveLocation(saveToUrl) {
                    extensionRpc.action("setSaveLocation", { saveToUrl });
                },
                removeBackupFile(filePath) {
                    extensionRpc.action("removeBackupFile", { filePath });
                },
                openFileBrowser(ownerUri, expandPath, fileFilters, changeFilter, showFoldersOnly) {
                    extensionRpc.action("openFileBrowser", {
                        ownerUri,
                        expandPath,
                        fileFilters,
                        changeFilter,
                        showFoldersOnly,
                    });
                },
                expandNode(ownerUri, nodePath) {
                    extensionRpc.action("expandNode", {
                        ownerUri,
                        nodePath,
                    });
                },
                submitFilePath(selectedPath) {
                    extensionRpc.action("submitFilePath", {
                        selectedPath,
                    });
                },
                closeFileBrowser(ownerUri) {
                    extensionRpc.action("closeFileBrowser", {
                        ownerUri,
                    });
                },
                toggleFileBrowserDialog(foldersOnly, shouldOpen) {
                    extensionRpc.action("toggleFileBrowserDialog", {
                        foldersOnly,
                        shouldOpen,
                    });
                },
                handleFileChange(index, newValue, isFolderChange) {
                    extensionRpc.action("handleFileChange", {
                        index,
                        newValue,
                        isFolderChange,
                    });
                },
                loadAzureComponent(componentName) {
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
