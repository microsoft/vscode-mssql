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

export class QueryHistoryProvider implements vscode.TreeDataProvider<any> {

    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _queryHistoryNodes: vscode.TreeItem[] = [new EmptyHistoryNode()]
    private _queryHistoryLimit: number;

    constructor(
        private _connectionManager: ConnectionManager,
        private _outputContentProvider: SqlOutputContentProvider,
        private _vscodeWrapper: VscodeWrapper,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
        private _statusView: StatusView
    ) {
        const config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        this._queryHistoryLimit = config.get(Constants.configQueryHistoryLimit);
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
        const node = new QueryHistoryNode(historyNodeLabel, tooltip, queryString,
            ownerUri, timeStamp, !hasError);
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
    public deleteQueryHistoryEntry(ownerUri: string): void {
        let index = this._queryHistoryNodes.findIndex(node => {
            return (node as QueryHistoryNode).ownerUri === ownerUri;
        });
        this._queryHistoryNodes.splice(index, 1);
        this._onDidChangeTreeData.fire();
    }

    /**
     * Limits the size of a string with ellipses in the middle
     */
    private limitStringSize(input: string): string {
        if (input.length > 25) {
            return `${input.substr(0, 10)}...${input.substr(input.length-10, input.length)}`
        }
        return input;
    }

    /**
     * Creates the node label for a query history node
     */
    private createHistoryNodeLabel(ownerUri: string, timeStamp: string) {
        const queryString = this.limitStringSize(this.getQueryString(ownerUri));
        const connectionLabel = this.limitStringSize(this.getConnectionLabel(ownerUri));
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
