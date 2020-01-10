/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import { QueryHistoryNode, EmptyHistoryNode } from './queryHistoryNode';
import VscodeWrapper from '../controllers/vscodeWrapper';
import Constants = require('../constants/constants');

export class QueryHistoryProvider implements vscode.TreeDataProvider<any> {

    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _connectionManager: ConnectionManager;
    private _outputContentProvider: SqlOutputContentProvider;
    private _queryHistoryNodes: vscode.TreeItem[] = [new EmptyHistoryNode()]
    private _vscodeWrapper: VscodeWrapper;
    private _queryHistoryLimit: number;

    constructor(
        connectionManager: ConnectionManager,
        outputContentProvider: SqlOutputContentProvider,
        vscodeWrapper: VscodeWrapper
    ) {
        this._connectionManager = connectionManager;
        this._outputContentProvider = outputContentProvider;
        this._vscodeWrapper = vscodeWrapper;
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
        const node = new QueryHistoryNode(historyNodeLabel, tooltip, ownerUri, timeStamp, !hasError);
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
        return this._queryHistoryNodes;
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

    private createHistoryNodeLabel(ownerUri: string, timeStamp: string) {
        const queryString = this.limitStringSize(this.getQueryString(ownerUri));
        const connectionLabel = this.limitStringSize(this.getConnectionLabel(ownerUri));
        return `${queryString}, ${connectionLabel}, ${timeStamp}`;
    }


    private getQueryString(ownerUri: string): string {
        const queryRunner = this._outputContentProvider.getQueryRunner(ownerUri);
        return queryRunner.getQueryString(ownerUri);
    }

    private getConnectionLabel(ownerUri: string): string {
        let connInfo = this._connectionManager.getConnectionInfo(ownerUri);
        return `(${connInfo.credentials.server}|${connInfo.credentials.database})`;
    }

    private createHistoryNodeTooltip(ownerUri: string, timeStamp: string): string {
        const queryString = this.getQueryString(ownerUri);
        const connectionLabel = this.getConnectionLabel(ownerUri);
        return `${queryString}\n${connectionLabel}\n${timeStamp}`;
    }
}
