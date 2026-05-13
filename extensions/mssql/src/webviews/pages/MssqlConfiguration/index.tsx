/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { MssqlConfigurationStateProvider } from "./mssqlConfigurationStateProvider";
import { MssqlConfigurationPage } from "./mssqlConfigurationPage";
import "../../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <MssqlConfigurationStateProvider>
            <MssqlConfigurationPage />
        </MssqlConfigurationStateProvider>
    </VscodeWebviewProvider>,
);
