/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { NodeInfo } from '../models/contracts/objectExplorer/nodeInfo';
import { ObjectExplorerUtils } from './objectExplorerUtils';
import { IConnectionCredentials } from '../models/interfaces';

export class TreeNodeInfo extends vscode.TreeItem {

    private _nodePath: string;
    private _nodeStatus: string;
    private _nodeType: string;
    private _nodeSubType: string;
    private _isLeaf: boolean;
    private _errorMessage: string;
    private _sessionId: string;
    private _parentNode: TreeNodeInfo;
    private _connectionCredentials: IConnectionCredentials;

    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        nodePath: string,
        nodeStatus: string,
        nodeType: string,
        sessionId: string,
        connectionCredentials: IConnectionCredentials,
        parentNode: TreeNodeInfo
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this._nodePath = nodePath;
        this._nodeStatus = nodeStatus;
        this._nodeType = nodeType;
        this._sessionId = sessionId;
        this._parentNode = parentNode;
        this._connectionCredentials = connectionCredentials;
        this.iconPath = ObjectExplorerUtils.iconPath(this.nodeType);
    }

    public static fromNodeInfo(
        nodeInfo: NodeInfo,
        sessionId: string,
        parentNode: TreeNodeInfo,
        connectionCredentials: IConnectionCredentials,
        label?: string): TreeNodeInfo {
        const treeNodeInfo = new TreeNodeInfo(label ? label : nodeInfo.label, nodeInfo.nodeType,
            vscode.TreeItemCollapsibleState.Collapsed, nodeInfo.nodePath, nodeInfo.nodeStatus,
            nodeInfo.nodeType, sessionId, connectionCredentials, parentNode);
        return treeNodeInfo;
    }

    /** Getters */
    public get nodePath(): string {
        return this._nodePath;
    }

    public get nodeStatus(): string {
        return this._nodeStatus;
    }

    public get nodeType(): string {
        return this._nodeType;
    }

    public get sessionId(): string {
        return this._sessionId;
    }

    public get nodeSubType(): string {
        return this._nodeSubType;
    }

    public get isLeaf(): boolean {
        return this._isLeaf;
    }

    public get errorMessage(): string {
        return this._errorMessage;
    }

    public get parentNode(): TreeNodeInfo {
        return this._parentNode;
    }

    public get connectionCredentials(): IConnectionCredentials {
        return this._connectionCredentials;
    }

    /** Setters */
    public set nodePath(value: string) {
        this._nodePath = value;
    }

    public set nodeStatus(value: string) {
        this._nodeStatus = value;
    }

    public set nodeType(value: string) {
        this._nodeType = value;
    }

    public set nodeSubType(value: string) {
        this._nodeSubType = value;
    }

    public set isLeaf(value: boolean) {
        this._isLeaf = value;
    }

    public set errorMessage(value: string) {
        this._errorMessage = value;
    }

    public set sessionId(value: string) {
        this._sessionId = value;
    }

    public set parentNode(value: TreeNodeInfo) {
        this._parentNode = value;
    }

    public set connectionCredentials(value: IConnectionCredentials) {
        this._connectionCredentials = value;
    }
}
