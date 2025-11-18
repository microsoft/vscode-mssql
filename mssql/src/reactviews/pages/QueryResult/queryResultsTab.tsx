/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";
import { useContext, useEffect } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { QueryResultsTextView } from "./queryResultsTextView";
import { QueryResultsGridView } from "./queryResultsGridView";
import { useQueryResultSelector } from "./queryResultSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { eventMatchesShortcut } from "../../common/keyboardUtils";
import { WebviewAction } from "../../../sharedInterfaces/webview";

export const QueryResultsTab = () => {
    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return;
    }
    const { keyBindings } = useVscodeWebview2();
    const viewMode =
        useQueryResultSelector((state) => state.tabStates?.resultViewMode) ??
        qr.QueryResultViewMode.Grid;

    const tabStates = useQueryResultSelector((state) => state.tabStates);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const isResultsTab = tabStates?.resultPaneTab === qr.QueryResultPaneTabs.Results;
            let handled = false;
            if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultSwitchToTextView]?.keyCombination,
                )
            ) {
                if (isResultsTab) {
                    const newMode =
                        viewMode === qr.QueryResultViewMode.Grid
                            ? qr.QueryResultViewMode.Text
                            : qr.QueryResultViewMode.Grid;
                    context.setResultViewMode(newMode);
                    handled = true;
                }
            }
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        document.addEventListener("keydown", handler, true);
        return () => {
            document.removeEventListener("keydown", handler, true);
        };
    }, [tabStates?.resultPaneTab, context, keyBindings, viewMode]);

    if (viewMode === qr.QueryResultViewMode.Text) {
        return <QueryResultsTextView />;
    }
    return <QueryResultsGridView />;
};
