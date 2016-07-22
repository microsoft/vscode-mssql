import vscode = require('vscode');
import Constants = require('../models/constants');
import ConnInfo = require('../models/connectionInfo');
import Interfaces = require('../models/interfaces');

export default class StatusView implements vscode.Disposable {
    private _statusConnection: vscode.StatusBarItem;
    private _statusQuery: vscode.StatusBarItem;
    private tm;

    constructor() {
        this.createStatusBar();
    }

    dispose(): void {
        this._statusConnection.dispose();
        this._statusConnection = undefined;
        this._statusQuery.dispose();
        this._statusQuery = undefined;
        clearInterval(this.tm);
    }

    // Create status bar item if needed
    private createStatusBar(): void {
        if (!this._statusConnection) {
            this._statusConnection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        }

        if (!this._statusQuery) {
            this._statusQuery = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        }

        if (this.tm) {
            clearInterval(this.tm);
        }
    }

    public show(): void {
        if (this._statusConnection) {
            this._statusConnection.show();
        }
        if (this._statusQuery) {
            this._statusQuery.show();
        }
    }

    public notConnected(): void {
        this.createStatusBar();
        this._statusQuery.hide();
        this._statusConnection.hide();
    }

    public connecting(connCreds: Interfaces.IConnectionCredentials): void {
        this.createStatusBar();
        this._statusConnection.command = undefined;
        this._statusConnection.tooltip = Constants.connectingTooltip + ConnInfo.getTooltip(connCreds);
        this._statusConnection.show();
        this.showProgress(Constants.connectingLabel, this._statusConnection);
    }

    public connectSuccess(connCreds: Interfaces.IConnectionCredentials): void {
        this.createStatusBar();
        this._statusConnection.command = Constants.cmdConnect;
        this._statusConnection.text = connCreds.server;
        this._statusConnection.tooltip = ConnInfo.getTooltip(connCreds);
        this._statusConnection.show();
    }

    public connectError(connCreds: Interfaces.IConnectionCredentials, error: any): void {
        this.createStatusBar();
        this._statusConnection.command = Constants.cmdConnect;
        this._statusConnection.text = Constants.connectErrorLabel;
        this._statusConnection.tooltip = Constants.connectErrorTooltip + connCreds.server + '\n' +
                                      Constants.connectErrorCode + error.code + '\n' +
                                      Constants.connectErrorMessage + error.message;
        this._statusConnection.show();
    }

    public executingQuery(connCreds: Interfaces.IConnectionCredentials): void {
        this.createStatusBar();
        this._statusQuery.command = undefined;
        this._statusQuery.tooltip = Constants.executeQueryLabel;
        this._statusQuery.show();
        this.showProgress(Constants.executeQueryLabel, this._statusQuery);
    }

    public executedQuery(): void {
        this.createStatusBar();
        this._statusQuery.hide();
    }

    private showProgress(statusText: string, statusBarItem: vscode.StatusBarItem): void {
        let index = 0;
        let progressTicks = [ '|', '/', '-', '\\'];
        this.tm = setInterval(() => {
            index++;
            if (index > 3) {
                index = 0;
            }

            let progressTick = progressTicks[index];
            statusBarItem.text = statusText + ' ' + progressTick;
            statusBarItem.show();
        }, 200);
    }
}
