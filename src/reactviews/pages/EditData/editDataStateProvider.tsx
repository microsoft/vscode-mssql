/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ed from "../../../sharedInterfaces/editData";

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const editDataContext = createContext<ed.EditDataContextProps>(
    {} as ed.EditDataContextProps,
);

interface EditDataStateProviderProps {
    children: React.ReactNode;
}

const EditDataStateProvider: React.FC<EditDataStateProviderProps> = ({
    children,
}) => {
    const webViewState = useVscodeWebview<
        ed.EditDataWebViewState,
        ed.EditDataReducers
    >();
    const editDataState = webViewState?.state;

    return (
        <editDataContext.Provider
            value={{
                state: editDataState,
                themeKind: webViewState?.themeKind,
                createRow: function (ownerUri: string): void {
                    webViewState?.extensionRpc.action("createRow", {
                        ownerUri: ownerUri,
                    });
                },
                deleteRow: function (ownerUri: string, rowId: number): void {
                    webViewState?.extensionRpc.action("deleteRow", {
                        ownerUri: ownerUri,
                        rowId: rowId,
                    });
                },
                dispose: function (ownerUri: string): void {
                    webViewState?.extensionRpc.action("dispose", {
                        ownerUri: ownerUri,
                    });
                },
                revertCell: function (
                    ownerUri: string,
                    rowId: number,
                    columnId: number,
                ): void {
                    webViewState?.extensionRpc.action("revertCell", {
                        ownerUri: ownerUri,
                        rowId: rowId,
                        columnId: columnId,
                    });
                },
                revertRow: function (ownerUri: string, rowId: number): void {
                    webViewState?.extensionRpc.action("revertRow", {
                        ownerUri: ownerUri,
                        rowId: rowId,
                    });
                },
                subset: function (
                    ownerUri: string,
                    rowStartIndex: number,
                    rowCount: number,
                ): void {
                    webViewState?.extensionRpc.action("subset", {
                        ownerUri: ownerUri,
                        rowStartIndex: rowStartIndex,
                        rowCount: rowCount,
                    });
                },
                updateCell: function (
                    ownerUri: string,
                    rowId: number,
                    columnId: number,
                    newValue: string,
                ): void {
                    webViewState?.extensionRpc.action("updateCell", {
                        ownerUri: ownerUri,
                        rowId: rowId,
                        columnId: columnId,
                        newValue: newValue,
                    });
                },
                commit: function (ownerUri: string): void {
                    webViewState?.extensionRpc.action("commit", {
                        ownerUri: ownerUri,
                    });
                },
            }}
        >
            {children}
        </editDataContext.Provider>
    );
};

export { EditDataStateProvider };
