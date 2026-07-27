/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TreeNodeInfo } from "./treeNodeInfo";

/**
 * Builds a short, log-friendly description of a tree node.
 */
export function getNodeDescriptor(node?: vscode.TreeItem): string {
    if (!node) {
        return "<root>";
    }
    if (node instanceof TreeNodeInfo) {
        return `'${node.label}' [TreeNodeInfo] (type=${node.nodeType}, nodePath=${node.nodePath}, sessionId=${node.sessionId}, shouldRefresh=${node.shouldRefresh})`;
    }
    const label =
        typeof node.label === "string"
            ? node.label
            : (node.label?.label ?? node.constructor?.name ?? "unknown");
    return `'${label}' [${node.constructor?.name}]`;
}
