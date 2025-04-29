/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../controllers/connectionManager";
import { CreateSessionResult, ObjectExplorerService } from "./objectExplorerService";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { Deferred } from "../protocol";
import { IConnectionInfo } from "vscode-mssql";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { IConnectionProfile } from "../models/interfaces";
import { ConnectionNode } from "./nodes/connectionNode";
import * as LocalizedConstants from "../constants/locConstants";

export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<
        any | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _objectExplorerService: ObjectExplorerService;

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        private _connectionManager: ConnectionManager,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._objectExplorerService = new ObjectExplorerService(
            this._vscodeWrapper,
            _connectionManager,
            (node) => {
                this.refresh(node);
            },
        );
    }

    public getParent(element: TreeNodeInfo) {
        return element.parentNode;
    }

    public refresh(nodeInfo?: TreeNodeInfo): void {
        this._onDidChangeTreeData.fire(nodeInfo);
    }

    public getTreeItem(node: TreeNodeInfo): TreeNodeInfo {
        return node;
    }

    public async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const children = await this._objectExplorerService.getChildren(element);
        if (children) {
            return children;
        }
    }

    public async createSession(
        connectionCredentials?: IConnectionInfo,
    ): Promise<CreateSessionResult> {
        return this._objectExplorerService.createSession(connectionCredentials);
    }

    public async expandNode(
        node: TreeNodeInfo,
        sessionId: string,
        promise: Deferred<TreeNodeInfo[]>,
    ): Promise<boolean> {
        return this._objectExplorerService.expandNode(node, sessionId, promise);
    }

    public async removeNode(node: ConnectionNode): Promise<void> {
        const response = await vscode.window.showInformationMessage(
            LocalizedConstants.ObjectExplorer.NodeDeletionConfirmation(node.label as string),
            {
                modal: true,
            },
            LocalizedConstants.ObjectExplorer.NodeDeletionConfirmationYes,
        );
        if (response === LocalizedConstants.ObjectExplorer.NodeDeletionConfirmationYes) {
            await this._objectExplorerService.removeNode(node);
            this.refresh(undefined); // Refresh the root node
            await this._connectionManager.connectionStore.removeProfile(
                node.connectionProfile,
                false,
            );
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
        await this._objectExplorerService.removeConnectionNodes(connections);
        this.refresh(undefined);
    }

    public addDisconnectedNode(connectionCredentials: IConnectionProfile): void {
        this._objectExplorerService.addDisconnectedNode(connectionCredentials);
    }

    public deleteChildrenCache(node: TreeNodeInfo): void {
        this._objectExplorerService.deleteChildren(node);
    }

    public get rootNodeConnections(): IConnectionInfo[] {
        return this._objectExplorerService.rootNodeConnections;
    }

    /* Only for testing purposes */
    public set objectExplorerService(value: ObjectExplorerService) {
        this._objectExplorerService = value;
    }
}
