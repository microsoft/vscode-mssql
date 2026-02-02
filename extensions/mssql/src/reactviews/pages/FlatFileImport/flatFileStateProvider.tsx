/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import {
    FlatFileImportReducers,
    FlatFileImportState,
    FlatFileImportProvider,
    FlatFileImportFormState,
} from "../../../sharedInterfaces/flatFileImport";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { FormEvent } from "../../../sharedInterfaces/form";
import { ChangeColumnSettingsParams } from "../../../models/contracts/flatFile";

export const FlatFileContext = createContext<FlatFileImportProvider | undefined>(undefined);

export const FlatFileImportStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const webviewContext = useVscodeWebview<FlatFileImportState, FlatFileImportReducers>();
    const state = webviewContext?.state;

    return (
        <FlatFileContext.Provider
            value={{
                state: state,
                themeKind: webviewContext?.themeKind,
                keyBindings: webviewContext?.keyBindings,
                ...getCoreRPCs(webviewContext),
                formAction: function (event: FormEvent<FlatFileImportFormState>): void {
                    webviewContext?.extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                getTablePreview: function (
                    filePath: string,
                    tableName: string,
                    schemaName?: string,
                    fileType?: string,
                ): void {
                    webviewContext?.extensionRpc.action("getTablePreview", {
                        filePath: filePath,
                        tableName: tableName,
                        schemaName: schemaName,
                        fileType: fileType,
                    });
                },
                getColumnInfo: function (): void {
                    webviewContext?.extensionRpc.action("getColumnInfo", {});
                },
                setColumnChanges: function (columnChanges: ChangeColumnSettingsParams[]): void {
                    webviewContext?.extensionRpc.action("setColumnChanges", {
                        columnChanges: columnChanges,
                    });
                },
                changeColumnSettings: function (
                    index: number,
                    newName?: string,
                    newDataType?: string,
                    newNullable?: boolean,
                    newIsPrimaryKey?: boolean,
                ): void {
                    webviewContext?.extensionRpc.action("changeColumnSettings", {
                        index: index,
                        newName: newName,
                        newDataType: newDataType,
                        newNullable: newNullable,
                        newIsPrimaryKey: newIsPrimaryKey,
                    });
                },
                importData: function (): void {
                    webviewContext?.extensionRpc.action("importData", {});
                },
                openVSCodeFileBrowser: function (): void {
                    webviewContext?.extensionRpc.action("openVSCodeFileBrowser", {});
                },
                dispose: function (): void {
                    webviewContext?.extensionRpc.action("dispose", {});
                },
            }}>
            {children}
        </FlatFileContext.Provider>
    );
};
