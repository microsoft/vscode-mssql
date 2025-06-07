/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { ConnectionGroupStateProvider } from "./connectionGroupStateProvider";
import { ConnectionGroupPage } from "./connectionGroupPage";
import "../../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <ConnectionGroupStateProvider>
            <ConnectionGroupPage />
        </ConnectionGroupStateProvider>
    </VscodeWebviewProvider>,
);
