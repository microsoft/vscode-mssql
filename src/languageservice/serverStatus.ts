/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {IStatusView} from './interfaces';
import * as vscode from 'vscode';
import * as Constants from '../constants/constants';

/*
* The status class which includes the service initialization result.
*/
export class ServerInitializationResult {

    public constructor(
        public installedBeforeInitializing: Boolean = false,
        public isRunning: Boolean = false,
        public serverPath: string = undefined
    ) {

    }

    public clone(): ServerInitializationResult  {
        return new ServerInitializationResult(this.installedBeforeInitializing, this.isRunning, this.serverPath);
    }

    public withRunning(isRunning: Boolean): ServerInitializationResult  {
        return new ServerInitializationResult(this.installedBeforeInitializing, isRunning, this.serverPath);
    }
}

/*
* The status class shows service installing progress in UI
*/
export class ServerStatusView implements IStatusView, vscode.Disposable  {
    private _numberOfSecondsBeforeHidingMessage = 5000;
    private _statusBarItem: vscode.StatusBarItem = undefined;
    private _onDidChangeActiveTextEditorEvent: vscode.Disposable;
    private _onDidCloseTextDocument: vscode.Disposable;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this._onDidChangeActiveTextEditorEvent = vscode.window.onDidChangeActiveTextEditor((params) => this.onDidChangeActiveTextEditor(params));
        this._onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((params) => this.onDidCloseTextDocument(params));
    }

    public installingService(): void {
        this._statusBarItem.command = undefined;
        this._statusBarItem.show();

        this.showProgress('$(desktop-download) ' + Constants.serviceInstalling);
    }

    public updateServiceDownloadingProgress(downloadPercentage: number): void {
        this._statusBarItem.text = '$(cloud-download) ' + `${Constants.serviceDownloading} ... ${downloadPercentage}%`;
        this._statusBarItem.show();
    }

    public serviceInstalled(): void {

        this._statusBarItem.command = undefined;
        this._statusBarItem.text = Constants.serviceInstalled;
        this._statusBarItem.show();
        // Cleat the status bar after 2 seconds
        setTimeout(() => {
            this._statusBarItem.hide();
        }, this._numberOfSecondsBeforeHidingMessage);
    }

    public serviceInstallationFailed(): void {
        this._statusBarItem.command = undefined;
        this._statusBarItem.text = Constants.serviceInstallationFailed;
        this._statusBarItem.show();
    }

    private showProgress(statusText: string): void {
        let index = 0;
        let progressTicks = [ '|', '/', '-', '\\'];


        setInterval(() => {
            index++;
            if (index > 3) {
                index = 0;
            }

            let progressTick = progressTicks[index];
            if (this._statusBarItem.text !== Constants.serviceInstalled) {
                this._statusBarItem.text = statusText + ' ' + progressTick;
                this._statusBarItem.show();
            }
        }, 200);
    }

    dispose(): void {
        this.destroyStatusBar();
        this._onDidChangeActiveTextEditorEvent.dispose();
        this._onDidCloseTextDocument.dispose();
    }

    private hideLastShownStatusBar(): void {
        if (typeof this._statusBarItem !== 'undefined') {
            this._statusBarItem.hide();
        }
    }

    private onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
        // Hide the most recently shown status bar
        this.hideLastShownStatusBar();
    }

    private onDidCloseTextDocument(doc: vscode.TextDocument): void {
        // Remove the status bar associated with the document
        this.destroyStatusBar();
    }

    private destroyStatusBar(): void {
        if (typeof this._statusBarItem !== 'undefined') {
            this._statusBarItem.dispose();
        }
    }

    /**
     * For testing purposes
     */
    public get statusBarItem(): vscode.StatusBarItem {
        return this._statusBarItem;
    }
}

