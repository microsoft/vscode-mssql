/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Changelog } from "../constants/locConstants";
import { ChangelogWebviewState } from "../sharedInterfaces/changelog";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";

export class ChangelogWebviewController extends ReactWebviewPanelController<
    ChangelogWebviewState,
    void,
    void
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        intialState?: ChangelogWebviewState,
    ) {
        super(context, vscodeWrapper, "changelog", "changelog", intialState, {
            title: Changelog.ChangelogDocumentTitle,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "changelog_dark.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "changelog_light.svg"),
            },
        });
    }
}
