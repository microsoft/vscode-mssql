/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { SchemaDesignerStateProvider } from "./schemaDesignerStateProvider";
import { SchemaDesignerPage } from "./schemaDesignerPage";
import { ReactFlowProvider } from "@xyflow/react";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <VscodeWebviewProvider>
    <ReactFlowProvider>
      <SchemaDesignerStateProvider>
        <SchemaDesignerPage />
      </SchemaDesignerStateProvider>
    </ReactFlowProvider>
  </VscodeWebviewProvider>,
);
