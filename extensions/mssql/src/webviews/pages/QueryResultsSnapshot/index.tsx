/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import ReactDOM from "react-dom/client";
import "../../index.css";
// The pinned pane reuses the Query Studio result components and their styles.
import "../QueryStudio/queryStudio.css";
import "../QueryStudio/vectorIndexView.css";
import "../QueryStudio/vectorPipelineView.css";
import "../QueryStudio/spatial/spatial.css";
import { useVscodeWebview, VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { PinnedResultsApp } from "./app";
import { QueryStudioErrorBoundary } from "../QueryStudio/queryStudioErrorBoundary";

function PinnedResultsRoot(): React.JSX.Element {
    const { extensionRpc: rpc } = useVscodeWebview();
    const reportRootError = React.useCallback(
        (label: string, error: Error, componentStack?: string) =>
            rpc.log.error(
                "Pinned results root render failure",
                label,
                `${error.name}: ${error.message}`.slice(0, 2_000),
                componentStack?.slice(0, 8_000),
            ),
        [rpc],
    );
    return (
        <QueryStudioErrorBoundary label="Pinned Results" resetKey="root" onError={reportRootError}>
            <PinnedResultsApp />
        </QueryStudioErrorBoundary>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <PinnedResultsRoot />
    </VscodeWebviewProvider>,
);
