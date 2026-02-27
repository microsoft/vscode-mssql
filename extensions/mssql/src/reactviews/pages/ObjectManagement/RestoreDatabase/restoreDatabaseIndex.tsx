/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "../../../index.css";
import { createRoot } from "react-dom/client";
import { RestoreDatabaseStateProvider } from "./restoreDatabaseStateProvider";
import { VscodeWebviewProvider } from "../../../common/vscodeWebviewProvider";
import { RestoreDatabaseDialogPage } from "./restoreDatabaseDialogPage";

const App = () => {
    return (
        <VscodeWebviewProvider>
            <RestoreDatabaseStateProvider>
                <RestoreDatabaseDialogPage />
            </RestoreDatabaseStateProvider>
        </VscodeWebviewProvider>
    );
};

createRoot(document.getElementById("root")!).render(<App />);
