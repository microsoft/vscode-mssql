/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { SqlDiagnosticsStateProvider } from "../SqlDiagnostics/sqlDiagnosticsStateProvider";
import SqlActivityPage from "./sqlActivity";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <SqlDiagnosticsStateProvider>
            <SqlActivityPage />
        </SqlDiagnosticsStateProvider>
    </VscodeWebviewProvider>,
);
