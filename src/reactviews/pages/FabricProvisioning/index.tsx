/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { FabricProvisioningStateProvider } from "./fabricProvisioningStateProvider";
import { FabricProvisioningStartPage } from "./fabricProvisioningStartPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <FabricProvisioningStateProvider>
            <FabricProvisioningStartPage />
        </FabricProvisioningStateProvider>
    </VscodeWebviewProvider>,
);
