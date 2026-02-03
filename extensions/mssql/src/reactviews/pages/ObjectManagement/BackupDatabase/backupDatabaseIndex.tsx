/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "../../../index.css";
import { createRoot } from "react-dom/client";
import { BackupDatabaseDialogPage } from "./backupDatabaseDialogPage";
import { BackupDatabaseStateProvider } from "./backupDatabaseStateProvider";
import { VscodeWebviewProvider } from "../../../common/vscodeWebviewProvider";

const App = () => {
    return (
        <VscodeWebviewProvider>
            <BackupDatabaseStateProvider>
                <BackupDatabaseDialogPage />
            </BackupDatabaseStateProvider>
        </VscodeWebviewProvider>
    );
};

createRoot(document.getElementById("root")!).render(<App />);
