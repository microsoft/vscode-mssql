/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import SqlProfilerPage from "./sqlProfiler";
import { SqlProfilerStateProvider } from "./sqlProfilerStateProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <SqlProfilerStateProvider>
            <SqlProfilerPage />
        </SqlProfilerStateProvider>
    </VscodeWebviewProvider>,
);
