/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode = require('vscode');
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import ConnInfo = require('../models/connectionInfo');
import * as ConnectionContracts from '../models/contracts/connection';
import Interfaces = require('../models/interfaces');
import * as Utils from '../models/utils';
import VscodeWrapper from '../controllers/vscodeWrapper';

// Status bar element for each file in the editor
class FileStatusBar {
    // Item for the language flavor status
    public statusLanguageFlavor: vscode.StatusBarItem;

    // Item for the connection status
    public statusConnection: vscode.StatusBarItem;

    // Item for the query status
    public statusQuery: vscode.StatusBarItem;

    // Item for language service status
    public statusLanguageService: vscode.StatusBarItem;

    // Timer used for displaying a progress indicator on queries
    public progressTimerId: NodeJS.Timer;

    // Item for SQLCMD Mode
    public sqlCmdMode: vscode.StatusBarItem;

    // Item for Row Count
    public rowCount: vscode.StatusBarItem;

    public currentLanguageServiceStatus: string;
}

export default class StatusView implements vscode.Disposable {
    private _statusBars: { [fileUri: string]: FileStatusBar };
    private _lastShownStatusBar: FileStatusBar;
    private _onDidChangeActiveTextEditorEvent: vscode.Disposable;
    private _onDidCloseTextDocumentEvent: vscode.Disposable;

