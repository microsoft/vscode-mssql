/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as Utils from "../models/utils";
import ConnectionManager from "../controllers/connectionManager";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import { QueryHistoryNode, EmptyHistoryNode } from "./queryHistoryNode";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as Constants from "../constants/constants";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { Deferred } from "../protocol";
import StatusView from "../../extension/oldViews/statusView";
import { IConnectionProfile } from "../models/interfaces";
import { IPrompter } from "../prompts/question";
import { QueryHistoryUI, QueryHistoryAction } from "../../extension/oldViews/queryHistoryUI";

export class QueryHistoryProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<
        any | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _queryHistoryNodes: vscode.TreeItem[] = [new EmptyHistoryNode()];
    private _queryHistoryLimit: number;
    private _queryHistoryUI: QueryHistoryUI;

    constructor(
        private _connectionManager: ConnectionManager,
        private _outputContentProvider: SqlOutputContentProvider,
        private _vscodeWrapper: VscodeWrapper,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
        private _statusView: StatusView,
        private _prompter: IPrompter,
    ) {
        const config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        this._queryHistoryLimit = config.get(Constants.configQueryHistoryLimit);
        this._queryHistoryUI = new QueryHistoryUI(this._prompter);
    }

    clearAll(): void {
        this._queryHistoryNodes = [new EmptyHistoryNode()];
        this._onDidChangeTreeData.fire(undefined);
    }

    refresh(ownerUri: string, timeStamp: Date, hasError): void {
        const timeStampString = timeStamp.toLocaleString();
        const historyNodeLabel = this.createHistoryNodeLabel(ownerUri);
        const tooltip = this.createHistoryNodeTooltip(ownerUri, timeStampString);
        const queryString = this.getQueryString(ownerUri);
        const connectionLabel = this.getConnectionLabel(ownerUri);
        const node = new QueryHistoryNode(
            historyNodeLabel,
            tooltip,
            queryString,
            ownerUri,
            timeStamp,
            connectionLabel,
            !hasError,
        );
        if (this._queryHistoryNodes.length === 1) {
            if (this._queryHistoryNodes[0] instanceof EmptyHistoryNode) {
                this._queryHistoryNodes = [];
            }
        }
        this._queryHistoryNodes.push(node);
        // sort the query history sorted by timestamp
        this._queryHistoryNodes.sort((a, b) => {
            return (
                (b as QueryHistoryNode).timeStamp.getTime() -
                (a as QueryHistoryNode).timeStamp.getTime()
            );
        });
        // Push out the first listing if it crosses limit to maintain
        // an LRU order
        if (this._queryHistoryNodes.length > this._queryHistoryLimit) {
            this._queryHistoryNodes.shift();
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(node: QueryHistoryNode): QueryHistoryNode {
        return node;
    }

    getChildren(element?: any): vscode.TreeItem[] {
        if (this._queryHistoryNodes.length === 0) {
            this._queryHistoryNodes.push(new EmptyHistoryNode());
        }
        return this._queryHistoryNodes;
    }

    /**
     * Shows the Query History List on the command palette
     */
    public async showQueryHistoryCommandPalette(): Promise<void | undefined> {
        const options = this._queryHistoryNodes.map((node) =>
            this._queryHistoryUI.convertToQuickPickItem(node),
        );
        let queryHistoryQuickPickItem =
            await this._queryHistoryUI.showQueryHistoryCommandPalette(options);
        if (queryHistoryQuickPickItem) {
            await this.openQueryHistoryEntry(
                queryHistoryQuickPickItem.node,
                queryHistoryQuickPickItem.action === QueryHistoryAction.RunQueryHistoryAction,
            );
        }
        return undefined;
    }

    /**
     * Starts the history capture by changing the setting
     * and changes context for menu actions
     */
    public async startQueryHistoryCapture(): Promise<void> {
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionConfigSectionName,
            Constants.configEnableQueryHistoryCapture,
            true,
        );
    }

    /**
     * Pauses the history capture by changing the setting
     * and changes context for menu actions
     */
    public async pauseQueryHistoryCapture(): Promise<void> {
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionConfigSectionName,
            Constants.configEnableQueryHistoryCapture,
            false,
        );
    }

    /**
     * Opens a query history listing in a new query window
     */
    public async openQueryHistoryEntry(
        node: QueryHistoryNode,
        isExecute: boolean = false,
    ): Promise<void> {
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
            await this._outputContentProvider.runQuery(
                this._statusView,
                uri,
                undefined,
                title,
                {}, // empty execution plan options
                queryPromise,
            );
            await queryPromise;
            await this._connectionManager.connectionStore.removeRecentlyUsed(
                <IConnectionProfile>credentials,
            );
        }
    }

    /**
     * Deletes a query history entry for a URI
     */
    public deleteQueryHistoryEntry(node: QueryHistoryNode): void {
        let index = this._queryHistoryNodes.findIndex((n) => {
            let historyNode = n as QueryHistoryNode;
            return historyNode === node;
        });
        this._queryHistoryNodes.splice(index, 1);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Getters
     */
    public get queryHistoryNodes(): vscode.TreeItem[] {
        return this._queryHistoryNodes;
    }

    /**
     * Creates the node label for a query history node
     */
    private createHistoryNodeLabel(ownerUri: string): string {
        const queryString = Utils.limitStringSize(this.getQueryString(ownerUri)).trim();
        const connectionLabel = Utils.limitStringSize(this.getConnectionLabel(ownerUri)).trim();
        return `${queryString} : ${connectionLabel}`;
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
        const connInfo = this._connectionManager.getConnectionInfo(ownerUri);
        const credentials = connInfo.credentials;
        let connString = `(${credentials.server}|${credentials.database})`;
        if (credentials.authenticationType === Constants.sqlAuthentication) {
            connString = `${connString} : ${credentials.user}`;
        }
        return connString;
    }

    /**
     * Creates a detailed tool tip when a node is hovered
     */
    private createHistoryNodeTooltip(ownerUri: string, timeStamp: string): string {
        const queryString = this.getQueryString(ownerUri);
        const connectionLabel = this.getConnectionLabel(ownerUri);
        return `${connectionLabel}${os.EOL}${os.EOL}${timeStamp}${os.EOL}${os.EOL}${queryString}`;
    }
}
