/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext, useMemo } from "react";
import {
    TableExplorerWebViewState,
    TableExplorerReducers,
    TableExplorerContextProps,
    ExportData,
} from "../../../sharedInterfaces/tableExplorer";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";

const TableExplorerContext = createContext<TableExplorerContextProps>(
    {} as TableExplorerContextProps,
);

export const TableExplorerStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<TableExplorerWebViewState, TableExplorerReducers>();

    const commands = useMemo<TableExplorerContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            commitChanges: async function (): Promise<void> {
                await extensionRpc.actionAndWait("commitChanges", {});
            },

            loadSubset: async function (rowCount: number): Promise<void> {
                await extensionRpc.actionAndWait("loadSubset", { rowCount });
            },

            createRow: function (): void {
                extensionRpc.action("createRow", {});
            },

            deleteRow: async function (rowId: number): Promise<void> {
                await extensionRpc.actionAndWait("deleteRow", { rowId });
            },

            updateCell: async function (
                rowId: number,
                columnId: number,
                newValue: string,
            ): Promise<void> {
                await extensionRpc.actionAndWait("updateCell", { rowId, columnId, newValue });
            },

            revertCell: async function (rowId: number, columnId: number): Promise<void> {
                await extensionRpc.actionAndWait("revertCell", { rowId, columnId });
            },

            revertRow: async function (rowId: number): Promise<void> {
                await extensionRpc.actionAndWait("revertRow", { rowId });
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

            saveResults: function (format: "csv" | "json" | "excel", data: ExportData): void {
                extensionRpc.action("saveResults", { format, data });
            },

            showTableQuery: function (): void {
                extensionRpc.action("showTableQuery", {});
            },

            runTableQuery: async function (
                queryString: string,
                rowCount?: number,
                filterOperators?: string[],
            ): Promise<void> {
                await extensionRpc.actionAndWait("runTableQuery", {
                    queryString,
                    rowCount,
                    filterOperators,
                });
            },

            modifyTable: function (): void {
                extensionRpc.action("modifyTable", {});
            },

            viewTableDiagram: function (): void {
                extensionRpc.action("viewTableDiagram", {});
            },

            showSql: function (sqlScript: string): void {
                extensionRpc.action("showSql", { sqlScript });
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
