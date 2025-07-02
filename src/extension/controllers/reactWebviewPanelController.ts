/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as locConstants from "../constants/locConstants";
import * as vscode from "vscode";

import { TelemetryActions, TelemetryViews } from "../../shared/telemetry";

import { MssqlWebviewPanelOptions } from "../../shared/webview";
import { ReactWebviewBaseController } from "./reactWebviewBaseController";
import { sendActionEvent } from "../telemetry/telemetry";
import VscodeWrapper from "./vscodeWrapper";
import { Deferred } from "../protocol";

/**
 * ReactWebviewPanelController is a class that manages a vscode.WebviewPanel and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export class ReactWebviewPanelController<
    State,
    Reducers,
    Result = void,
> extends ReactWebviewBaseController<State, Reducers> {
    private _panel: vscode.WebviewPanel;
    public readonly dialogResult: Deferred<Result | undefined> = new Deferred<Result | undefined>();

    /**
     * Creates a new ReactWebviewPanelController
     * @param _context The context of the extension
     * @param title The title of the webview panel
     * @param sourceFile The source file that the webview will use
     * @param initialData The initial state object that the webview will use
     * @param viewColumn The view column that the webview will be displayed in
     * @param _iconPath The icon path that the webview will use
     */
    constructor(
        _context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        sourceFile: string,
        _viewId: string,
        initialData: State,
        private _options: MssqlWebviewPanelOptions,
    ) {
        super(_context, vscodeWrapper, sourceFile, initialData, _viewId);
        this.createWebviewPanel();
        // This call sends messages to the Webview so it's called after the Webview creation.
        this.initializeBase();
    }

    private createWebviewPanel() {
        this._panel = vscode.window.createWebviewPanel(
            "mssql-react-webview",
            this._options.title,
            {
                viewColumn: this._options.viewColumn,
                preserveFocus: this._options.preserveFocus,
            },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(this._context.extensionPath)],
            },
        );

        this._panel.webview.html = this._getHtmlTemplate();
        this._panel.iconPath = this._options.iconPath;
        this.updateConnectionWebview(this._panel.webview);
        this.registerDisposable(
            this._panel.onDidDispose(async () => {
                let prompt;
                if (this._options.showRestorePromptAfterClose) {
                    prompt = await this.showRestorePrompt();
                }
                if (prompt) {
                    await prompt.run();
                    return;
                }
                this.dispose();
            }),
        );
    }

    protected _getWebview(): vscode.Webview {
        return this._panel.webview;
    }

    /**
     * Gets the vscode.WebviewPanel that the controller is managing
     */
    public get panel(): vscode.WebviewPanel {
        return this._panel;
    }

    /**
     * Displays the webview in the foreground
     * @param viewColumn The view column that the webview will be displayed in
     */
    public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
        this._panel.reveal(viewColumn, true);
    }

    private async showRestorePrompt(): Promise<{
        title: string;
        run: () => Promise<void>;
    }> {
        return await vscode.window.showInformationMessage(
            locConstants.Webview.webviewRestorePrompt(this._options.title),
            {
                modal: true,
            },
            {
                title: locConstants.Webview.Restore,
                run: async () => {
                    sendActionEvent(
                        TelemetryViews.WebviewController,
                        TelemetryActions.Restore,
                        {},
                        {},
                    );
                    await this.createWebviewPanel();
                    this._panel.reveal(this._options.viewColumn);
                },
            },
        );
    }

    public set showRestorePromptAfterClose(value: boolean) {
        this._options.showRestorePromptAfterClose = value;
    }

    public override dispose(): void {
        // Ensure that the promise is resolved, regardless of how the panel is disposed.
        // If it has already been resolved/rejected, this won't change that.
        this.dialogResult.resolve(undefined);
        super.dispose();
    }
}
