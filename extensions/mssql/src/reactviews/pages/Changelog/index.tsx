/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";
import { ChangelogStateProvider } from "./changelogStateProvider";
import { ChangelogPage } from "./changelogPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider2>
        <ChangelogStateProvider>
            <ChangelogPage />
        </ChangelogStateProvider>
    </VscodeWebviewProvider2>,
);
