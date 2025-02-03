/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    TableDesignerReducers,
    TableDesignerWebviewState,
} from "../sharedInterfaces/tableDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";

export class TableExplorerWebviewController extends ReactWebviewPanelController<
    TableDesignerWebviewState,
    TableDesignerReducers
> {
    constructor(
        private context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
    ) {
        super(
            context,
            vscodeWrapper,
            "tableExplorer",
            "tableExplorer",
            {},
            {
                title: "Table Explorer",
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: true,
            },
        );
    }

    // 	private initialize() {

    // }
}