    constructor(private _vscodeWrapper?: VscodeWrapper) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
        this._statusBars = {};
        this._onDidChangeActiveTextEditorEvent = this._vscodeWrapper.onDidChangeActiveTextEditor((params) => this.onDidChangeActiveTextEditor(params));
        this._onDidCloseTextDocumentEvent = this._vscodeWrapper.onDidCloseTextDocument((params) => this.onDidCloseTextDocument(params));
    }

    dispose(): void {
        for (let bar in this._statusBars) {
            if (this._statusBars.hasOwnProperty(bar)) {
                this._statusBars[bar].statusLanguageFlavor.dispose();
                this._statusBars[bar].statusConnection.dispose();
                this._statusBars[bar].statusQuery.dispose();
                this._statusBars[bar].statusLanguageService.dispose();
                this._statusBars[bar].sqlCmdMode.dispose();
                this._statusBars[bar].rowCount.dispose();
                clearInterval(this._statusBars[bar].progressTimerId);
                delete this._statusBars[bar];
            }
        }
        this._onDidChangeActiveTextEditorEvent.dispose();
        this._onDidCloseTextDocumentEvent.dispose();
    }

    // Create status bar item if needed
    private createStatusBar(fileUri: string): void {
        let bar = new FileStatusBar();
        // set language flavor priority as always 90 since it's to show to the right of the file type
        bar.statusLanguageFlavor = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        bar.statusConnection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        bar.statusQuery = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        bar.statusLanguageService = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        bar.sqlCmdMode = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        bar.rowCount = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
        this._statusBars[fileUri] = bar;
    }

    private destroyStatusBar(fileUri: string): void {
        let bar = this._statusBars[fileUri];
        if (bar) {
            if (bar.statusLanguageFlavor) {
                bar.statusLanguageFlavor.dispose();
            }
            if (bar.statusConnection) {
                bar.statusConnection.dispose();
            }
            if (bar.statusQuery) {
                bar.statusQuery.dispose();
            }
            if (bar.statusLanguageService) {
                bar.statusLanguageService.dispose();
            }
            if (bar.progressTimerId) {
                clearInterval(bar.progressTimerId);
            }
            if (bar.sqlCmdMode) {
                bar.sqlCmdMode.dispose();
            }
            if (bar.rowCount) {
                bar.rowCount.dispose();
            }

            delete this._statusBars[fileUri];
        }
    }

    private getStatusBar(fileUri: string): FileStatusBar {
        if (!(fileUri in this._statusBars)) {
            // Create it if it does not exist
            this.createStatusBar(fileUri);
        }

        let bar = this._statusBars[fileUri];
        if (bar.progressTimerId) {
            clearInterval(bar.progressTimerId);
        }
        return bar;
    }

    public show(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        this.showStatusBarItem(fileUri, bar.statusLanguageFlavor);
        this.showStatusBarItem(fileUri, bar.statusConnection);
        this.showStatusBarItem(fileUri, bar.statusQuery);
        this.showStatusBarItem(fileUri, bar.statusLanguageService);
        this.showStatusBarItem(fileUri, bar.sqlCmdMode);
        this.showStatusBarItem(fileUri, bar.rowCount);
    }

    public notConnected(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.text = LocalizedConstants.notConnectedLabel;
        bar.statusConnection.tooltip = LocalizedConstants.notConnectedTooltip;
        bar.statusConnection.command = Constants.cmdConnect;
        this.showStatusBarItem(fileUri, bar.statusConnection);
        bar.statusLanguageService.text = '';
        this.showStatusBarItem(fileUri, bar.statusLanguageService);
        this.showStatusBarItem(fileUri, bar.statusLanguageFlavor);
    }

    public connecting(fileUri: string, connCreds: Interfaces.IConnectionCredentials): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.text = LocalizedConstants.connectingLabel;
        bar.statusConnection.command = Constants.cmdDisconnect;
        bar.statusConnection.tooltip = LocalizedConstants.connectingTooltip + ConnInfo.getTooltip(connCreds);
        this.showStatusBarItem(fileUri, bar.statusConnection);
        this.showProgress(fileUri, LocalizedConstants.connectingLabel, bar.statusConnection);
    }

    public connectSuccess(fileUri: string, connCreds: Interfaces.IConnectionCredentials, serverInfo: ConnectionContracts.ServerInfo): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.command = Constants.cmdChooseDatabase;
        bar.statusConnection.text = ConnInfo.getConnectionDisplayString(connCreds);
        bar.statusConnection.tooltip = ConnInfo.getTooltip(connCreds, serverInfo);
        this.showStatusBarItem(fileUri, bar.statusConnection);
        this.sqlCmdModeChanged(fileUri, false);
    }

    public connectError(fileUri: string, credentials: Interfaces.IConnectionCredentials, error: ConnectionContracts.ConnectionCompleteParams): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.command = Constants.cmdConnect;
        bar.statusConnection.text = LocalizedConstants.connectErrorLabel;
        if (error.errorNumber && error.errorMessage && !Utils.isEmpty(error.errorMessage)) {
            bar.statusConnection.tooltip = LocalizedConstants.connectErrorTooltip + credentials.server + '\n' +
                                        LocalizedConstants.connectErrorCode + error.errorNumber + '\n' +
                                        LocalizedConstants.connectErrorMessage + error.errorMessage;
        } else {
            bar.statusConnection.tooltip = LocalizedConstants.connectErrorTooltip + credentials.server + '\n' +
                                        LocalizedConstants.connectErrorMessage + error.messages;
        }
        this.showStatusBarItem(fileUri, bar.statusConnection);
    }

    public executingQuery(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusQuery.command = undefined;
        bar.statusQuery.tooltip = LocalizedConstants.executeQueryLabel;
        this.showStatusBarItem(fileUri, bar.statusQuery);
        this.showProgress(fileUri, LocalizedConstants.executeQueryLabel, bar.statusQuery);
    }

    public executedQuery(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusQuery.hide();
    }

    public cancelingQuery(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusQuery.hide();

        bar.statusQuery.command = undefined;
        bar.statusQuery.tooltip = LocalizedConstants.cancelingQueryLabel;
        this.showStatusBarItem(fileUri, bar.statusQuery);
        this.showProgress(fileUri, LocalizedConstants.cancelingQueryLabel, bar.statusQuery);
    }

    public languageServiceStatusChanged(fileUri: string, status: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.currentLanguageServiceStatus = status;
        this.updateStatusMessage(status,
        () => { return bar.currentLanguageServiceStatus; }, (message) => {
            bar.statusLanguageService.text = message;
            this.showStatusBarItem(fileUri, bar.statusLanguageService);
        });
    }

    public languageFlavorChanged(fileUri: string, flavor: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusLanguageFlavor.text = flavor;
        bar.statusLanguageFlavor.command = Constants.cmdChooseLanguageFlavor;
        this.showStatusBarItem(fileUri, bar.statusLanguageFlavor);
    }

    public sqlCmdModeChanged(fileUri: string, isSqlCmd: boolean = false): void {
        let bar = this.getStatusBar(fileUri);
        bar.sqlCmdMode.text = isSqlCmd ? 'SQLCMD: On' : 'SQLCMD: Off';
        bar.sqlCmdMode.command = Constants.cmdToggleSqlCmd;
        this.showStatusBarItem(fileUri, bar.sqlCmdMode);
    }

    public showRowCount(fileUri: string, message?: string): void {
        let bar = this.getStatusBar(fileUri);
        if (message) {
            // Remove parentheses from start and end
            bar.rowCount.text = message.slice(1, -1);
        }
        this.showStatusBarItem(fileUri, bar.rowCount);
    }

    public hideRowCount(fileUri: string, clear: boolean = false): void {
        let bar = this.getStatusBar(fileUri);
        if (clear) {
            bar.rowCount.text = '';
        }
        bar.rowCount.hide();
    }

    public updateStatusMessage(
        newStatus: string,
        getCurrentStatus: () => string,
        updateMessage:  (message: string) => void): void {
        switch (newStatus) {
            case LocalizedConstants.definitionRequestedStatus:
                setTimeout(() => {
                    if (getCurrentStatus() !== LocalizedConstants.definitionRequestCompletedStatus) {
                        updateMessage(LocalizedConstants.gettingDefinitionMessage);
                    }
                }, 500);
                break;
            case LocalizedConstants.definitionRequestCompletedStatus:
                updateMessage('');
                break;
            case LocalizedConstants.updatingIntelliSenseStatus:
                updateMessage(LocalizedConstants.updatingIntelliSenseLabel);
                break;
            case LocalizedConstants.intelliSenseUpdatedStatus:
                updateMessage('');
                break;
            default:
                Utils.logDebug(`Language service status changed. ${newStatus}`);
                break;
        }
    }

    /**
     * Associate a new uri with an existing Uri's status bar
     *
     * @param existingUri The already existing URI's status bar you want to associated
     * @param newUri The new URI you want to associate with the existing status bar
     * @return True or False whether the association was able to be made. False indicated the exitingUri specified
     * did not exist
     */

    public associateWithExisting(existingUri: string, newUri: string): boolean {
        let bar = this.getStatusBar(existingUri);
        if (bar) {
            this._statusBars[newUri] = bar;
            return true;
        } else {
            return false;
        }
    }

    private hideLastShownStatusBar(): void {
        if (typeof this._lastShownStatusBar !== 'undefined') {
            this._lastShownStatusBar.statusLanguageFlavor.hide();
            this._lastShownStatusBar.statusConnection.hide();
            this._lastShownStatusBar.statusQuery.hide();
            this._lastShownStatusBar.statusLanguageService.hide();
            this._lastShownStatusBar.sqlCmdMode.hide();
            this._lastShownStatusBar.rowCount.hide();
        }
    }

    private onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
        // Change the status bar to match the open file
        if (typeof editor !== 'undefined') {
            // Hide the most recently shown status bar
            this.hideLastShownStatusBar();
            const fileUri = editor.document.uri.toString(true);
            const bar = this._statusBars[fileUri];
            if (bar) {
                this.showStatusBarItem(fileUri, bar.statusLanguageFlavor);
                this.showStatusBarItem(fileUri, bar.statusConnection);
                this.showStatusBarItem(fileUri, bar.statusLanguageService);
                this.showStatusBarItem(fileUri, bar.sqlCmdMode);
                this.showStatusBarItem(fileUri, bar.rowCount);
            }
        }
    }

    private onDidCloseTextDocument(doc: vscode.TextDocument): void {
        // Remove the status bar associated with the document
        this.destroyStatusBar(doc.uri.toString(true));
    }

    private showStatusBarItem(fileUri: string, statusBarItem: vscode.StatusBarItem): void {
        let currentOpenFile = Utils.getActiveTextEditorUri();

        // Only show the status bar if it matches the currently open file and is not empty
        if (fileUri === currentOpenFile && !Utils.isEmpty(statusBarItem.text) ) {
            statusBarItem.show();
            if (fileUri in this._statusBars) {
                this._lastShownStatusBar = this._statusBars[fileUri];
            }
        } else {
            statusBarItem.hide();
        }
    }

    private showProgress(fileUri: string, statusText: string, statusBarItem: vscode.StatusBarItem): void {
        const self = this;
        let index = 0;
        let progressTicks = [ '|', '/', '-', '\\'];

        let bar = this.getStatusBar(fileUri);
        bar.progressTimerId = setInterval(() => {
            index++;
            if (index > 3) {
                index = 0;
            }

            let progressTick = progressTicks[index];
            statusBarItem.text = statusText + ' ' + progressTick;
            self.showStatusBarItem(fileUri, statusBarItem);
        }, 200);
    }
}
