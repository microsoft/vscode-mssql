/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";

export const TableExplorerPage: React.FC = () => {
    const context = useTableExplorerContext();
    const state = context?.state;
    const gridRef = useRef<TableDataGridRef>(null);

    const handleSaveComplete = () => {
        // Clear the change tracking in the grid after successful save
        gridRef.current?.clearAllChangeTracking();
    };

    return (
        <div style={{ padding: "20px" }}>
            <TableExplorerToolbar onSaveComplete={handleSaveComplete} />
            {state?.resultSet ? (
                <div>
                    <TableDataGrid
                        ref={gridRef}
                        resultSet={state.resultSet}
                        themeKind={context?.themeKind}
                        onDeleteRow={context?.deleteRow}
                        onUpdateCell={context?.updateCell}
                        onRevertCell={context?.revertCell}
                        onRevertRow={context?.revertRow}
                    />
                </div>
            ) : state?.isLoading ? (
                <p>Loading table data...</p>
            ) : (
                <p>No data available</p>
            )}
        </div>
    );
};
