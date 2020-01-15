/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as path from 'path';
import ConnectionManager from '../controllers/connectionManager';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import { QueryHistoryNode, EmptyHistoryNode } from './queryHistoryNode';
import VscodeWrapper from '../controllers/vscodeWrapper';
import Constants = require('../constants/constants');
import UntitledSqlDocumentService from '../controllers/untitledSqlDocumentService';
import { Deferred } from '../protocol';
import StatusView from '../views/statusView';
import { IConnectionProfile } from '../models/interfaces';
import { IPrompter } from '../prompts/question';
import { QueryHistoryUI, QueryHistoryAction } from '../views/queryHistoryUI';

export class QueryHistoryProvider implements vscode.TreeDataProvider<any> {

    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _queryHistoryNodes: vscode.TreeItem[] = [new EmptyHistoryNode()]
    private _queryHistoryLimit: number;
    private _queryHistoryEnabled: boolean;
    private _queryHistoryUI: QueryHistoryUI

    constructor(
        private _connectionManager: ConnectionManager,
        private _outputContentProvider: SqlOutputContentProvider,
        private _vscodeWrapper: VscodeWrapper,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
        private _statusView: StatusView,
        private _prompter: IPrompter
    ) {
        const config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        this._queryHistoryLimit = config.get(Constants.configQueryHistoryLimit);
        this._queryHistoryEnabled = config.get(Constants.configEnableQueryHistoryCapture);
        this._vscodeWrapper.setContext(Constants.isQueryHistoryEnabled, this._queryHistoryEnabled);
        this._queryHistoryUI = new QueryHistoryUI(this._prompter, this._vscodeWrapper);
    }

    clearAll(): void {
        this._queryHistoryNodes = [new EmptyHistoryNode()];
        this._onDidChangeTreeData.fire();
    }

    refresh(ownerUri: string, timeStamp: Date, hasError): void {
        const timeStampString = timeStamp.toLocaleString();
        const historyNodeLabel = this.createHistoryNodeLabel(ownerUri, timeStampString);
        const tooltip = this.createHistoryNodeTooltip(ownerUri, timeStampString);
        const queryString = this.getQueryString(ownerUri);
        const connectionLabel = this.getConnectionLabel(ownerUri);
        const node = new QueryHistoryNode(historyNodeLabel, tooltip, queryString,
            ownerUri, timeStamp, connectionLabel, !hasError);
        if (this._queryHistoryNodes.length === 1) {
            if (this._queryHistoryNodes[0] instanceof EmptyHistoryNode) {
                this._queryHistoryNodes = [];
            }
        }
        this._queryHistoryNodes.push(node);
        // Push out the first listing if it crosses limit to maintain
        // an LRU order
        if (this._queryHistoryNodes.length > this._queryHistoryLimit) {
            this._queryHistoryNodes.shift();
        }
        // return the query history sorted by timestamp
        this._queryHistoryNodes.sort((a, b) => {
            return (b as QueryHistoryNode).timeStamp.getTime()-
                (a as QueryHistoryNode).timeStamp.getTime();
        });
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: QueryHistoryNode): any {
        return node;
    }

    async getChildren(element?: any): Promise<vscode.TreeItem[]> {
        if (this._queryHistoryNodes.length == 0) {
            this._queryHistoryNodes.push(new EmptyHistoryNode());
        }
        return this._queryHistoryNodes;
    }

    /**
     *
     */
    public async showQueryHistoryCommandPalette(): Promise<void> {
        const options = this._queryHistoryNodes.map(node => this._queryHistoryUI.convertToQuickPickItem(node));
        let queryHistoryQuickPickItem = await this._queryHistoryUI.showQueryHistoryCommandPalette(options);
        this.openQueryHistoryEntry(queryHistoryQuickPickItem.node, queryHistoryQuickPickItem.action ===
            QueryHistoryAction.RunQueryHistoryAction);
    }

