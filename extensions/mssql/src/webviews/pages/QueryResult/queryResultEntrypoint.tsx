/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComponentType, lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { KeyCode } from "../../common/keys";
import { eventMatchesKey } from "../../common/keyboardUtils";
import { isMetaOrCtrlKeyPressed } from "../../common/utils";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { QueryResult } from "./queryResultPage";
import { QueryResultStateProvider } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";

const MultiResultsPage = lazy(async () => {
    const module = await import("./multiResults/multiResultsPage");
    return { default: module.MultiResultsPage };
});

interface QueryResultRootProps {
    GridView: ComponentType;
    isBetaResultsGridEnabled: boolean;
}

/**
 * Shows every result in the multi-results layout when the extension sends one, and otherwise
 * the result of the active editor.
 */
const QueryResultRoot = ({ GridView, isBetaResultsGridEnabled }: QueryResultRootProps) => {
    const isMultiResults = useQueryResultSelector((state) => state.multiResults !== undefined);

    // This is needed to stop the browser from selecting all the raw text in the webview when ctrl+a is pressed
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent): void => {
            if (isMetaOrCtrlKeyPressed(e) && eventMatchesKey(e, { key: "a", code: KeyCode.KeyA })) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return function cleanup() {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    if (isMultiResults) {
        return (
            <Suspense fallback={undefined}>
                <MultiResultsPage
                    GridView={GridView}
                    isBetaResultsGridEnabled={isBetaResultsGridEnabled}
                />
            </Suspense>
        );
    }
    return (
        <QueryResultStateProvider>
            <QueryResult GridView={GridView} isBetaResultsGridEnabled={isBetaResultsGridEnabled} />
        </QueryResultStateProvider>
    );
};

export function renderQueryResult(
    GridView: ComponentType,
    isBetaResultsGridEnabled: boolean,
): void {
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <VscodeWebviewProvider>
            <QueryResultRoot
                GridView={GridView}
                isBetaResultsGridEnabled={isBetaResultsGridEnabled}
            />
        </VscodeWebviewProvider>,
    );
}
