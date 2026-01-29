/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRoot } from "react-dom/client";
import { ProfilerDetailsPanelPage } from "./profilerDetailsPanelPage";

const root = createRoot(document.getElementById("root")!);
root.render(<ProfilerDetailsPanelPage />);
