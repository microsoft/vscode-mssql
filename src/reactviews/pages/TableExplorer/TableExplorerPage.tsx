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
            <h1>Table Explorer</h1>
            {state?.tableName && (
                <div style={{ marginBottom: "20px" }}>
                    <p>
                        <strong>Table:</strong> {state.tableName}
                    </p>
                    <p>
                        <strong>Database:</strong> {state.databaseName}
                    </p>
                    <p>
                        <strong>Server:</strong> {state.serverName}
                    </p>
                </div>
            )}

            <TableExplorerToolbar />
            {state?.resultSet ? (
                <div>
                    <h2>Table Data</h2>
                    <TableDataGrid resultSet={state.resultSet} themeKind={context?.themeKind} />
                </div>
            ) : state?.isLoading ? (
                <p>Loading table data...</p>
            ) : (
                <p>No data available</p>
            )}
        </div>
    );
};
