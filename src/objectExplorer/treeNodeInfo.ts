/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import { NodeInfo } from "../models/contracts/objectExplorer/nodeInfo";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import * as Constants from "../constants/constants";
import { IConnectionInfo, ITreeNodeInfo, ObjectMetadata } from "vscode-mssql";

export class TreeNodeInfo extends vscode.TreeItem implements ITreeNodeInfo {
    private _nodePath: string;
    private _nodeStatus: string;
    private _nodeType: string;
    private _nodeSubType: string;
    private _isLeaf: boolean;
    private _errorMessage: string;
    private _sessionId: string;
    private _parentNode: TreeNodeInfo;
    private _connectionInfo: IConnectionInfo;
    private _metadata: ObjectMetadata;
    private _filterableProperties: vscodeMssql.NodeFilterProperty[];
    private _filters: vscodeMssql.NodeFilter[];
    private _originalLabel: string;

    constructor(
        label: string,
        context: vscodeMssql.TreeNodeContextValue,
        collapsibleState: vscode.TreeItemCollapsibleState,
        nodePath: string,
        nodeStatus: string,
        nodeType: string,
        sessionId: string,
        connectionInfo: IConnectionInfo,
        parentNode: TreeNodeInfo,
        filterProperties: vscodeMssql.NodeFilterProperty[],
        objectMetadata?: ObjectMetadata,
        filters?: vscodeMssql.NodeFilter[],
    ) {
        super(label, collapsibleState);
        this._originalLabel = label;
        this.context = context;
        this._nodePath = nodePath;
        this._nodeStatus = nodeStatus;
        this._nodeType = nodeType;
        this._sessionId = sessionId;
        this._parentNode = parentNode;
        this._connectionInfo = connectionInfo;
        this._filterableProperties = filterProperties;
        this._metadata = objectMetadata;
        this._filters = filters;
        this.iconPath = ObjectExplorerUtils.iconPath(this.nodeType);
    }

    public static fromNodeInfo(
        nodeInfo: NodeInfo,
        sessionId: string,
        parentNode: TreeNodeInfo,
        connectionInfo: IConnectionInfo,
        label?: string,
        nodeType?: string,
    ): TreeNodeInfo {
        let type = nodeType ? nodeType : nodeInfo.nodeType;

        const treeNodeInfo = new TreeNodeInfo(
            label ? label : nodeInfo.label,
            {
                type: type,
                filterable: nodeInfo.filterableProperties?.length > 0,
                hasFilters: false,
                subType: nodeInfo.objectType,
            },
            nodeInfo.isLeaf
                ? vscode.TreeItemCollapsibleState.None
                : type === Constants.serverLabel
                  ? vscode.TreeItemCollapsibleState.Expanded
                  : vscode.TreeItemCollapsibleState.Collapsed,
            nodeInfo.nodePath,
            nodeInfo.nodeStatus,
            type,
            sessionId,
            connectionInfo,
            parentNode,
            nodeInfo.filterableProperties,
            nodeInfo.metadata,
        );
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

    public get connectionInfo(): IConnectionInfo {
        return this._connectionInfo;
    }

    public get metadata(): ObjectMetadata {
        return this._metadata;
    }

    public get filterableProperties(): vscodeMssql.NodeFilterProperty[] {
        return this._filterableProperties;
    }

    public get context(): vscodeMssql.TreeNodeContextValue {
        return this._convertToTreeNodeContext(this.contextValue);
    }

    public get filters(): vscodeMssql.NodeFilter[] {
        return this._filters;
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
        this._updateContextValue();
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

    public set connectionInfo(value: IConnectionInfo) {
        this._connectionInfo = value;
    }

    public set filterableProperties(value: vscodeMssql.NodeFilterProperty[]) {
        this._filterableProperties = value;
        this._updateContextValue();
    }

    public set filters(value: vscodeMssql.NodeFilter[]) {
        this._filters = value;
        this._updateContextValue();
        this.label =
            value.length > 0
                ? vscode.l10n.t("{0} (filtered)", this._originalLabel)
                : this._originalLabel;
    }

    public set context(value: vscodeMssql.TreeNodeContextValue) {
        this.contextValue = this._convertToContextValue(value);
    }

    private _updateContextValue() {
        const contextValue = this.context;
        contextValue.filterable = this.filterableProperties?.length > 0;
        contextValue.hasFilters = this.filters?.length > 0;
        this.context = contextValue;
    }

    //split the context value with, and is in the form of key=value and convert it to TreeNodeContextValue
    private _convertToTreeNodeContext(
        contextValue: string,
    ): vscodeMssql.TreeNodeContextValue {
        let contextArray = contextValue.split(",");
        let context: vscodeMssql.TreeNodeContextValue = {
            filterable: false,
            hasFilters: false,
            type: undefined,
            subType: undefined,
        };
        contextArray.forEach((element) => {
            let keyValuePair = element.split("=");
            context[keyValuePair[0]] = keyValuePair[1];
        });
        return context;
    }

    //convert TreeNodeContextValue to context value string
    private _convertToContextValue(
        context: vscodeMssql.TreeNodeContextValue,
    ): string {
        if (context === undefined) {
            return "";
        }
        let contextValue = "";
        Object.keys(context).forEach((key) => {
            contextValue += key + "=" + context[key] + ",";
        });
        return contextValue;
    }
}
