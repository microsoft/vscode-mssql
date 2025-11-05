/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext, useMemo } from "react";
import {
    TableExplorerWebViewState,
    TableExplorerReducers,
    TableExplorerContextProps,
} from "../../../sharedInterfaces/tableExplorer";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

const TableExplorerContext = createContext<TableExplorerContextProps>(
    {} as TableExplorerContextProps,
);

export const TableExplorerStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<TableExplorerWebViewState, TableExplorerReducers>();

    const commands = useMemo<TableExplorerContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            commitChanges: function (): void {
                extensionRpc.action("commitChanges", {});
            },

            loadSubset: function (rowCount: number): void {
                extensionRpc.action("loadSubset", { rowCount });
            },

            createRow: function (): void {
                extensionRpc.action("createRow", {});
            },

            deleteRow: function (rowId: number): void {
                extensionRpc.action("deleteRow", { rowId });
            },

            updateCell: function (rowId: number, columnId: number, newValue: string): void {
                extensionRpc.action("updateCell", { rowId, columnId, newValue });
            },

            revertCell: function (rowId: number, columnId: number): void {
                extensionRpc.action("revertCell", { rowId, columnId });
            },

            revertRow: function (rowId: number): void {
                extensionRpc.action("revertRow", { rowId });
            },

            generateScript: function (): void {
                extensionRpc.action("generateScript", {});
            },

            openScriptInEditor: function (): void {
                extensionRpc.action("openScriptInEditor", {});
            },

            copyScriptToClipboard: function (): void {
                extensionRpc.action("copyScriptToClipboard", {});
            },

            toggleScriptPane: function (): void {
                extensionRpc.action("toggleScriptPane", {});
            },

            setCurrentPage: function (pageNumber: number): void {
                extensionRpc.action("setCurrentPage", { pageNumber });
            },
        }),
        [extensionRpc],
    );

    return (
        <TableExplorerContext.Provider value={commands}>{children}</TableExplorerContext.Provider>
    );
};

export const useTableExplorerContext = (): TableExplorerContextProps => {
    const context = useContext(TableExplorerContext);
    return context;
};
