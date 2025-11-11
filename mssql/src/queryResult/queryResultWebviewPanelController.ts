/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
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
        vscodeWrapper: VscodeWrapper,
        private _viewColumn: vscode.ViewColumn,
        private _uri: string,
        title: string,
        private _queryResultWebviewViewController: QueryResultWebviewController,
    ) {
        super(
            context,
            vscodeWrapper,
            "queryResult",
            "queryResult",
            {
                resultSetSummaries: {},
                messages: [],
                tabStates: {
                    resultPaneTab: qr.QueryResultPaneTabs.Messages,
                },
                executionPlanState: {},
                fontSettings: {},
            },
            {
                title: title,
                viewColumn: _viewColumn,
                preserveFocus: true,
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
    }

    private async initialize() {
        this.registerRpcHandlers();
        this.panel.onDidChangeViewState((params) => {
            /**
             * Update the view column if it has changed so that we can reveal
             * the panel in the correct column later if needed.
             */
            if (params.webviewPanel.viewColumn) {
                this._viewColumn = params.webviewPanel.viewColumn;
            }
        });
    }

    private registerRpcHandlers() {
        this.onRequest(qr.GetWebviewLocationRequest.type, async () => {
            return qr.QueryResultWebviewLocation.Document;
        });
        registerCommonRequestHandlers(this, this._correlationId);
    }

    public override dispose(): void {
        super.dispose();
        void this._queryResultWebviewViewController.removePanel(this._uri);
    }

    public revealToForeground() {
        this.panel.reveal(this._viewColumn, true);
    }

    public getQueryResultWebviewViewController(): QueryResultWebviewController {
        return this._queryResultWebviewViewController;
    }

    public get viewColumn(): vscode.ViewColumn {
        return this._viewColumn;
    }
}
