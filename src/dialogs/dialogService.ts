/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { readFile as fsreadFile } from 'fs';
import { promisify } from 'util';
import * as ejs from 'ejs';
import * as path from 'path';
import { ISelectionData, ISlickRange } from '../models/interfaces';
import { generateGuid } from '../models/utils';
import { createProxy, IMessageProtocol, IServerProxy, IWebviewProxy } from '../protocol';
import { Dialog } from './interfaces';
import * as vscode from 'vscode';
import { ModelViewImpl } from './modelViewImpl';
import { DialogImpl } from './dialogImpl';

function readFile(filePath: string): Promise<Buffer> {
    return promisify(fsreadFile)(filePath);
}

function createMessageProtocol(webview: vscode.Webview): IMessageProtocol {
    return {
        sendMessage: message => webview.postMessage(message),
        onMessage: message => webview.onDidReceiveMessage(message)
    };
}

export class DialogService implements vscode.Disposable {
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private _serverProxy: IServerProxy;
    public proxy: IWebviewProxy;

    constructor(private _context: vscode.ExtensionContext) {}

    public async openDialog(dialog: Dialog): Promise<void> {
        let uri: string = 'dialog://' + generateGuid();
        this._disposables.push(this._panel = vscode.window.createWebviewPanel(uri, dialog.title,
            {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true
            },
            {
                retainContextWhenHidden: true,
                enableScripts: true
            }
        ));
        this._panel.onDidDispose(() => {
            this.dispose();
        });

        this._serverProxy = {
            getRows: (batchId: number, resultId: number, rowStart: number, numberOfRows: number) => undefined,
            copyResults: (batchId: number, resultsId: number, selection: ISlickRange[], includeHeaders?: boolean) => undefined,
            getConfig: () => undefined,
            getLocalizedTexts: () => undefined,
            openLink: (content: string, columnName: string, linkType: string) => undefined,
            saveResults: (batchId: number, resultId: number, format: string, selection: ISlickRange[]) => undefined,
            setEditorSelection: (selection: ISelectionData) => undefined,
            showError: (message: string) => undefined,
            showWarning: (message: string) => {
                vscode.window.showInformationMessage(message);
            },
            sendReadyEvent: async () =>  {
                this.proxy.sendEvent('start', 'message from extension');
                return true;
            },
            dispose: () => undefined

        };
        this.proxy = createProxy(createMessageProtocol(this._panel.webview), this._serverProxy, false);

        const sqlOutputPath = path.resolve(__dirname);
        const fileContent = await readFile(path.join(sqlOutputPath, 'dialogOutput.ejs'));
        const htmlViewPath = ['out', 'src'];
        const baseUri = `${this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, ...htmlViewPath)))}/`;
        const formattedHTML = ejs.render(fileContent.toString(), { basehref: baseUri, prod: false });
        this._panel.webview.html = formattedHTML;

        let dialogImpl: DialogImpl = dialog as DialogImpl;
        if (dialogImpl) {
            let modelView: ModelViewImpl = new ModelViewImpl(this.proxy);
            dialogImpl.contentHandler(modelView);
        }
    }



    public closeDialog(dialog: Dialog): void {
        vscode.window.showInformationMessage('close dialog');
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }
}
