/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";

export const TableExplorerPage: React.FC = () => {
    const context = useTableExplorerContext();
    const state = context?.state;

    return (
        <div style={{ padding: "20px" }}>
            <TableExplorerToolbar />
            {state?.resultSet ? (
                <div>
                    <TableDataGrid
                        resultSet={state.resultSet}
                        themeKind={context?.themeKind}
                        onDeleteRow={context?.deleteRow}
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
