/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// MUST be first: binds the bundled Monaco before any editor mounts.
import "./monacoSetup";
import ReactDOM from "react-dom/client";
import "../../index.css";
import "./queryStudio.css";
import { perfMark } from "../../common/perfMarks";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { QueryStudioApp } from "./app";

// BOOT-1: entry module body reached — everything before this mark is
// webview HTML + static-chunk fetch/parse/eval (the modulepreload wave).
perfMark("mssql.queryStudio.boot.scriptStart", {});

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <QueryStudioApp />
    </VscodeWebviewProvider>,
);
perfMark("mssql.queryStudio.boot.reactMount", {});
