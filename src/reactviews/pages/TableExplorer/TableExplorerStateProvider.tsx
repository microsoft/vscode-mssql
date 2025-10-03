/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext } from "react";
import {
    TableExplorerWebViewState,
    TableExplorerReducers,
    TableExplorerContextProps,
} from "../../../sharedInterfaces/tableExplorer";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const TableExplorerContext = createContext<TableExplorerContextProps>(
    {} as TableExplorerContextProps,
);

export const TableExplorerStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const webViewState = useVscodeWebview<TableExplorerWebViewState, TableExplorerReducers>();
    const tableExplorerState = webViewState?.state;

    return (
        <TableExplorerContext.Provider
            value={{
                state: tableExplorerState,
                themeKind: webViewState?.themeKind,

                commitChanges: function (): void {
                    webViewState?.extensionRpc.action("commitChanges", {});
                },

                loadSubset: function (rowCount: number): void {
                    webViewState?.extensionRpc.action("loadSubset", { rowCount });
                },

                createRow: function (): void {
                    webViewState?.extensionRpc.action("createRow", {});
                },

                deleteRow: function (rowId: number): void {
                    webViewState?.extensionRpc.action("deleteRow", { rowId });
                },

                updateCell: function (rowId: number, columnId: number, newValue: string): void {
                    webViewState?.extensionRpc.action("updateCell", { rowId, columnId, newValue });
                },
            }}>
            {children}
        </TableExplorerContext.Provider>
    );
};

export const useTableExplorerContext = (): TableExplorerContextProps => {
    const context = useContext(TableExplorerContext);
    return context;
};
