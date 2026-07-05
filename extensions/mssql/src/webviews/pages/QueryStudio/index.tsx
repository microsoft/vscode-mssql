/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// MUST be first: binds the bundled Monaco before any editor mounts.
import "./monacoSetup";
import ReactDOM from "react-dom/client";
import "../../index.css";
import "./queryStudio.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { QueryStudioApp } from "./app";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <QueryStudioApp />
    </VscodeWebviewProvider>,
);
