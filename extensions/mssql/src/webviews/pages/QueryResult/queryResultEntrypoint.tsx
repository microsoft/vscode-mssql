/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { QueryResult } from "./queryResultPage";
import { QueryResultStateProvider } from "./queryResultStateProvider";

export function renderQueryResult(
    GridView: ComponentType,
    isBetaResultsGridEnabled: boolean,
): void {
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <VscodeWebviewProvider>
            <QueryResultStateProvider>
                <QueryResult
                    GridView={GridView}
                    isBetaResultsGridEnabled={isBetaResultsGridEnabled}
                />
            </QueryResultStateProvider>
        </VscodeWebviewProvider>,
    );
}