    /**
     * Starts the history capture by changing the setting
     * and changes context for menu actions
     */
    public async startQueryHistoryCapture(): Promise<void> {
        await this._vscodeWrapper.setConfiguration(Constants.extensionConfigSectionName,
            Constants.configEnableQueryHistoryCapture, true);
        await this._vscodeWrapper.setContext(Constants.isQueryHistoryEnabled, true);
    }

    /**
     * Pauses the history capture by changing the setting
     * and changes context for menu actions
     */
    public async pauseQueryHistoryCapture(): Promise<void> {
        await this._vscodeWrapper.setConfiguration(Constants.extensionConfigSectionName,
            Constants.configEnableQueryHistoryCapture, false);
        await this._vscodeWrapper.setContext(Constants.isQueryHistoryEnabled, false);
    }

    /**
     * Opens a query history listing in a new query window
     */
    public async openQueryHistoryEntry(node: QueryHistoryNode, isExecute: boolean = false): Promise<void> {
        const editor = await this._untitledSqlDocumentService.newQuery(node.queryString);
        let uri = editor.document.uri.toString(true);
        let title = path.basename(editor.document.fileName);
        const queryUriPromise = new Deferred<boolean>();
        let credentials = this._connectionManager.getConnectionInfo(node.ownerUri).credentials;
        await this._connectionManager.connect(uri, credentials, queryUriPromise);
        await queryUriPromise;
        this._statusView.languageFlavorChanged(uri, Constants.mssqlProviderName);
        this._statusView.sqlCmdModeChanged(uri, false);
        if (isExecute) {
            const queryPromise = new Deferred<boolean>();
            await this._outputContentProvider.runQuery(this._statusView, uri, undefined, title, queryPromise);
            await queryPromise;
            await this._connectionManager.connectionStore.removeRecentlyUsed(<IConnectionProfile>credentials);
        }
    }

    /**
     * Deletes a query history entry for a URI
     */
    public deleteQueryHistoryEntry(node: QueryHistoryNode): void {
        let index = this._queryHistoryNodes.findIndex(n => {
            let historyNode = n as QueryHistoryNode;
            return historyNode === node;
        });
        this._queryHistoryNodes.splice(index, 1);
        this._onDidChangeTreeData.fire();
    }

    /**
     * Getters
     */
    public get queryHistoryNodes(): vscode.TreeItem[] {
        return this._queryHistoryNodes;
    }

    /**
     * Limits the size of a string with ellipses in the middle
     */
    public static limitStringSize(input: string, forCommandPalette: boolean = false): string {
        if (!forCommandPalette) {
            if (input.length > 25) {
                return `${input.substr(0, 10)}...${input.substr(input.length-10, input.length)}`
            }
        } else {
            if (input.length > 45) {
                return `${input.substr(0, 20)}...${input.substr(input.length-20, input.length)}`
            }
        }
        return input;
    }

    /**
     * Creates the node label for a query history node
     */
    private createHistoryNodeLabel(ownerUri: string, timeStamp: string) {
        const queryString = QueryHistoryProvider.limitStringSize(this.getQueryString(ownerUri));
        const connectionLabel = QueryHistoryProvider.limitStringSize(this.getConnectionLabel(ownerUri));
        return `${queryString}, ${connectionLabel}, ${timeStamp}`;
    }

    /**
     * Gets the selected text for the corresponding query history listing
     */
    private getQueryString(ownerUri: string): string {
        const queryRunner = this._outputContentProvider.getQueryRunner(ownerUri);
        return queryRunner.getQueryString(ownerUri);
    }

    /**
     * Creates a connection label based on credentials
     */
    private getConnectionLabel(ownerUri: string): string {
        let connInfo = this._connectionManager.getConnectionInfo(ownerUri);
        return `(${connInfo.credentials.server}|${connInfo.credentials.database})`;
    }

    /**
     * Creates a detailed tool tip when a node is hovered
     */
    private createHistoryNodeTooltip(ownerUri: string, timeStamp: string): string {
        const queryString = this.getQueryString(ownerUri);
        const connectionLabel = this.getConnectionLabel(ownerUri);
        return `${queryString}\n${connectionLabel}\n${timeStamp}`;
    }
}
