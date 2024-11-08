/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
// import * as Constants from "../constants/constants";
import { randomUUID } from "crypto";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { QueryResultWebviewController } from "./queryResultWebViewController";
import { registerCommonRequestHandlers } from "./utils";

export class QueryResultWebviewPanelController extends ReactWebviewPanelController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _correlationId: string = randomUUID();

    constructor(
        context: vscode.ExtensionContext,
        private _vscodeWrapper: VscodeWrapper,
        private _viewColumn: vscode.ViewColumn,
        private _uri: string,
        title: string,
        private _queryResultWebviewViewController: QueryResultWebviewController,
    ) {
        super(
            context,
            "queryResult",
            {
                resultSetSummaries: {},
                messages: [],
                tabStates: {
                    resultPaneTab: qr.QueryResultPaneTabs.Messages,
                },
                executionPlanState: {},
            },
            {
                title: vscode.l10n.t({
                    message: "{0} (Preview)",
                    args: [title],
                    comment: "{0} is the editor title",
                }),
                viewColumn: _viewColumn,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "revealQueryResult.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "revealQueryResult.svg",
                    ),
                },
            },
        );

        void this.initialize();
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerRequestHandler("getWebviewLocation", async () => {
            return qr.QueryResultWebviewLocation.Document;
        });
        registerCommonRequestHandlers(this, this._correlationId);
    }

    public override dispose(): void {
        super.dispose();
        this._queryResultWebviewViewController.removePanel(this._uri);
    }

    public revealToForeground() {
        this.panel.reveal(this._viewColumn);
    }

    public getQueryResultWebviewViewController(): QueryResultWebviewController {
        return this._queryResultWebviewViewController;
    }
}
