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
    private _disposables: any[] = [];
    private _isDisposed: boolean;

    constructor(
        uri: string,
        title: string,
        serverProxy: IServerProxy,
        private baseUri: string,
        private queryRunner: QueryRunner
    ) {
        const config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName, vscode.Uri.parse(uri));
        const retainContextWhenHidden = config[Constants.configPersistQueryResultTabs];
        const column = newResultPaneViewColumn(uri);
        this._disposables.push(this._panel = vscode.window.createWebviewPanel(uri, title, column, {
            retainContextWhenHidden,
            enableScripts: true
        }));
        this._disposables.push(this._panel.onDidDispose(() => {
            this.dispose();
        }));
        this._disposables.push(this._panel.onDidChangeViewState((p) => {
            // if the webview tab changed, cache state
            if (!p.webviewPanel.visible && !p.webviewPanel.active) {
                return;

            } else if (p.webviewPanel.visible && p.webviewPanel.active) {
                if (!this.queryRunner.isExecutingQuery) {
                    // for refresh
                    // give a 2 sec delay because the the webview visible event is fired
                    // before the angular component is actually built. Give time for the
                    // angular component to show up
                    setTimeout(async () => await this.queryRunner.refreshQueryTab(), 1700);
                }
            }
        }));
        // for theme change
        // this._disposables.push(vscode.workspace.onDidChangeConfiguration(async (change) => {
        //     await this.init();
        // }));
        this.proxy = createProxy(createMessageProtocol(this._panel.webview), serverProxy, false);
        this._disposables.push(this.proxy);
    }

    public async init(): Promise<void> {
        const sqlOutputPath = path.resolve(path.resolve(path.dirname(__dirname)), '../../src/controllers');
        const fileContent = await readFile(path.join(sqlOutputPath, 'sqlOutput.ejs'));
        const htmlViewPath = ['out', 'src', 'views', 'htmlcontent'];
        const baseUri = `${vscode.Uri.file(path.join(this.baseUri, ...htmlViewPath)).with({ scheme: 'vscode-resource' })}/`;
        const theme = vscode.workspace.getConfiguration('workbench').get('colorTheme');
        const formattedHTML = ejs.render(fileContent.toString(), { basehref: baseUri, prod: false, theme: theme });
        this._panel.webview.html = formattedHTML;
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._isDisposed = true;
    }

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
