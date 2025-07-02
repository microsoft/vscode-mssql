/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebviewProxy, IServerProxy, createProxy, IMessageProtocol } from "../protocol";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { readFile as fsreadFile } from "fs";
import { promisify } from "util";
import * as ejs from "ejs";
import * as path from "path";
import VscodeWrapper from "./vscodeWrapper";
import StatusView from "../oldViews/statusView";

function readFile(filePath: string): Promise<Buffer> {
    return promisify(fsreadFile)(filePath);
}

function createMessageProtocol(webview: vscode.Webview): IMessageProtocol {
    return {
        sendMessage: (message) => webview.postMessage(message),
        onMessage: (message) => webview.onDidReceiveMessage(message),
    };
}

export class WebviewPanelController implements vscode.Disposable {
    public readonly proxy: IWebviewProxy;
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _isActive: boolean;
    private _rendered: boolean = false;

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        private uri: string,
        title: string,
        serverProxy: IServerProxy,
        private baseUri: string,
        private statusView: StatusView,
    ) {
        const config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this._vscodeWrapper.parseUri(this.uri),
        );
        const retainContextWhenHidden = config[Constants.configPersistQueryResultTabs];
        const column = this.newResultPaneViewColumn(this.uri);
        this._disposables.push(
            (this._panel = vscode.window.createWebviewPanel(
                this.uri,
                title,
                {
                    viewColumn: column,
                    preserveFocus: true,
                },
                {
                    retainContextWhenHidden,
                    enableScripts: true,
                },
            )),
        );
        this._panel.onDidDispose(() => {
            this.statusView.hideRowCount(this.uri, true);
            this.dispose();
        });
        this._disposables.push(
            this._panel.onDidChangeViewState((p) => {
                // occurs when current tab is back in focus
                if (p.webviewPanel.active && p.webviewPanel.visible) {
                    this.statusView.showRowCount(this.uri);
                    this._isActive = true;
                    return;
                }
                // occurs when we switch the current tab
                if (!p.webviewPanel.active && !p.webviewPanel.visible) {
                    this._isActive = false;
                    this.statusView.hideRowCount(this.uri);
                    return;
                }
            }),
        );
        this.proxy = createProxy(createMessageProtocol(this._panel.webview), serverProxy, false);
        this._disposables.push(this.proxy);
    }

    /**
     * Public for testing purposes
     */
    public newResultPaneViewColumn(queryUri: string): vscode.ViewColumn {
        // Find configuration options
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            queryUri,
        );
        let splitPaneSelection = config[Constants.configSplitPaneSelection];
        let viewColumn: vscode.ViewColumn;

        switch (splitPaneSelection) {
            case "current":
                viewColumn = this._vscodeWrapper.activeTextEditor.viewColumn;
                break;
            case "end":
                viewColumn = vscode.ViewColumn.Three;
                break;
            // default case where splitPaneSelection is next or anything else
            default:
                // if there's an active text editor
                if (this._vscodeWrapper.isEditingSqlFile) {
                    viewColumn = this._vscodeWrapper.activeTextEditor.viewColumn;
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

    public async init(): Promise<void> {
        const sqlOutputPath = path.resolve(__dirname);
        const fileContent = await readFile(path.join(sqlOutputPath, "sqlOutput.ejs"));
        const htmlViewPath = ["out", "src"];
        const baseUri = `${this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.baseUri, ...htmlViewPath)))}/`;
        const formattedHTML = ejs.render(fileContent.toString(), {
            basehref: baseUri,
            prod: false,
        });
        this._panel.webview.html = formattedHTML;
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._isDisposed = true;
    }

    public revealToForeground(uri: string): void {
        let column = this.newResultPaneViewColumn(uri);
        this._panel.reveal(column, true);
    }

    /** Getters */

    /**
     * Property indicating whether the tab is active
     */
    public get isActive(): boolean {
        return this._isActive;
    }

    /**
     * Property indicating whether the panel controller
     * is disposed or not
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Property indicating whether the angular app
     * has rendered or not
     */
    public get rendered(): boolean {
        return this._rendered;
    }

    /**
     * Setters
     */

    /**
     * Property indicating whether the angular app
     * has rendered or not
     */
    public set rendered(value: boolean) {
        this._rendered = value;
    }
}
