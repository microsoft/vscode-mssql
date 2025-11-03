/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";
import { useContext } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { QueryResultsTextView } from "./queryResultsTextView";
import { QueryResultsGridView } from "./queryResultsGridView";
import { useQueryResultSelector } from "./queryResultSelector";

export const QueryResultsTab = () => {
    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return;
    }
    const viewMode =
        useQueryResultSelector((state) => state.tabStates?.resultViewMode) ??
        qr.QueryResultViewMode.Grid;

    if (viewMode === qr.QueryResultViewMode.Text) {
        return <QueryResultsTextView />;
    }
    return <QueryResultsGridView />;
};
