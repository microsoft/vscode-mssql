/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewBaseController } from "./reactWebviewBaseController";

/**
 * ReactWebviewViewController is a class that manages a vscode.WebviewView and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export class ReactWebviewViewController<State, Reducers>
    extends ReactWebviewBaseController<State, Reducers>
    implements vscode.WebviewViewProvider
{
    private _webviewView: vscode.WebviewView;

    /**
     * Creates a new ReactWebviewViewController
     * @param _context Extension context
     * @param _sourceFile Source file that the webview will use
     * @param initialData Initial state object that the webview will use
     */
    constructor(
        _context: vscode.ExtensionContext,
        _sourceFile: string,
        initialData: State,
    ) {
        super(_context, _sourceFile, initialData);
    }

    protected _getWebview(): vscode.Webview {
        return this._webviewView?.webview;
    }

    /**
     * returns if the webview is visible
     */
    public isVisible(): boolean {
        return this._webviewView?.visible;
    }
    /**
     * Displays the webview in the foreground
     */
    public revealToForeground(): void {
        this._webviewView.show(true);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._webviewView = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [this._context.extensionUri],
        };
        this._webviewView.onDidDispose(() => {
            this.dispose();
        });

        this._webviewView.webview.html = this._getHtmlTemplate();
        this.registerDisposable(
            this._webviewView.webview.onDidReceiveMessage(
                this._webviewMessageHandler,
            ),
        );
        this.initializeBase();
    }
}
