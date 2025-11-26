/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import { TreeNodeInfo } from "./treeNodeInfo";
import { IConnectionGroup } from "../../models/interfaces";

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
     * @param child The child node to add.
     */
    public addChild(child: TreeNodeInfo): void {
        // Insert connection groups first, then other nodes, both alphabetically
        const isChildConnectionGroup = child instanceof ConnectionGroupNode;

        const index = this.children.findIndex((c) => {
            const isCurrentConnectionGroup = c instanceof ConnectionGroupNode;

            if (isChildConnectionGroup === isCurrentConnectionGroup) {
                return c.label.toString().localeCompare(child.label.toString()) > 0;
            }

            return isChildConnectionGroup && !isCurrentConnectionGroup;
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
