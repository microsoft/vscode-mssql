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
    const state = context?.state;
    const gridRef = useRef<TableDataGridRef>(null);

    const handleSaveComplete = () => {
        // Clear the change tracking in the grid after successful save
        gridRef.current?.clearAllChangeTracking();
    };

    return (
        <div className={classes.root}>
            <div className={classes.contentArea}>
                <TableExplorerToolbar onSaveComplete={handleSaveComplete} />
                {state?.resultSet ? (
                    <div className={classes.dataGridContainer}>
                        <TableDataGrid
                            ref={gridRef}
                            resultSet={state.resultSet}
                            themeKind={context?.themeKind}
                            pageSize={10}
                            currentRowCount={state.currentRowCount}
                            onDeleteRow={context?.deleteRow}
                            onUpdateCell={context?.updateCell}
                            onRevertCell={context?.revertCell}
                            onRevertRow={context?.revertRow}
                            onLoadSubset={context?.loadSubset}
                        />
                    </div>
                ) : state?.isLoading ? (
                    <p>Loading table data...</p>
                ) : (
                    <p>No data available</p>
                )}
            </div>
            <TableExplorerScriptPane />
        </div>
    );
};
