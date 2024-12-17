/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    EditDataReducers,
    EditDataWebViewState,
} from "../sharedInterfaces/editData";

export class EditDataWebViewController extends ReactWebviewPanelController<
    EditDataWebViewState,
    EditDataReducers
> {
    constructor(context: vscode.ExtensionContext, data?: EditDataWebViewState) {
        super(context, "editData", data ?? {}, {
            title: vscode.l10n.t("Edit Data (Preview)"),
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "tableDesignerEditor_dark.svg", // lewissanchez TODO - update icon for edit data
                ),
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "tableDesignerEditor_light.svg", // lewissanchez TODO - update icon for edit data
                ),
            },
        });
    }
}
