/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IConnectionInfo, IServerInfo } from "vscode-mssql";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as ConnInfo from "../models/connectionInfo";
import * as ConnectionContracts from "../models/contracts/connection";
import * as Utils from "../models/utils";
import { ConnectionStore } from "../models/connectionStore";
import { IConnectionProfile } from "../models/interfaces";

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
    public progressTimerId: NodeJS.Timeout;

    // Item for SQLCMD Mode
    public sqlCmdMode: vscode.StatusBarItem;

    // Item for Row Count
    public rowCount: vscode.StatusBarItem;

    // Item for execution time
    public executionTime: vscode.StatusBarItem;

    public currentLanguageServiceStatus: string;

    public queryTimer: NodeJS.Timeout;

    public connectionId: string;
}

export default class StatusView implements vscode.Disposable {
    private _statusBars: { [fileUri: string]: FileStatusBar };
    private _lastShownStatusBar: FileStatusBar;
    private _onDidChangeActiveTextEditorEvent: vscode.Disposable;
    private _onDidCloseTextDocumentEvent: vscode.Disposable;
    private _connectionStore: ConnectionStore;

    constructor(private _vscodeWrapper?: VscodeWrapper) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
        this._statusBars = {};
        this._onDidChangeActiveTextEditorEvent = this._vscodeWrapper.onDidChangeActiveTextEditor(
            (params) => this.onDidChangeActiveTextEditor(params),
        );
        this._onDidCloseTextDocumentEvent = this._vscodeWrapper.onDidCloseTextDocument((params) =>
            this.onDidCloseTextDocument(params),
        );
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
                this._statusBars[bar].executionTime.dispose();
                clearInterval(this._statusBars[bar].progressTimerId);
                clearInterval(this._statusBars[bar].queryTimer);
                delete this._statusBars[bar];
            }
        }
        this._onDidChangeActiveTextEditorEvent.dispose();
        this._onDidCloseTextDocumentEvent.dispose();
    }

    public setConnectionStore(connectionStore: ConnectionStore): void {
        this._connectionStore = connectionStore;
    }

    // Create status bar item if needed
    private createStatusBar(fileUri: string): void {
        let bar = new FileStatusBar();
        // set language flavor priority as always 90 since it's to show to the right of the file type
        bar.statusLanguageFlavor = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            90,
        );
        bar.statusConnection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        bar.statusQuery = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        bar.statusQuery.accessibilityInformation = { role: "alert", label: "" };
        bar.statusLanguageService = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
        );
        bar.sqlCmdMode = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        bar.rowCount = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
        bar.executionTime = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 70);
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
            if (bar.queryTimer) {
                clearInterval(bar.queryTimer);
            }
            if (bar.sqlCmdMode) {
                bar.sqlCmdMode.dispose();
            }
            if (bar.rowCount) {
                bar.rowCount.dispose();
            }
            if (bar.executionTime) {
                bar.executionTime.dispose();
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
        bar.statusConnection.text = `$(plug) ${LocalizedConstants.StatusBar.disconnectedLabel}`;
        bar.statusConnection.tooltip = LocalizedConstants.StatusBar.notConnectedTooltip;
        bar.statusConnection.command = Constants.cmdConnect;
        bar.statusConnection.color = undefined;
        bar.connectionId = undefined;
        this.showStatusBarItem(fileUri, bar.statusConnection);
        bar.statusLanguageService.text = "";
        this.showStatusBarItem(fileUri, bar.statusLanguageService);
        this.showStatusBarItem(fileUri, bar.statusLanguageFlavor);
    }

    public connecting(fileUri: string, connCreds: IConnectionInfo): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.text = `$(loading~spin) ${LocalizedConstants.StatusBar.connectingLabel}`;
        bar.statusConnection.command = Constants.cmdDisconnect;
        bar.statusConnection.color = undefined;
        bar.statusConnection.tooltip =
            LocalizedConstants.connectingTooltip + ConnInfo.getTooltip(connCreds);
        bar.connectionId = (connCreds as IConnectionProfile).id || undefined;
        this.showStatusBarItem(fileUri, bar.statusConnection);
    }

    public async connectSuccess(
        fileUri: string,
        connCreds: IConnectionInfo,
        serverInfo: IServerInfo,
    ): Promise<void> {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.command = Constants.cmdChooseDatabase;

        let statusBarConnectionInfoMaxLength: number = vscode.workspace
            .getConfiguration(Constants.extensionConfigSectionName)
            .get(Constants.configStatusBarConnectionInfoMaxLength);
        bar.statusConnection.text = `$(check) ${ConnInfo.getConnectionDisplayString(connCreds, statusBarConnectionInfoMaxLength)}`;

        bar.statusConnection.tooltip = ConnInfo.getTooltip(connCreds, serverInfo);
        bar.connectionId = (connCreds as IConnectionProfile).id || undefined;

        bar.statusConnection.color = await this.getConnectionColor(bar.connectionId);
        this.showStatusBarItem(fileUri, bar.statusConnection);
        this.sqlCmdModeChanged(fileUri, false);
    }

    public async updateConnectionColors(): Promise<void> {
        for (const fileUri of Object.keys(this._statusBars)) {
            const bar = this._statusBars[fileUri];
            bar.statusConnection.color = await this.getConnectionColor(bar.connectionId);
        }
    }

    private async getConnectionColor(
        connectionId: string | undefined,
    ): Promise<string | undefined> {
        if (
            !this._connectionStore ||
            !connectionId ||
            this._vscodeWrapper
                .getConfiguration()
                .get<boolean>(Constants.configStatusBarEnableConnectionColor) !== true
        ) {
            return undefined;
        }

        return (await this._connectionStore.getGroupForConnectionId(connectionId))?.color;
    }

    public connectError(
        fileUri: string,
        credentials: IConnectionInfo,
        error: ConnectionContracts.ConnectionCompleteParams,
    ): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusConnection.command = Constants.cmdConnect;
        bar.statusConnection.text = `$(error) ${LocalizedConstants.StatusBar.connectErrorLabel}`;
        if (error.errorNumber && error.errorMessage && !Utils.isEmpty(error.errorMessage)) {
            bar.statusConnection.tooltip =
                LocalizedConstants.connectErrorTooltip +
                credentials.server +
                "\n" +
                LocalizedConstants.connectErrorCode +
                error.errorNumber +
                "\n" +
                LocalizedConstants.connectErrorMessage +
                error.errorMessage;
        } else {
            bar.statusConnection.tooltip =
                LocalizedConstants.connectErrorTooltip +
                credentials.server +
                "\n" +
                LocalizedConstants.connectErrorMessage +
                error.messages;
        }
        this.showStatusBarItem(fileUri, bar.statusConnection);
    }

    public executingQuery(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusQuery.command = undefined;
        bar.statusQuery.text = LocalizedConstants.executeQueryLabel;
        this.showStatusBarItem(fileUri, bar.statusQuery);
        this.showProgress(fileUri, LocalizedConstants.executeQueryLabel, bar.statusQuery);
    }

    public executedQuery(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusQuery.text = LocalizedConstants.QueryExecutedLabel;
        // hide the status bar item with a delay so that the change can be announced by screen reader.
        setTimeout(() => {
            bar.statusQuery.hide();
        }, 200);
    }

    public setExecutionTime(fileUri: string, time: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.executionTime.text = time;
        this.showStatusBarItem(fileUri, bar.executionTime);
        clearInterval(bar.queryTimer);
    }

    public cancelingQuery(fileUri: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusQuery.hide();

        bar.statusQuery.command = undefined;
        bar.statusQuery.text = LocalizedConstants.cancelingQueryLabel;
        this.showStatusBarItem(fileUri, bar.statusQuery);
        this.showProgress(fileUri, LocalizedConstants.cancelingQueryLabel, bar.statusQuery);
        clearInterval(bar.queryTimer);
    }

    public languageServiceStatusChanged(fileUri: string, status: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.currentLanguageServiceStatus = status;
        this.updateStatusMessage(
            status,
            () => {
                return bar.currentLanguageServiceStatus;
            },
            (message) => {
                bar.statusLanguageService.text = message;
                this.showStatusBarItem(fileUri, bar.statusLanguageService);
            },
        );
    }

    public languageFlavorChanged(fileUri: string, flavor: string): void {
        let bar = this.getStatusBar(fileUri);
        bar.statusLanguageFlavor.text = flavor;
        bar.statusLanguageFlavor.command = Constants.cmdChooseLanguageFlavor;
        this.showStatusBarItem(fileUri, bar.statusLanguageFlavor);
    }

    public sqlCmdModeChanged(fileUri: string, isSqlCmd: boolean = false): void {
        let bar = this.getStatusBar(fileUri);
        bar.sqlCmdMode.text = isSqlCmd ? "SQLCMD: On" : "SQLCMD: Off";
        bar.sqlCmdMode.command = Constants.cmdToggleSqlCmd;
        this.showStatusBarItem(fileUri, bar.sqlCmdMode);
    }

    public showRowCount(fileUri: string, message?: string): void {
        let bar = this.getStatusBar(fileUri);
        if (message && message.includes("row")) {
            // Remove parentheses from start and end
            bar.rowCount.text = message.replace("(", "").replace(")", "");
        }
        this.showStatusBarItem(fileUri, bar.rowCount);
    }

    public hideRowCount(fileUri: string, clear: boolean = false): void {
        let bar = this.getStatusBar(fileUri);
        if (clear) {
            bar.rowCount.text = "";
        }
        bar.rowCount.hide();
    }

    public updateStatusMessage(
        newStatus: string,
        getCurrentStatus: () => string,
        updateMessage: (message: string) => void,
    ): void {
        switch (newStatus) {
            case LocalizedConstants.definitionRequestedStatus:
                setTimeout(() => {
                    if (
                        getCurrentStatus() !== LocalizedConstants.definitionRequestCompletedStatus
                    ) {
                        updateMessage(LocalizedConstants.gettingDefinitionMessage);
                    }
                }, 500);
                break;
            case LocalizedConstants.definitionRequestCompletedStatus:
                updateMessage("");
                break;
            case LocalizedConstants.updatingIntelliSenseStatus:
                updateMessage(LocalizedConstants.updatingIntelliSenseLabel);
                break;
            case LocalizedConstants.intelliSenseUpdatedStatus:
                updateMessage("");
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
        if (typeof this._lastShownStatusBar !== "undefined") {
            this._lastShownStatusBar.statusLanguageFlavor.hide();
            this._lastShownStatusBar.statusConnection.hide();
            this._lastShownStatusBar.statusQuery.hide();
            this._lastShownStatusBar.statusLanguageService.hide();
            this._lastShownStatusBar.sqlCmdMode.hide();
            this._lastShownStatusBar.rowCount.hide();
            this._lastShownStatusBar.executionTime.hide();
        }
    }

    private onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
        // Change the status bar to match the open file
        if (typeof editor !== "undefined") {
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
                this.showStatusBarItem(fileUri, bar.executionTime);
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
        if (fileUri === currentOpenFile && !Utils.isEmpty(statusBarItem.text)) {
            statusBarItem.show();
            if (fileUri in this._statusBars) {
                this._lastShownStatusBar = this._statusBars[fileUri];
            }
        } else {
            statusBarItem.hide();
        }
    }

    private showProgress(
        fileUri: string,
        statusText: string,
        statusBarItem: vscode.StatusBarItem,
    ): void {
        // Do not use the text based in progress indicator when screen reader is on, it is not user friendly to announce the changes every 200 ms.
        const screenReaderOptimized = vscode.workspace
            .getConfiguration("editor")
            .get("accessibilitySupport");
        if (screenReaderOptimized === "on") {
            return;
        }
        const self = this;
        let bar = this.getStatusBar(fileUri);

        // Clear any existing timer first
        clearInterval(bar.queryTimer);

        let milliseconds = 0;
        bar.queryTimer = setInterval(() => {
            milliseconds += 1000;
            const timeString = self.formatMillisecondsToTimeString(milliseconds);
            statusBarItem.text = statusText + " " + timeString;
            self.showStatusBarItem(fileUri, statusBarItem);
        }, 1000);
    }

    private formatMillisecondsToTimeString(milliseconds: number): string {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = ((milliseconds % 60000) / 1000).toFixed(0);
        return minutes + ":" + (parseInt(seconds) < 10 ? "0" : "") + seconds;
    }
}
