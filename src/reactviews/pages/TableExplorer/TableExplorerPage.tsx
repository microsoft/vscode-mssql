/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { useTableExplorerState } from "./TableExplorerStateProvider";

export const TableExplorerPage: React.FC = () => {
    const state = useTableExplorerState();

    return (
        <div style={{ padding: "20px" }}>
            <h1>Table Explorer</h1>
            {state?.tableName && (
                <div>
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
        </div>
    );
};
