/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import {
    ColumnFilter,
    SortColumn,
    TableEditorPasteCell,
    TableEditorReducers,
    TableEditorState,
} from "../../../sharedInterfaces/tableEditor";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";

export interface TableEditorContextProps {
    themeKind?: ColorThemeKind;
    extensionRpc: WebviewRpc<TableEditorReducers>;

    refresh: () => void;
    nextPage: () => void;
    previousPage: () => void;
    setPageSize: (pageSize: number) => void;
    setFilters: (filters: ColumnFilter[]) => void;
    setSort: (sort: SortColumn[]) => void;

    editCell: (rowId: number, column: string, value: string | null) => Promise<void>;
    setCellDefault: (rowId: number, column: string) => void;
    revertCell: (rowId: number, column: string) => void;
    addRow: () => void;
    insertUsingDefaults: (rowId: number) => void;
    deleteRow: (rowId: number) => void;
    revertRow: (rowId: number) => void;
    discardAll: () => void;
    undo: () => void;
    redo: () => void;
    applyPaste: (cells: TableEditorPasteCell[]) => void;

    save: () => Promise<void>;
    toggleScript: () => void;
    openCell: (rowId: number, column: string) => void;
    closeCell: () => void;
    countRows: () => void;
    reconcile: () => void;
    acceptReconciliation: () => void;
    keepServer: (rowId: number) => void;
    reapplyConflict: (rowId: number) => void;
}

export const TableEditorContext = createContext<TableEditorContextProps | undefined>(undefined);

export const TableEditorStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { extensionRpc, themeKind } = useVscodeWebview<TableEditorState, TableEditorReducers>();

    const value = useMemo<TableEditorContextProps>(
        () => ({
            themeKind,
            extensionRpc,
            refresh: () => extensionRpc.action("refresh", {}),
            nextPage: () => extensionRpc.action("nextPage", {}),
            previousPage: () => extensionRpc.action("previousPage", {}),
            setPageSize: (pageSize) => extensionRpc.action("setPageSize", { pageSize }),
            setFilters: (filters) => extensionRpc.action("setFilters", { filters }),
            setSort: (sort) => extensionRpc.action("setSort", { sort }),
            editCell: (rowId, column, value) =>
                extensionRpc.actionAndWait("editCell", { rowId, column, value }),
            setCellDefault: (rowId, column) =>
                extensionRpc.action("setCellDefault", { rowId, column }),
            revertCell: (rowId, column) => extensionRpc.action("revertCell", { rowId, column }),
            addRow: () => extensionRpc.action("addRow", {}),
            insertUsingDefaults: (rowId) => extensionRpc.action("insertUsingDefaults", { rowId }),
            deleteRow: (rowId) => extensionRpc.action("deleteRow", { rowId }),
            revertRow: (rowId) => extensionRpc.action("revertRow", { rowId }),
            discardAll: () => extensionRpc.action("discardAll", {}),
            undo: () => extensionRpc.action("undo", {}),
            redo: () => extensionRpc.action("redo", {}),
            applyPaste: (cells) => extensionRpc.action("applyPaste", { cells }),
            save: () => extensionRpc.actionAndWait("save", {}),
            toggleScript: () => extensionRpc.action("toggleScript", {}),
            openCell: (rowId, column) => extensionRpc.action("openCell", { rowId, column }),
            closeCell: () => extensionRpc.action("closeCell", {}),
            countRows: () => extensionRpc.action("countRows", {}),
            reconcile: () => extensionRpc.action("reconcile", {}),
            acceptReconciliation: () => extensionRpc.action("acceptReconciliation", {}),
            keepServer: (rowId) => extensionRpc.action("keepServer", { rowId }),
            reapplyConflict: (rowId) => extensionRpc.action("reapplyConflict", { rowId }),
        }),
        [extensionRpc, themeKind],
    );

    return <TableEditorContext.Provider value={value}>{children}</TableEditorContext.Provider>;
};
