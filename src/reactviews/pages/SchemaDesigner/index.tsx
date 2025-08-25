/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { SchemaDesignerStateProvider } from "./schemaDesignerStateProvider";
import { SchemaDesignerPage } from "./schemaDesignerPage";
import { ReactFlowProvider } from "@xyflow/react";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider2>
        <ReactFlowProvider>
            <SchemaDesignerStateProvider>
                <SchemaDesignerPage />
            </SchemaDesignerStateProvider>
        </ReactFlowProvider>
    </VscodeWebviewProvider2>,
);
