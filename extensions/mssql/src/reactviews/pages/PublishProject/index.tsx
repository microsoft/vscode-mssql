/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";
import PublishProjectPage from "./publishProject";
import { PublishProjectStateProvider } from "./publishProjectStateProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <VscodeWebviewProvider2>
    <PublishProjectStateProvider>
      <PublishProjectPage />
    </PublishProjectStateProvider>
  </VscodeWebviewProvider2>,
);
