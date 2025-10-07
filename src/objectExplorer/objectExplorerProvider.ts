/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../controllers/connectionManager";
import { CreateSessionResult, ObjectExplorerService } from "./objectExplorerService";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { IConnectionInfo } from "vscode-mssql";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { IConnectionProfile } from "../models/interfaces";
import { ConnectionNode } from "./nodes/connectionNode";
import { serverLabel, databaseString } from "../constants/constants";
import { GitStatusService } from "../services/gitStatusService";
import { GitObjectStatus } from "../models/gitStatus";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import { GitDecorationProvider } from "./gitDecorationProvider";

export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<
        any | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _objectExplorerService: ObjectExplorerService;
    private _gitStatusService: GitStatusService | undefined;
    private _gitDecorationProvider: GitDecorationProvider;

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        connectionManager: ConnectionManager,
        private _isRichExperienceEnabled: boolean = true,
        gitStatusService?: GitStatusService,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._objectExplorerService = new ObjectExplorerService(
            this._vscodeWrapper,
            connectionManager,
            (node) => {
                this.refresh(node);
            },
            this._isRichExperienceEnabled,
        );

        this._gitStatusService = gitStatusService;
        this._gitDecorationProvider = new GitDecorationProvider();
    }

    public getParent(element: TreeNodeInfo) {
        return element.parentNode;
    }

    public refresh(nodeInfo?: TreeNodeInfo): void {
        this._onDidChangeTreeData.fire(nodeInfo);
    }

    public async getTreeItem(node: TreeNodeInfo): Promise<TreeNodeInfo> {
        // Apply Git decorations if GitStatusService is available
        if (this._gitStatusService) {
            await this._applyGitDecorations(node);
        }
        return node;
    }

    public async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const children = await this._objectExplorerService.getChildren(element);
        if (children) {
            return children;
        }
    }

    /**
     * Refresh all connected connection nodes in the object explorer.
     */
    public refreshConnectedNodes(): void {
        const connections = this._objectExplorerService.connections;
        if (connections?.length === 0) {
            return;
        }

        connections
            .map(({ id }) => this._objectExplorerService.getConnectionNodeById(id))
            .filter((node) => node.sessionId && node.nodeType === serverLabel) // Only refresh connected server nodes
            .forEach((node) => void this.refreshNode(node));
    }

    public async setNodeLoading(node: TreeNodeInfo): Promise<void> {
        await this._objectExplorerService.setLoadingUiForNode(node);
    }

    public async createSession(
        connectionCredentials?: IConnectionInfo,
    ): Promise<CreateSessionResult> {
        return this._objectExplorerService.createSession(connectionCredentials);
    }

    public async expandNode(
        node: TreeNodeInfo,
        sessionId: string,
    ): Promise<vscode.TreeItem[] | undefined> {
        return this._objectExplorerService.expandNode(node, sessionId);
    }

    public async removeNode(
        node: ConnectionNode,
        showUserConfirmationPrompt?: boolean,
    ): Promise<void> {
        if (showUserConfirmationPrompt !== undefined) {
            await this._objectExplorerService.removeNode(node, showUserConfirmationPrompt);
        } else {
            await this._objectExplorerService.removeNode(node);
        }
    }

    public async disconnectNode(node: ConnectionNode): Promise<void> {
        await this._objectExplorerService.disconnectNode(node);
        this.refresh(node);
    }

    public async refreshNode(node: TreeNodeInfo): Promise<void> {
        node.shouldRefresh = true;
        this._onDidChangeTreeData.fire(node);
    }

    public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
        if (connections.length === 0) {
            return;
        }

        await this._objectExplorerService.removeConnectionNodes(connections);
        this.refresh(undefined);
    }

    public addDisconnectedNode(connectionCredentials: IConnectionProfile): void {
        this._objectExplorerService.addDisconnectedNode(connectionCredentials);
    }

    public deleteChildrenCache(node: TreeNodeInfo): void {
        this._objectExplorerService.cleanNodeChildren(node);
    }

    public get connections(): IConnectionProfile[] {
        return this._objectExplorerService.connections;
    }

    public get objectExplorerService(): ObjectExplorerService {
        return this._objectExplorerService;
    }

    /* Only for testing purposes */
    public set objectExplorerService(value: ObjectExplorerService) {
        this._objectExplorerService = value;
    }

    /**
     * Set the Git status service for applying decorations
     */
    public setGitStatusService(gitStatusService: GitStatusService): void {
        this._gitStatusService = gitStatusService;
    }

    /**
     * Get the Git decoration provider
     */
    public getGitDecorationProvider(): GitDecorationProvider {
        return this._gitDecorationProvider;
    }

    /**
     * Apply Git decorations to a tree node
     */
    private async _applyGitDecorations(node: TreeNodeInfo): Promise<void> {
        try {
            // Only apply decorations if node has connection profile
            if (!node.connectionProfile) {
                return;
            }

            const credentials = node.connectionProfile;

            // Check if this is a database node
            if (
                node.nodeType === databaseString ||
                node.metadata?.metadataTypeName === databaseString
            ) {
                await this._applyDatabaseGitDecoration(node, credentials);
            }
            // Check if this is a scriptable object node (Table, View, StoredProcedure, etc.)
            else if (node.metadata && this._isScriptableObject(node.metadata.metadataTypeName)) {
                await this._applyObjectGitDecoration(node, credentials);
            }
        } catch (error) {
            // Silently fail - don't break Object Explorer if Git decorations fail
            console.error("[ObjectExplorerProvider] Error applying Git decorations:", error);
        }
    }

    /**
     * Apply Git decoration to a database node
     */
    private async _applyDatabaseGitDecoration(
        node: TreeNodeInfo,
        credentials: IConnectionInfo,
    ): Promise<void> {
        // Get database name from node
        const databaseName = ObjectExplorerUtils.getDatabaseName(node);
        if (!databaseName) {
            return;
        }

        // Update credentials with correct database name
        const dbCredentials = Object.assign({}, credentials, { database: databaseName });

        // Get Git link information
        const gitInfo = await this._gitStatusService!.getDatabaseGitInfo(dbCredentials);

        if (gitInfo.isLinked) {
            // Show branch name in description (text on the right)
            node.description = gitInfo.branch;

            // Update tooltip with Git information
            const tooltip = new vscode.MarkdownString();
            tooltip.appendMarkdown(`**Database:** ${databaseName}\n\n`);
            tooltip.appendMarkdown(`**Git Repository:** ${gitInfo.repositoryUrl}\n\n`);
            tooltip.appendMarkdown(`**Branch:** ${gitInfo.branch}\n\n`);
            if (gitInfo.lastSyncAt) {
                tooltip.appendMarkdown(
                    `**Last Sync:** ${new Date(gitInfo.lastSyncAt).toLocaleString()}\n\n`,
                );
            }
            node.tooltip = tooltip;
        }
    }

    /**
     * Apply Git decoration to an object node (Table, View, StoredProcedure, etc.)
     */
    private async _applyObjectGitDecoration(
        node: TreeNodeInfo,
        credentials: IConnectionInfo,
    ): Promise<void> {
        // Get database name from node
        const databaseName = ObjectExplorerUtils.getDatabaseName(node);
        if (!databaseName) {
            return;
        }

        // Update credentials with correct database name
        const dbCredentials = Object.assign({}, credentials, { database: databaseName });

        // Get object status
        const statusInfo = await this._gitStatusService!.getObjectStatus(
            dbCredentials,
            node.metadata!,
        );

        // Create a unique resource URI for this node to enable file decorations
        // Use the node's ID or a combination of database + object name
        const resourceUri = vscode.Uri.parse(
            `mssql-object://${dbCredentials.server}/${dbCredentials.database}/${node.metadata!.metadataTypeName}/${node.metadata!.schema || "dbo"}/${node.metadata!.name}`,
        );
        node.resourceUri = resourceUri;

        // Set decoration in the decoration provider
        if (
            statusInfo.status !== GitObjectStatus.InSync &&
            statusInfo.status !== GitObjectStatus.Untracked &&
            statusInfo.status !== GitObjectStatus.Unknown
        ) {
            this._gitDecorationProvider.setDecoration(resourceUri, statusInfo.status);
        } else {
            this._gitDecorationProvider.clearDecoration(resourceUri);
        }
    }

    /**
     * Check if an object type is scriptable
     */
    private _isScriptableObject(metadataTypeName: string): boolean {
        const scriptableTypes = [
            "Table",
            "View",
            "StoredProcedure",
            "UserDefinedFunction",
            "Trigger",
        ];
        return scriptableTypes.includes(metadataTypeName);
    }
}
