import { IWebviewProxy, IServerProxy, createProxy, IMessageProtocol } from './protocol';
import * as vscode from 'vscode';
import * as Constants from '../constants/constants';
import { readFile as fsreadFile } from 'fs';
import { promisify } from 'util';
import * as ejs from 'ejs';
import * as path from 'path';

function readFile(filePath: string): Promise<Buffer> {
    return promisify(fsreadFile)(filePath);
}

function createMessageProtocol(webview: vscode.Webview): IMessageProtocol {
    return {
        sendMessage: message => webview.postMessage(message),
        onMessage: message => webview.onDidReceiveMessage(message)
    };
}

export class WebviewPanelController {
    public readonly proxy: IWebviewProxy;
    private _panel: vscode.WebviewPanel;

    constructor(uri: string, title: string, serverProxy: IServerProxy, private baseUri: string) {
        const config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName, vscode.Uri.parse(uri));
        const retainContextWhenHidden = config[Constants.configPersistQueryResultTabs];
        const column = newResultPaneViewColumn(uri);
        this._panel = vscode.window.createWebviewPanel(uri, title, column, {
            retainContextWhenHidden,
            enableScripts: true
        });
        this.proxy = createProxy(createMessageProtocol(this._panel.webview), serverProxy, false);
    }

    public async init(): Promise<void> {
        await WebviewPanelController.refresh(this._panel, this.baseUri);
    }

    public reset(): void {
        // this.proxy.reset();
    }

    /** Static function to refresh webview from webview */
    public static async refresh(panel: vscode.WebviewPanel, baseUri: string): Promise<void> {
        const sqlOutputPath = path.resolve(path.resolve(path.dirname(__dirname)), '../../src/controllers');
        const fileContent = await readFile(path.join(sqlOutputPath, 'sqlOutput.ejs'));
        const htmlViewPath = ['out', 'src', 'views', 'htmlcontent'];
        baseUri = `${vscode.Uri.file(path.join(baseUri, ...htmlViewPath)).with({ scheme: 'vscode-resource' })}/`;
        const formattedHTML = ejs.render(fileContent.toString(), { basehref: baseUri, prod: false });
        panel.webview.html = formattedHTML;
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
