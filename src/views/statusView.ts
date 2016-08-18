import vscode = require('vscode');
import Constants = require('../models/constants');
import ConnInfo = require('../models/connectionInfo');
import Interfaces = require('../models/interfaces');

// Status bar element for each file in the editor
class FileStatusBar {
    // Item for the connection status
    public statusConnection: vscode.StatusBarItem;

    // Item for the query status
    public statusQuery: vscode.StatusBarItem;

    // Timer used for displaying a progress indicator on queries
    public progressTimerId: number;
}

export default class StatusView implements vscode.Disposable {
    private _statusBars: { [fileName: string]: FileStatusBar };
    private _lastShownStatusBar: FileStatusBar;

    constructor() {
        this._statusBars = {};
        vscode.window.onDidChangeActiveTextEditor((params) => this.onDidChangeActiveTextEditor(params));
        vscode.workspace.onDidCloseTextDocument((params) => this.onDidCloseTextDocument(params));
    }

    dispose(): void {
        for (let bar in this._statusBars) {
            if (this._statusBars.hasOwnProperty(bar)) {
                this._statusBars[bar].statusConnection.dispose();
                this._statusBars[bar].statusQuery.dispose();
                clearInterval(this._statusBars[bar].progressTimerId);
                delete this._statusBars[bar];
            }
        }
    }

    // Create status bar item if needed
    private createStatusBar(fileName: string): void {
        let bar = new FileStatusBar();
        bar.statusConnection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        bar.statusQuery = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this._statusBars[fileName] = bar;
    }

    private destroyStatusBar(fileName: string): void {
        let bar = this._statusBars[fileName];
        if (bar) {
            if (bar.statusConnection) {
                bar.statusConnection.dispose();
            }
            if (bar.statusQuery) {
                bar.statusQuery.dispose();
            }
            if (bar.progressTimerId) {
                clearInterval(bar.progressTimerId);
            }

            delete this._statusBars[fileName];
        }
    }

    private getStatusBar(fileName: string): FileStatusBar {
        if (!(fileName in this._statusBars)) {
            // Create it if it does not exist
            this.createStatusBar(fileName);
        }

        let bar = this._statusBars[fileName];
        if (bar.progressTimerId) {
            clearInterval(bar.progressTimerId);
        }
        return bar;
    }

    public show(fileName: string): void {
        let bar = this.getStatusBar(fileName);
        this.showStatusBarItem(fileName, bar.statusConnection);
        this.showStatusBarItem(fileName, bar.statusQuery);
    }

    public notConnected(fileName: string): void {
        let bar = this.getStatusBar(fileName);
        bar.statusConnection.text = Constants.notConnectedLabel;
        bar.statusConnection.tooltip = Constants.notConnectedTooltip;
        bar.statusConnection.command = Constants.cmdConnect;
        this.showStatusBarItem(fileName, bar.statusConnection);
    }

    public connecting(fileName: string, connCreds: Interfaces.IConnectionCredentials): void {
        let bar = this.getStatusBar(fileName);
        bar.statusConnection.command = undefined;
        bar.statusConnection.tooltip = Constants.connectingTooltip + ConnInfo.getTooltip(connCreds);
        this.showStatusBarItem(fileName, bar.statusConnection);
        this.showProgress(fileName, Constants.connectingLabel, bar.statusConnection);
    }

    public connectSuccess(fileName: string, connCreds: Interfaces.IConnectionCredentials): void {
        let bar = this.getStatusBar(fileName);
        bar.statusConnection.command = Constants.cmdConnect;
        if (connCreds.database !== '') {
            bar.statusConnection.text = connCreds.server + ' : ' + connCreds.database + ' : ' + connCreds.user;
        } else {
            bar.statusConnection.text = connCreds.server + ' : <default> : ' + connCreds.user;
        }
        bar.statusConnection.tooltip = ConnInfo.getTooltip(connCreds);
        this.showStatusBarItem(fileName, bar.statusConnection);
    }

    public connectError(fileName: string, connCreds: Interfaces.IConnectionCredentials, error: any): void {
        let bar = this.getStatusBar(fileName);
        bar.statusConnection.command = Constants.cmdConnect;
        bar.statusConnection.text = Constants.connectErrorLabel;
        bar.statusConnection.tooltip = Constants.connectErrorTooltip + connCreds.server + '\n' +
                                      Constants.connectErrorCode + error.code + '\n' +
                                      Constants.connectErrorMessage + error.message;
        this.showStatusBarItem(fileName, bar.statusConnection);
    }

    public executingQuery(fileName: string, connCreds: Interfaces.IConnectionCredentials): void {
        let bar = this.getStatusBar(fileName);
        bar.statusQuery.command = undefined;
        bar.statusQuery.tooltip = Constants.executeQueryLabel;
        this.showStatusBarItem(fileName, bar.statusQuery);
        this.showProgress(fileName, Constants.executeQueryLabel, bar.statusQuery);
    }

    public executedQuery(fileName: string): void {
        let bar = this.getStatusBar(fileName);
        bar.statusQuery.hide();
    }

    private hideLastShownStatusBar(): void {
        if (typeof this._lastShownStatusBar !== 'undefined') {
            this._lastShownStatusBar.statusConnection.hide();
            this._lastShownStatusBar.statusQuery.hide();
        }
    }

    private onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
        // Hide the most recently shown status bar
        this.hideLastShownStatusBar();

        // Change the status bar to match the open file
        if (typeof editor !== 'undefined') {
            const fileName = editor.document.uri.toString();
            const bar = this._statusBars[fileName];
            if (bar) {
                this.showStatusBarItem(fileName, bar.statusConnection);
                this.showStatusBarItem(fileName, bar.statusQuery);
            }
        }
    }

    private onDidCloseTextDocument(doc: vscode.TextDocument): void {
        // Remove the status bar associated with the document
        this.destroyStatusBar(doc.uri.toString());
    }

    private showStatusBarItem(fileName: string, statusBarItem: vscode.StatusBarItem): void {
        let currentOpenFile = '';
        if (typeof vscode.window.activeTextEditor !== 'undefined' &&
            typeof vscode.window.activeTextEditor.document !== 'undefined') {
            currentOpenFile = vscode.window.activeTextEditor.document.uri.toString();
        }

        // Only show the status bar if it matches the currently open file
        if (fileName === currentOpenFile) {
            statusBarItem.show();
            if (fileName in this._statusBars) {
                this._lastShownStatusBar = this._statusBars[fileName];
            }
        } else {
            statusBarItem.hide();
        }
    }

    private showProgress(fileName: string, statusText: string, statusBarItem: vscode.StatusBarItem): void {
        const self = this;
        let index = 0;
        let progressTicks = [ '|', '/', '-', '\\'];

        let bar = this.getStatusBar(fileName);
        bar.progressTimerId = setInterval(() => {
            index++;
            if (index > 3) {
                index = 0;
            }

            let progressTick = progressTicks[index];
            statusBarItem.text = statusText + ' ' + progressTick;
            self.showStatusBarItem(fileName, statusBarItem);
        }, 200);
    }
}
