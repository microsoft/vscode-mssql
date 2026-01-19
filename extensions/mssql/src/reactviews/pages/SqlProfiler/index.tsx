/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { ProfilerStateProvider } from "./profilerStateProvider";
import { ProfilerPage } from "./profilerPage";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider2>
        <ProfilerStateProvider>
            <ProfilerPage />
        </ProfilerStateProvider>
    </VscodeWebviewProvider2>,
);
