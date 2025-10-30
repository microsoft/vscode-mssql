/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";
import { TableExplorerScriptPane } from "./TableExplorerScriptPane";
import { makeStyles, shorthands } from "@fluentui/react-components";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerSelector } from "./tableExplorerSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        ...shorthands.overflow("hidden"),
    },
    contentArea: {
        ...shorthands.flex(1),
        display: "flex",
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
        padding: "20px",
    },
    dataGridContainer: {
        ...shorthands.flex(1),
        ...shorthands.overflow("auto"),
        minHeight: 0,
    },
});

export const TableExplorerPage: React.FC = () => {
    const classes = useStyles();
    const context = useTableExplorerContext();
    const { themeKind } = useVscodeWebview2();

    // Use selectors to access specific state properties
    const resultSet = useTableExplorerSelector((s) => s.resultSet);
    const isLoading = useTableExplorerSelector((s) => s.isLoading);
    const currentRowCount = useTableExplorerSelector((s) => s.currentRowCount);
    const failedCells = useTableExplorerSelector((s) => s.failedCells);

    const gridRef = useRef<TableDataGridRef>(null);
    const [cellChangeCount, setCellChangeCount] = React.useState(0);

    const handleSaveComplete = () => {
        // Clear the change tracking in the grid after successful save
        gridRef.current?.clearAllChangeTracking();
    };

    const handleCellChangeCountChanged = (count: number) => {
        setCellChangeCount(count);
    };

    return (
        <div className={classes.root}>
            <div className={classes.contentArea}>
                <TableExplorerToolbar
                    onSaveComplete={handleSaveComplete}
                    cellChangeCount={cellChangeCount}
                />
                {resultSet ? (
                    <div className={classes.dataGridContainer}>
                        <TableDataGrid
                            ref={gridRef}
                            resultSet={resultSet}
                            themeKind={themeKind}
                            pageSize={10}
                            currentRowCount={currentRowCount}
                            failedCells={failedCells}
                            onDeleteRow={context?.deleteRow}
                            onUpdateCell={context?.updateCell}
                            onRevertCell={context?.revertCell}
                            onRevertRow={context?.revertRow}
                            onLoadSubset={context?.loadSubset}
                            onCellChangeCountChanged={handleCellChangeCountChanged}
                        />
                    </div>
                ) : isLoading ? (
                    <p>{loc.tableExplorer.loadingTableData}</p>
                ) : (
                    <p>{loc.tableExplorer.noDataAvailable}</p>
                )}
            </div>
            <TableExplorerScriptPane />
        </div>
    );
};
