/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";
import { makeStyles, Spinner } from "@fluentui/react-components";
import { type ComponentType, lazy, Suspense, useContext, useEffect } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { eventMatchesShortcut } from "../../common/keyboardUtils";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    loadingContainer: {
        alignItems: "center",
        backgroundColor: "var(--vscode-editor-background)",
        boxSizing: "border-box",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        minHeight: "120px",
        padding: "20px",
        width: "100%",
    },
});

const QueryResultsLoading = () => {
    const classes = useStyles();

    return (
        <div className={classes.loadingContainer} role="status">
            <Spinner
                label={locConstants.queryResult.loadingTextView}
                labelPosition="below"
                size="large"
            />
        </div>
    );
};

const QueryResultsTextView = lazy(async () => {
    const module = await import("./queryResultsTextView");
    return { default: module.QueryResultsTextView };
});

interface QueryResultsTabProps {
    GridView: ComponentType;
}

export const QueryResultsTab = ({ GridView }: QueryResultsTabProps) => {
    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return;
    }
    const { keyBindings } = useVscodeWebview();
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
        return (
            <Suspense fallback={<QueryResultsLoading />}>
                <QueryResultsTextView />
            </Suspense>
        );
    }
    return <GridView />;
};
