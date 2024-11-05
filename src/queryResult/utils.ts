/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VscodeWrapper from "../controllers/vscodeWrapper";
import * as Constants from "../constants/constants";
import * as vscode from "vscode";

export function getNewResultPaneViewColumn(
    uri: string,
    vscodeWrapper: VscodeWrapper,
): vscode.ViewColumn {
    // // Find configuration options
    let config = vscodeWrapper.getConfiguration(
        Constants.extensionConfigSectionName,
        uri,
    );
    let splitPaneSelection = config[Constants.configSplitPaneSelection];
    let viewColumn: vscode.ViewColumn;

    switch (splitPaneSelection) {
        case "current":
            viewColumn = vscodeWrapper.activeTextEditor.viewColumn;
            break;
        case "end":
            viewColumn = vscode.ViewColumn.Three;
            break;
        // default case where splitPaneSelection is next or anything else
        default:
            // if there's an active text editor
            if (vscodeWrapper.isEditingSqlFile) {
                viewColumn = vscodeWrapper.activeTextEditor.viewColumn;
                if (viewColumn === vscode.ViewColumn.One) {
                    viewColumn = vscode.ViewColumn.Two;
                } else {
                    viewColumn = vscode.ViewColumn.Three;
                }
            } else {
                // otherwise take default results column
                viewColumn = vscode.ViewColumn.Two;
            }
    }
    return viewColumn;
}
