/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentProvider } from "@fluentui/react-components";
import { VscodeWebviewProvider2 } from "../../../common/vscodeWebviewProvider2";
import "../../../index.css";
import { createRoot } from "react-dom/client";
import { BackupDatabaseDialogPage } from "./backupDatabaseDialogPage";
import { BackupDatabaseStateProvider } from "./backupDatabaseStateProvider";

const App = () => {
    return (
        <VscodeWebviewProvider2>
            <BackupDatabaseStateProvider>
                <FluentProvider>
                    <BackupDatabaseDialogPage />;
                </FluentProvider>
            </BackupDatabaseStateProvider>
        </VscodeWebviewProvider2>
    );
};

createRoot(document.getElementById("root")!).render(<App />);
