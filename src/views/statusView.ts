import vscode = require('vscode');
import Constants = require('../models/constants');
import ConnInfo = require('../models/connectionInfo');
import Interfaces = require('../models/interfaces');
import Utils = require('../models/utils');

export default class StatusView implements vscode.Disposable
{
    private _statusConnection: vscode.StatusBarItem;
    private _statusQuery: vscode.StatusBarItem;
    private tm;

    constructor()
    {
        this.createStatusBar();
    }

    dispose()
    {
        this._statusConnection.dispose();
        this._statusConnection = null;
        this._statusQuery.dispose();
        this._statusQuery = null;
        clearInterval(this.tm);
    }

    // Create status bar item if needed
    private createStatusBar()
    {
        if (!this._statusConnection) {
            this._statusConnection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        }

        if (!this._statusQuery) {
            this._statusQuery = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        }

        if(this.tm) {
            clearInterval(this.tm);
        }
    }

    public show()
    {
        if(this._statusConnection) {
            this._statusConnection.show();
        }
        if(this._statusQuery) {
            this._statusQuery.show();
        }
    }

    public notConnected()
    {
        this.createStatusBar();
        this._statusQuery.hide();
        this._statusConnection.hide();
    }

    public connecting(connCreds: Interfaces.IConnectionCredentials)
    {
        this.createStatusBar();
        this._statusConnection.command = null;
        this._statusConnection.tooltip = Constants.gConnectingTooltip + ConnInfo.getTooltip(connCreds);
        this._statusConnection.show();
        this.showProgress(Constants.gConnectingLabel, this._statusConnection);
    }

    public connectSuccess(connCreds: Interfaces.IConnectionCredentials)
    {
        this.createStatusBar();
        this._statusConnection.command = Constants.gCmdConnect;
        this._statusConnection.text = connCreds.server;
        this._statusConnection.tooltip = ConnInfo.getTooltip(connCreds);
        this._statusConnection.show();
    }

    public connectError(connCreds: Interfaces.IConnectionCredentials, error: any)
    {
        this.createStatusBar();
        this._statusConnection.command = Constants.gCmdConnect;
        this._statusConnection.text = Constants.gConnectErrorLabel;
        this._statusConnection.tooltip = Constants.gConnectErrorTooltip + connCreds.server + "\n" +
                                      Constants.gConnectErrorCode + error.code + "\n" +
                                      Constants.gConnectErrorMessage + error.message;
        this._statusConnection.show();
    }

    public executingQuery(connCreds: Interfaces.IConnectionCredentials)
    {
        this.createStatusBar();
        this._statusQuery.command = null;
        this._statusQuery.tooltip = Constants.gExecuteQueryLabel;
        this._statusQuery.show();
        this.showProgress(Constants.gExecuteQueryLabel, this._statusQuery);
    }

    public executedQuery()
    {
        this.createStatusBar();
        this._statusQuery.hide();
    }

    private showProgress(statusText: string, statusBarItem: vscode.StatusBarItem)
    {
        let index = 0;
        let progressTicks = [ '|', '/', '-', '\\'];
        this.tm = setInterval(() => {
            index++;
            if (index > 3)
                index = 0;

            let progressTick = progressTicks[index];
            statusBarItem.text = statusText + " " + progressTick;
            statusBarItem.show();
        }, 200);
    }
}