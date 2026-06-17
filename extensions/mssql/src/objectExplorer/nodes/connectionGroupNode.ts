/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import { TreeNodeInfo } from "./treeNodeInfo";
import { IConnectionGroup, IConnectionProfile } from "../../models/interfaces";

export const CONNECTION_GROUP_NODE_TYPE = "ConnectionGroup";

const defaultDarkColor = "#424242";
const defaultLightColor = "#F6F6F6";

/**
 * Represents a server group node in the Object Explorer.
 * This class extends the TreeNodeInfo class and adds functionality specific to server groups.
 * It contains a list of child nodes and methods to manage them.
 */
export class ConnectionGroupNode extends TreeNodeInfo {
    public children: TreeNodeInfo[];
    private _connectionGroup: IConnectionGroup;

    constructor(
        connectionGroup: IConnectionGroup,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState
            .Expanded,
    ) {
        super(
            connectionGroup.name,
            createConnectionGroupContextValue(),
            collapsibleState,
            connectionGroup.id,
            undefined,
            CONNECTION_GROUP_NODE_TYPE,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
        );

        this.children = [];
        this.id = connectionGroup.id;
        this._connectionGroup = connectionGroup;
        this.iconPath = this.getIcon();
        this.tooltip = connectionGroup.description;
    }

    private getIcon(): vscode.IconPath {
        const self = this;
        function constructSvg(lightTheme: boolean): string {
            const fgColor =
                self._connectionGroup.color ?? (lightTheme ? defaultLightColor : defaultDarkColor);
            const borderColor = lightTheme ? defaultDarkColor : defaultLightColor;
            const svgContent = `<svg width="16" height="16" viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><rect id="canvas" x="0" y="0" width="16" height="16" style="fill:${borderColor};fill-opacity:0;fill-rule:nonzero;"/><path id="outline" d="M13.502,14.998l-10,0c-0.827,0 -1.5,-0.673 -1.5,-1.5l-0,-11.996c-0,-0.827 0.673,-1.5 1.5,-1.5l8,0c0.827,0 1.5,0.673 1.5,1.5l-0,2.886l2,1l-0,8.11c-0,0.827 -0.673,1.5 -1.5,1.5Z" style="fill:${borderColor};fill-rule:nonzero;"/><path id="iconBg" d="M14.002,13.498l-0,-7.492l-2,-1l-0,-3.504c-0,-0.277 -0.224,-0.5 -0.5,-0.5l-8,0c-0.276,0 -0.5,0.223 -0.5,0.5l-0,11.996c0,0.275 0.224,0.5 0.5,0.5l10,0c0.276,0 0.5,-0.225 0.5,-0.5Zm-2,-0.496l-0,-6.496l1,0.5l-0,5.996l-1,0Z" style="fill:${fgColor};fill-rule:nonzero;"/><path id="iconFg" d="M13.002,12.998l-1,0l-0,-6.5l1,0.5l-0,6Z" style="fill:${borderColor};fill-rule:nonzero;"/></svg>`;
            return `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
        }

        return {
            light: vscode.Uri.parse(constructSvg(true)),
            dark: vscode.Uri.parse(constructSvg(false)),
        };
    }

    /**
     * Returns a **copy** of the node's connection information.
     *
     * ⚠️ Note: This is a **shallow copy**; modifying the returned object will NOT affect the original connection group.
     * If you want to update the actual connection group stored in the node, use the `updateConnectionGroup` method instead.
     */
    public get connectionGroup(): IConnectionGroup {
        if (!this._connectionGroup) {
            return undefined;
        }
        return {
            ...this._connectionGroup,
        };
    }

    /**
     * Adds a child node to the server group.
     *
     * Ordering precedence:
     *   1. Groups always come before connections
     *   2. Items with `order` set always come before items with it unset
     *   3. Items with order set are sorted from lowest to highest
     *   4. Items without `order` set or with equal `order` values are sorted alphabetically (case-insensitive)
     */
    public addChild(child: TreeNodeInfo): void {
        const isChildConnectionGroup = child instanceof ConnectionGroupNode;

        const index = this.children.findIndex((c) => {
            const isCurrentConnectionGroup = c instanceof ConnectionGroupNode;

            if (isChildConnectionGroup !== isCurrentConnectionGroup) {
                // Connection groups always come before non-group children.
                return isChildConnectionGroup && !isCurrentConnectionGroup;
            }

            return compareOrderedNodes(c, child) > 0;
        });

        if (index === -1) {
            this.children.push(child);
            return;
        }
        this.children.splice(index, 0, child);
    }

    /**
     * Removes a child node from the server group.
     * @param child The child node to remove.
     */
    public removeChild(child: TreeNodeInfo): void {
        const index = this.children.indexOf(child);
        if (index > -1) {
            this.children.splice(index, 1);
        }
    }
}

export function createConnectionGroupContextValue(): vscodeMssql.TreeNodeContextValue {
    return {
        type: CONNECTION_GROUP_NODE_TYPE,
        filterable: false,
        hasFilters: false,
        subType: "",
    };
}

/**
 * Returns the effective sort `order` value for a tree node, or `undefined` if the node has no valid order.
 */
function getNodeOrder(node: TreeNodeInfo): number | undefined {
    let candidate: unknown;
    if (node instanceof ConnectionGroupNode) {
        candidate = node.connectionGroup?.order;
    } else if (node.connectionProfile) {
        candidate = (node.connectionProfile as IConnectionProfile).order;
    }

    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
        return candidate;
    }

    // invalid values (negative, NaN, non-numeric) are treated as unordered
    return undefined;
}

/**
 * Compares two tree nodes of the same kind (both groups or both non-groups):
 *   1. The `order` property (ordered nodes first, ascending), then
 *   2. alphabetically (case-insensitive) by label.
 */
export function compareOrderedNodes(a: TreeNodeInfo, b: TreeNodeInfo): number {
    const orderA = getNodeOrder(a);
    const orderB = getNodeOrder(b);

    if (orderA !== undefined && orderB !== undefined) {
        if (orderA !== orderB) {
            return orderA - orderB;
        }
    } else if (orderA !== undefined) {
        return -1;
    } else if (orderB !== undefined) {
        return 1;
    }

    return a.label.toString().toLowerCase().localeCompare(b.label.toString().toLowerCase());
}
