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
import SqlDocumentService, { ConnectionStrategy } from "../controllers/sqlDocumentService";
import StatusView from "../views/statusView";
import { IConnectionProfile } from "../models/interfaces";
import { IPrompter } from "../prompts/question";
import { QueryHistoryUI, QueryHistoryAction } from "../views/queryHistoryUI";
import { getUriKey } from "../utils/utils";
import { Deferred } from "../protocol";
import * as vscodeMssql from "vscode-mssql";

type QueryHistoryTreeNode = QueryHistoryNode | EmptyHistoryNode;

export class QueryHistoryProvider implements vscode.TreeDataProvider<QueryHistoryTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<QueryHistoryTreeNode | undefined> =
        new vscode.EventEmitter<QueryHistoryTreeNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<QueryHistoryTreeNode | undefined> =
        this._onDidChangeTreeData.event;

    private _queryHistoryNodes: QueryHistoryTreeNode[] = [new EmptyHistoryNode()];
    private _queryHistoryLimit: number;
    private _queryHistoryUI: QueryHistoryUI;
    private _queryHistoryMutationId = 0;

    /**
     * Version number for the persisted query history. Increment this if there are breaking changes to the persisted format to ensure old formats are not loaded.
     */
    private static readonly _queryHistoryStorageVersion = 1;
    /**
     * Maximum length of a query string to persist. This is to prevent extremely long queries from taking up too much storage space. This limit does not affect the queries that are stored in memory and shown in the UI, only the ones that are persisted and restored.
     */
    private static readonly _maxPersistedQueryLength = 20000;
    /**
     * Maximum number of query history entries to persist. This is to prevent the persisted query history from taking up too much storage space. This limit does not affect the number of queries that are stored in memory and shown in the UI, only the ones that are persisted and restored.
     */
    private static readonly _maxPersistedNodes = 250;

    constructor(
        private _connectionManager: ConnectionManager,
        private _outputContentProvider: SqlOutputContentProvider,
        private _vscodeWrapper: VscodeWrapper,
        private _sqlDocumentService: SqlDocumentService,
        private _statusView: StatusView,
        private _prompter: IPrompter,
        private _context: vscode.ExtensionContext,
    ) {
        const config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        this._queryHistoryLimit = config.get(Constants.configQueryHistoryLimit);
        this._queryHistoryUI = new QueryHistoryUI(this._prompter);
        void this.restoreQueryHistory();
    }

    clearAll(): void {
        this._queryHistoryMutationId++;
        this._queryHistoryNodes = [new EmptyHistoryNode()];
        this._onDidChangeTreeData.fire(undefined);
        void this.persistQueryHistory();
    }

    refresh(ownerUri: string, timeStamp: Date, hasError: boolean): void {
        const queryString = this.getQueryString(ownerUri);
        if (queryString === undefined) {
            return;
        }

        const timestampLabel = timeStamp.toLocaleString();
        const credentials = this._connectionManager.getConnectionInfo(ownerUri)?.credentials;
        const connectionLabel = this.getConnectionLabel(credentials);
        const historyNodeLabel = this.createHistoryNodeLabel(queryString, connectionLabel);
        const tooltip = this.createHistoryNodeTooltip(queryString, connectionLabel, timestampLabel);
        const node = new QueryHistoryNode(
            historyNodeLabel,
            tooltip,
            queryString,
            ownerUri,
            credentials,
            timeStamp,
            connectionLabel,
            !hasError,
        );

        this._queryHistoryMutationId++;
        this.removeEmptyHistoryNode();
        this.insertHistoryNode(node);
        this._onDidChangeTreeData.fire(undefined);
        void this.persistQueryHistory();
    }

    getTreeItem(node: QueryHistoryTreeNode): QueryHistoryTreeNode {
        return node;
    }

    getChildren(_element?: QueryHistoryTreeNode): QueryHistoryTreeNode[] {
        if (this._queryHistoryNodes.length === 0) {
            this._queryHistoryNodes.push(new EmptyHistoryNode());
        }
        return this._queryHistoryNodes;
    }

    /**
     * Shows the Query History List on the command palette
     */
    public async showQueryHistoryCommandPalette(): Promise<void | undefined> {
        const options = this._queryHistoryNodes
            .filter((node): node is QueryHistoryNode => node instanceof QueryHistoryNode)
            .map((node) => this._queryHistoryUI.convertToQuickPickItem(node));
        const selectedHistoryEntry =
            await this._queryHistoryUI.showQueryHistoryCommandPalette(options);
        if (selectedHistoryEntry) {
            await this.openQueryHistoryEntry(
                selectedHistoryEntry.node,
                selectedHistoryEntry.action === QueryHistoryAction.RunQueryHistoryAction,
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
        const credentials = node.credentials;

        /**
         * Making sure we prepare the connection info with password and refreshed token
         * before we attempt to connect with the credentials.
         */
        if (credentials) {
            await this._connectionManager.prepareConnectionInfo(credentials);
        }

        const connectionStrategy = credentials
            ? ConnectionStrategy.CopyConnectionFromInfo
            : ConnectionStrategy.DoNotConnect;

        const editor = await this._sqlDocumentService.newQuery({
            content: node.queryString,
            connectionStrategy: connectionStrategy,
            connectionInfo: credentials,
        });

        if (isExecute && credentials) {
            const uri = getUriKey(editor.document.uri);
            const title = path.basename(editor.document.fileName);
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
                credentials as IConnectionProfile,
            );
        }
    }

    /**
     * Deletes a query history entry for a URI
     */
    public deleteQueryHistoryEntry(node: QueryHistoryNode): void {
        const nodeIndex = this._queryHistoryNodes.indexOf(node);
        if (nodeIndex < 0) {
            return;
        }

        this._queryHistoryMutationId++;
        this._queryHistoryNodes.splice(nodeIndex, 1);
        this.ensureEmptyHistoryNode();
        this._onDidChangeTreeData.fire(undefined);
        void this.persistQueryHistory();
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
    private createHistoryNodeLabel(queryString: string, connectionLabel: string): string {
        const historyNodeLabel = Utils.limitStringSize(queryString).trim();
        const displayConnectionLabel = Utils.limitStringSize(connectionLabel).trim();

        return displayConnectionLabel
            ? `${historyNodeLabel} : ${displayConnectionLabel}`
            : historyNodeLabel;
    }

    /**
     * Gets the selected text for the corresponding query history listing
     */
    private getQueryString(ownerUri: string): string | undefined {
        const queryRunner = this._outputContentProvider.getQueryRunner(ownerUri);
        if (!queryRunner) {
            return undefined;
        }
        return queryRunner.getQueryString(ownerUri);
    }

    /**
     * Creates a connection label based on credentials
     */
    private getConnectionLabel(credentials?: vscodeMssql.IConnectionInfo): string {
        const server = credentials?.server ?? "";
        const database = credentials?.database ?? "";
        const hasConnectionDetails = server.length > 0 || database.length > 0;
        let connectionLabel = hasConnectionDetails ? `(${server}|${database})` : "";

        if (
            connectionLabel &&
            credentials?.authenticationType === Constants.sqlAuthentication &&
            credentials.user
        ) {
            connectionLabel = `${connectionLabel} : ${credentials.user}`;
        }

        return connectionLabel;
    }

    /**
     * Creates a detailed tool tip when a node is hovered
     */
    private createHistoryNodeTooltip(
        queryString: string,
        connectionLabel: string,
        timeStamp: string,
    ): string {
        const tooltipSections = connectionLabel
            ? [connectionLabel, timeStamp, queryString]
            : [timeStamp, queryString];
        return tooltipSections.join(`${os.EOL}${os.EOL}`);
    }

    private async restoreQueryHistory(): Promise<void> {
        const restoreMutationId = this._queryHistoryMutationId;

        try {
            const serializedHistory = await this._context.secrets.get(
                Constants.queryHistorySecretStorageKey,
            );
            if (!serializedHistory) {
                return;
            }

            const persistedHistory = JSON.parse(serializedHistory) as PersistedQueryHistory;
            if (
                !persistedHistory ||
                persistedHistory.version !== QueryHistoryProvider._queryHistoryStorageVersion ||
                !Array.isArray(persistedHistory.nodes)
            ) {
                return;
            }

            const restoredNodes = persistedHistory.nodes
                .map((node) => this.createNodeFromPersisted(node))
                .filter((node): node is QueryHistoryNode => node !== undefined);

            if (restoreMutationId !== this._queryHistoryMutationId) {
                return;
            }

            if (restoredNodes.length === 0) {
                this._queryHistoryNodes = [new EmptyHistoryNode()];
            } else {
                restoredNodes.sort((a, b) => b.timeStamp.getTime() - a.timeStamp.getTime());
                this._queryHistoryNodes = restoredNodes.slice(0, this._queryHistoryLimit);
            }

            this._onDidChangeTreeData.fire(undefined);
        } catch {
            if (restoreMutationId === this._queryHistoryMutationId) {
                this._queryHistoryNodes = [new EmptyHistoryNode()];
            }
        }
    }

    private createNodeFromPersisted(node: PersistedQueryHistoryNode): QueryHistoryNode | undefined {
        if (
            !node ||
            typeof node.queryString !== "string" ||
            typeof node.connectionLabel !== "string" ||
            typeof node.timeStamp !== "number" ||
            typeof node.isSuccess !== "boolean"
        ) {
            return undefined;
        }

        const restoredTimestamp = new Date(node.timeStamp);
        if (Number.isNaN(restoredTimestamp.getTime())) {
            return undefined;
        }

        const safeQuery = node.queryString.slice(0, QueryHistoryProvider._maxPersistedQueryLength);
        const label = this.createHistoryNodeLabel(safeQuery, node.connectionLabel);
        const tooltip = this.createHistoryNodeTooltip(
            safeQuery,
            node.connectionLabel,
            restoredTimestamp.toLocaleString(),
        );

        return new QueryHistoryNode(
            label,
            tooltip,
            safeQuery,
            node.ownerUri ?? "",
            node.credentials,
            restoredTimestamp,
            node.connectionLabel,
            node.isSuccess,
        );
    }

    private async persistQueryHistory(): Promise<void> {
        const historyNodes = this._queryHistoryNodes.filter(
            (node): node is QueryHistoryNode => node instanceof QueryHistoryNode,
        );

        if (historyNodes.length === 0) {
            await this._context.secrets.delete(Constants.queryHistorySecretStorageKey);
            return;
        }

        const boundedNodes = historyNodes.slice(0, QueryHistoryProvider._maxPersistedNodes);
        const payload: PersistedQueryHistory = {
            version: QueryHistoryProvider._queryHistoryStorageVersion,
            nodes: boundedNodes.map((node) => ({
                queryString: node.queryString.slice(
                    0,
                    QueryHistoryProvider._maxPersistedQueryLength,
                ),
                ownerUri: node.ownerUri,
                credentials: node.credentials,
                timeStamp: node.timeStamp.getTime(),
                connectionLabel: node.connectionLabel,
                isSuccess: node.isSuccess,
            })),
        };

        await this._context.secrets.store(
            Constants.queryHistorySecretStorageKey,
            JSON.stringify(payload),
        );
    }

    private removeEmptyHistoryNode(): void {
        if (
            this._queryHistoryNodes.length === 1 &&
            this._queryHistoryNodes[0] instanceof EmptyHistoryNode
        ) {
            this._queryHistoryNodes = [];
        }
    }

    private ensureEmptyHistoryNode(): void {
        if (this._queryHistoryNodes.length === 0) {
            this._queryHistoryNodes.push(new EmptyHistoryNode());
        }
    }

    private insertHistoryNode(node: QueryHistoryNode): void {
        const insertIndex = this._queryHistoryNodes.findIndex(
            (historyNode) =>
                historyNode instanceof QueryHistoryNode &&
                historyNode.timeStamp.getTime() < node.timeStamp.getTime(),
        );

        if (insertIndex < 0) {
            this._queryHistoryNodes.push(node);
        } else {
            this._queryHistoryNodes.splice(insertIndex, 0, node);
        }

        if (this._queryHistoryNodes.length > this._queryHistoryLimit) {
            this._queryHistoryNodes.pop();
        }
    }
}

interface PersistedQueryHistoryNode {
    queryString: string;
    ownerUri?: string;
    credentials?: vscodeMssql.IConnectionInfo;
    timeStamp: number;
    connectionLabel: string;
    isSuccess: boolean;
}

interface PersistedQueryHistory {
    version: number;
    nodes: PersistedQueryHistoryNode[];
}
