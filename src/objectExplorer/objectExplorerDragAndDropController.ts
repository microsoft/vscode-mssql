/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TreeNodeInfo } from "./treeNodeInfo";

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
        let objectString = "";
        if (item.metadata) {
            switch (item.metadata.metadataTypeName) {
                case "Table":
                case "StoredProcedure":
                case "View":
                case "UserDefinedFunction":
                    objectString = `[${item.metadata.schema}].[${item.metadata.name}]`;
                    break;
                default:
                    objectString = `[${item.metadata.name}]`;
                    break;
            }
            dataTransfer.set(
                "text/plain",
                new vscode.DataTransferItem(objectString),
            );
        }
    }
}
