/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// MUST be first: binds the bundled Monaco before any editor mounts.
import "./monacoSetup";
import * as React from "react";
import ReactDOM from "react-dom/client";
import "../../index.css";
import "./queryStudio.css";
// Lazy-pane CSS rides the ENTRY stylesheet (lazy-chunk CSS is never linked).
import "./vectorIndexView.css";
import "./vectorPipelineView.css";
import "./vectorSearchView.css";
import "./spatial/spatial.css";
import { perfMark } from "../../common/perfMarks";
import { useVscodeWebview, VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { QueryStudioApp } from "./app";
import { QueryStudioErrorBoundary } from "./queryStudioErrorBoundary";

// BOOT-1: entry module body reached — everything before this mark is
// webview HTML + static-chunk fetch/parse/eval (the modulepreload wave).
perfMark("mssql.queryStudio.boot.scriptStart", {});

function QueryStudioRoot(): React.JSX.Element {
    const { extensionRpc: rpc } = useVscodeWebview();
    const reportRootError = React.useCallback(
        (label: string, error: Error, componentStack?: string) =>
            rpc.log.error(
                "Query Studio root render failure",
                label,
                `${error.name}: ${error.message}`.slice(0, 2_000),
                componentStack?.slice(0, 8_000),
            ),
        [rpc],
    );
    return (
        <QueryStudioErrorBoundary label="Query Studio" resetKey="root" onError={reportRootError}>
            <QueryStudioApp />
        </QueryStudioErrorBoundary>
    );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
    <VscodeWebviewProvider>
        <QueryStudioRoot />
    </VscodeWebviewProvider>,
);
// A disposed VS Code webview can leave its renderer context awaiting a later
// Chromium collection. Tear down React-owned grids, subscriptions, and workers
// while the page is still alive. Two microtasks let component pagehide flushes
// run first; a bfcache page stays mounted for restoration.
window.addEventListener(
    "pagehide",
    (event) => {
        if (!event.persisted) {
            queueMicrotask(() => queueMicrotask(() => root.unmount()));
        }
    },
    { once: true },
);
perfMark("mssql.queryStudio.boot.reactMount", {});
