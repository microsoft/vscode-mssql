/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebviewProxy, IServerProxy, createProxy, IMessageProtocol } from '../protocol';
import * as vscode from 'vscode';
import * as Constants from '../constants/constants';
import { readFile as fsreadFile } from 'fs';
import { promisify } from 'util';
import * as ejs from 'ejs';
import * as path from 'path';
import QueryRunner from './queryRunner';

function readFile(filePath: string): Promise<Buffer> {
    return promisify(fsreadFile)(filePath);
}

function createMessageProtocol(webview: vscode.Webview): IMessageProtocol {
    return {
        sendMessage: message => webview.postMessage(message),
        onMessage: message => webview.onDidReceiveMessage(message)
    };
}

export class WebviewPanelController implements vscode.Disposable {
    public readonly proxy: IWebviewProxy;
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _isActive: boolean;

    constructor(
        uri: string,
        title: string,
        serverProxy: IServerProxy,
        private baseUri: string
    ) {
        const config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName, vscode.Uri.parse(uri));
        const retainContextWhenHidden = config[Constants.configPersistQueryResultTabs];
        const column = newResultPaneViewColumn(uri);
        this._disposables.push(this._panel = vscode.window.createWebviewPanel(uri, title, column, {
            retainContextWhenHidden,
            enableScripts: true
        }));
        this._panel.onDidDispose(() => {
            this.dispose();
        });
        this._disposables.push(this._panel.onDidChangeViewState((p) => {
            // occurs when current tab is back in focus
            if (p.webviewPanel.active && p.webviewPanel.visible) {
                this._isActive = true;
                return;
            }
            // occurs when we switch the current tab
            if (!p.webviewPanel.active && !p.webviewPanel.visible) {
                this._isActive = false;
                return;
            }
        }));
        this.proxy = createProxy(createMessageProtocol(this._panel.webview), serverProxy, false);
    }

    public async init(): Promise<void> {
        const sqlOutputPath = path.resolve(__dirname);
        const fileContent = await readFile(path.join(sqlOutputPath, 'sqlOutput.ejs'));
        const htmlViewPath = ['out', 'src'];
        const baseUri = `${vscode.Uri.file(path.join(this.baseUri, ...htmlViewPath)).with({ scheme: 'vscode-resource' })}/`;
        const formattedHTML = ejs.render(fileContent.toString(), { basehref: baseUri, prod: false });
        this._panel.webview.html = formattedHTML;
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._isDisposed = true;
    }

    public revealToForeground(): void {
        this._panel.reveal();
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
}

function newResultPaneViewColumn(queryUri: string): vscode.ViewColumn {
    // Find configuration options
    let config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName, vscode.Uri.parse(queryUri));
    let splitPaneSelection = config[Constants.configSplitPaneSelection];
    let viewColumn: vscode.ViewColumn;


    switch (splitPaneSelection) {
        case 'current':
            viewColumn = vscode.window.activeTextEditor.viewColumn;
            break;
        case 'end':
            viewColumn = vscode.ViewColumn.Three;
            break;
        // default case where splitPaneSelection is next or anything else
        default:
            if (vscode.window.activeTextEditor.viewColumn === vscode.ViewColumn.One) {
                viewColumn = vscode.ViewColumn.Two;
            } else {
                viewColumn = vscode.ViewColumn.Three;
            }
    }

    return viewColumn;
}
