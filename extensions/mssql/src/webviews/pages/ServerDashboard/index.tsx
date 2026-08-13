/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRoot } from "react-dom/client";
import "../../index.css";
import "./serverDashboard.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { DashboardPage } from "./dashboardPage";
import {
    ServerDashboardReducers,
    ServerDashboardWebviewState,
} from "../../../sharedInterfaces/serverDashboard";

createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider<ServerDashboardWebviewState, ServerDashboardReducers>>
        <DashboardPage />
    </VscodeWebviewProvider>,
);
