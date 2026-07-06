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
        } else if (node.kind === "status") {
            item.iconPath = new vscode.ThemeIcon("info");
        } else if (node.kind === "error") {
            item.iconPath = new vscode.ThemeIcon("error");
        } else if (node.kind === "connectionGroup") {
            item.iconPath = new vscode.ThemeIcon("folder");
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
