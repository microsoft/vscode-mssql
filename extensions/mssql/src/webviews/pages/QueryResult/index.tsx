/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./queryResultEagerStyles";
import { lazy, Suspense, useEffect } from "react";
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

/**
 * Shows every result in the multi-results layout when the extension sends one, and otherwise
 * the result of the active editor.
 */
const QueryResultRoot = () => {
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
                <MultiResultsPage />
            </Suspense>
        );
    }
    return (
        <QueryResultStateProvider>
            <QueryResult />
        </QueryResultStateProvider>
    );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <QueryResultRoot />
    </VscodeWebviewProvider>,
);
