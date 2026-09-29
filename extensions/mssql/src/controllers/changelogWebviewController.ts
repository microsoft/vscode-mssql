/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Changelog } from "../constants/locConstants";
import {
    ChangelogLinkRequest,
    ChangelogLinkRequestParams,
    ChangelogWebviewState,
    RunChangelogActionRequest,
} from "../sharedInterfaces/changelog";
import { WebviewPanelController } from "./webviewPanelController";
import * as vscode from "vscode";
import { changelogConfig } from "../configurations/changelog";
import { resolveChangelogAction } from "../configurations/changelogActions";
import { sendActionEvent } from "extension-toolkit/vscode";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

export class ChangelogWebviewController extends WebviewPanelController<
    ChangelogWebviewState,
    void,
    void
> {
    constructor(
        context: vscode.ExtensionContext,
        initialState: ChangelogWebviewState = changelogConfig,
    ) {
        super(context, "changelog", "changelog", initialState, {
            title: Changelog.ChangelogDocumentTitle,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "changelog_dark.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "changelog_light.svg"),
            },
        });

        this.initialize();
    }

    private initialize() {
        this.onRequest(ChangelogLinkRequest.type, async (params: ChangelogLinkRequestParams) => {
            const uri = vscode.Uri.parse(params.url);
            await vscode.env.openExternal(uri);
            sendActionEvent(TelemetryViews.ChangelogPage, TelemetryActions.OpenLink, {
                additionalProps: {
                    url: params.url,
                },
            });
        });

        this.onRequest(RunChangelogActionRequest.type, async (action) => {
            const { command, args } = resolveChangelogAction(action);
            await vscode.commands.executeCommand(command, ...args);
            sendActionEvent(TelemetryViews.ChangelogPage, TelemetryActions.ExecuteCommand, {
                additionalProps: {
                    command,
                },
            });
        });
    }
}
