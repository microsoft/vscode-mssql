/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { NavigationProvider } from "../../common/navigation/navigationProvider";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { PerformanceDashboardPage } from "./performanceDashboardPage";
import { PerformanceDashboardRefreshProvider } from "./performanceDashboardRefresh";
import { performanceDashboardRouter } from "./performanceDashboardRoutes";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <NavigationProvider router={performanceDashboardRouter}>
            <PerformanceDashboardRefreshProvider>
                <PerformanceDashboardPage />
            </PerformanceDashboardRefreshProvider>
        </NavigationProvider>
    </VscodeWebviewProvider>,
);
