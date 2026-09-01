/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The vscode edge of OE v2: converts pure OeV2Node records to TreeItems.
 * All tree logic lives in the pure controller — this file owns ONLY the
 * vscode.TreeDataProvider surface, icon resolution, and context values.
 */

import * as vscode from "vscode";
import { ObjectExplorerUtils } from "../objectExplorerUtils";
import { OeV2Node } from "./tree/oeV2Node";
import { nodeContextValue } from "./tree/oeV2NodeFactory";
import { OeV2TreeController } from "./tree/oeV2TreeController";

export class ObjectExplorerV2Provider implements vscode.TreeDataProvider<OeV2Node> {
    private changeEmitter = new vscode.EventEmitter<OeV2Node | undefined>();
    readonly onDidChangeTreeData = this.changeEmitter.event;
    private controllerSubscription: { dispose(): void };

    constructor(readonly controller: OeV2TreeController) {
        this.controllerSubscription = controller.onDidChange((node) =>
            this.changeEmitter.fire(node),
        );
    }

    getTreeItem(node: OeV2Node): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            node.collapsible
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.id;
        item.contextValue = nodeContextValue(node);
        if (node.description) {
            item.description = node.description;
        }
        if (node.tooltip) {
            item.tooltip = node.tooltip;
        }
        if (node.kind === "loading") {
            item.iconPath = new vscode.ThemeIcon("loading~spin");
        } else if (node.kind === "connectingConnection") {
            // B27: connecting connections spin like loading children do.
            item.iconPath = new vscode.ThemeIcon("loading~spin");
        } else if (node.kind === "status") {
            item.iconPath = new vscode.ThemeIcon("info");
        } else if (node.kind === "error") {
            item.iconPath = new vscode.ThemeIcon("error");
        } else if (node.kind === "connectionGroup") {
            // Classic parity (dogfood 2026-07-10, screens/colors.png): groups
            // render their color as a tinted folder icon, not a plain glyph.
            item.iconPath = tintedGroupIcon(node.color);
        } else if (node.icon) {
            item.iconPath = ObjectExplorerUtils.iconPath(node.icon);
        }
        return item;
    }

    getChildren(node?: OeV2Node): Promise<OeV2Node[]> {
        return this.controller.children(node);
    }

    dispose(): void {
        this.controllerSubscription.dispose();
        this.changeEmitter.dispose();
    }
}

/**
 * Tinted group-folder icon — the classic connection-group SVG recipe (same
 * geometry as objectExplorer/nodes/connectionGroupNode.ts, which OE v2 may
 * not import — lint boundary), colored with the group's color and themed
 * border. Cached per color; groups without a color get theme defaults.
 */
const GROUP_ICON_DEFAULT_DARK = "#424242";
const GROUP_ICON_DEFAULT_LIGHT = "#F6F6F6";
const groupIconCache = new Map<string, { light: vscode.Uri; dark: vscode.Uri }>();

function tintedGroupIcon(color: string | undefined): { light: vscode.Uri; dark: vscode.Uri } {
    const key = color ?? "";
    let icon = groupIconCache.get(key);
    if (icon) {
        return icon;
    }
    const svg = (lightTheme: boolean): vscode.Uri => {
        const fgColor = color ?? (lightTheme ? GROUP_ICON_DEFAULT_LIGHT : GROUP_ICON_DEFAULT_DARK);
        const borderColor = lightTheme ? GROUP_ICON_DEFAULT_DARK : GROUP_ICON_DEFAULT_LIGHT;
        const svgContent = `<svg width="16" height="16" viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><rect id="canvas" x="0" y="0" width="16" height="16" style="fill:${borderColor};fill-opacity:0;fill-rule:nonzero;"/><path id="outline" d="M13.502,14.998l-10,0c-0.827,0 -1.5,-0.673 -1.5,-1.5l-0,-11.996c-0,-0.827 0.673,-1.5 1.5,-1.5l8,0c0.827,0 1.5,0.673 1.5,1.5l-0,2.886l2,1l-0,8.11c-0,0.827 -0.673,1.5 -1.5,1.5Z" style="fill:${borderColor};fill-rule:nonzero;"/><path id="iconBg" d="M14.002,13.498l-0,-7.492l-2,-1l-0,-3.504c-0,-0.277 -0.224,-0.5 -0.5,-0.5l-8,0c-0.276,0 -0.5,0.223 -0.5,0.5l-0,11.996c0,0.275 0.224,0.5 0.5,0.5l10,0c0.276,0 0.5,-0.225 0.5,-0.5Zm-2,-0.496l-0,-6.496l1,0.5l-0,5.996l-1,0Z" style="fill:${fgColor};fill-rule:nonzero;"/><path id="iconFg" d="M13.002,12.998l-1,0l-0,-6.5l1,0.5l-0,6Z" style="fill:${borderColor};fill-rule:nonzero;"/></svg>`;
        return vscode.Uri.parse(
            `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`,
        );
    };
    icon = { light: svg(true), dark: svg(false) };
    groupIconCache.set(key, icon);
    return icon;
}
