/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import "./runbookStudio.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { RbsProvider } from "./state";
import { RunbookStudioApp } from "./shell";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <RbsProvider>
            <RunbookStudioApp />
        </RbsProvider>
    </VscodeWebviewProvider>,
);
