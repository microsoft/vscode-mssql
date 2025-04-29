/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "./objectExplorerUtils";

export class ObjectExplorerDragAndDropController
    implements vscode.TreeDragAndDropController<TreeNodeInfo>
{
    // Unique identifier for the drag-and-drop controller
    readonly dropMimeTypes = ["text/plain"];
    readonly dragMimeTypes = ["text/plain"];

    handleDrag(
        source: TreeNodeInfo[],
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): void {
        const item = source[0]; // Handle only the first item for simplicity
        const name = ObjectExplorerUtils.getQualifiedName(item);
        if (name) {
            dataTransfer.set("text/plain", new vscode.DataTransferItem(name));
        }
    }
}
