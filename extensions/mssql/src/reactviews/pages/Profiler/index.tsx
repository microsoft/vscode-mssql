/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";
import { ProfilerStateProvider } from "./profilerStateProvider";
import { Profiler } from "./profiler";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider2>
        <ProfilerStateProvider>
            <Profiler />
        </ProfilerStateProvider>
    </VscodeWebviewProvider2>,
);
