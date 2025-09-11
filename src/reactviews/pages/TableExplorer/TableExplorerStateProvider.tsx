/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext } from "react";
import {
    TableExplorerWebViewState,
    TableExplorerReducers,
} from "../../../sharedInterfaces/tableExplorer";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const TableExplorerContext = createContext<TableExplorerWebViewState>(
    {} as TableExplorerWebViewState,
);

export const TableExplorerStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const webViewState = useVscodeWebview<TableExplorerWebViewState, TableExplorerReducers>();
    const tableExplorerState = webViewState?.state;

    return (
        <TableExplorerContext.Provider value={tableExplorerState}>
            {children}
        </TableExplorerContext.Provider>
    );
};

export const useTableExplorerState = (): TableExplorerWebViewState | undefined => {
    const context = useContext(TableExplorerContext);
    return context;
};
