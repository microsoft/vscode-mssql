/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
// The pinned pane reuses the Query Studio result components and their styles.
import "../QueryStudio/queryStudio.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { PinnedResultsApp } from "./app";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <PinnedResultsApp />
    </VscodeWebviewProvider>,
);
