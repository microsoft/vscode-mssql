/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { BackupDatabaseStateProvider } from "./backupDatabaseStateProvider";
import { BackupDatabasePage } from "./backupDatabasePage";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <BackupDatabaseStateProvider>
            <BackupDatabasePage />
        </BackupDatabaseStateProvider>
    </VscodeWebviewProvider>,
);
