/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import { ConnectionNode } from "./nodes/connectionNode";
import { ConnectionGroupNodeInfo } from "./nodes/connectionGroupNode";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getErrorMessage } from "../utils/utils";
import { ConnectionStore } from "../models/connectionStore";

interface ObjectExplorerDragMetadata {
    name: string;
    isConnectionOrGroup: boolean;
    type?: "connection" | "group";
    id?: string;
}

const OE_MIME_TYPE = "application/vnd.code.tree.objectExplorer";
const TEXT_MIME_TYPE = "text/plain";

export class ObjectExplorerDragAndDropController
    implements vscode.TreeDragAndDropController<TreeNodeInfo>
{
    readonly dragMimeTypes = [OE_MIME_TYPE, TEXT_MIME_TYPE];
    readonly dropMimeTypes = [OE_MIME_TYPE];

    private readonly logger: Logger;

    constructor(
        vscodeWrapper: VscodeWrapper,
        private connectionStore: ConnectionStore,
    ) {
        this.logger = Logger.create(vscodeWrapper.outputChannel, "DragAndDrop");
    }

    handleDrag(
        source: TreeNodeInfo[],
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): void {
        const item = source[0]; // Handle only the first item for simplicity

        if (item instanceof ConnectionNode || item instanceof ConnectionGroupNodeInfo) {
            const dragData: ObjectExplorerDragMetadata = {
                name: item.label.toString(),
                type: item instanceof ConnectionNode ? "connection" : "group",
                id:
                    item instanceof ConnectionNode
                        ? item.connectionProfile.id
                        : item.connectionGroup.id,
                isConnectionOrGroup: true,
            };
            dataTransfer.set(OE_MIME_TYPE, new vscode.DataTransferItem(dragData));
            dataTransfer.set(
                TEXT_MIME_TYPE,
                new vscode.DataTransferItem(ObjectExplorerUtils.getQualifiedName(item)),
            );
        } else {
            dataTransfer.set(
                TEXT_MIME_TYPE,
                new vscode.DataTransferItem(ObjectExplorerUtils.getQualifiedName(item)),
            );
        }
    }

    async handleDrop(
        target: TreeNodeInfo | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const dragData: ObjectExplorerDragMetadata = await dataTransfer.get(OE_MIME_TYPE)?.value;
        if (!dragData) {
            return;
        }

        try {
            if (dragData.isConnectionOrGroup && dragData.type && dragData.id) {
                if (target instanceof ConnectionGroupNodeInfo || target === undefined) {
                    let targetInfo: { label: string; id: string };

                    // If the target is undefined, we're dropping onto the root of the Object Explorer
                    if (target === undefined) {
                        targetInfo = {
                            label: "ROOT",
                            id: this.connectionStore.connectionConfig.getRootGroup().id,
                        };
                    } else {
                        targetInfo = {
                            label: target.label.toString(),
                            id: target.id,
                        };
                    }

                    this.logger.verbose(
                        `Dragged ${dragData.type} '${dragData.name}' (ID: ${dragData.id}) onto group '${targetInfo.label}' (ID: ${targetInfo.id})`,
                    );

                    if (dragData.type === "connection") {
                        const conn = await this.connectionStore.connectionConfig.getConnectionById(
                            dragData.id,
                        );
                        conn.groupId = targetInfo.id;
                        await this.connectionStore.connectionConfig.updateConnection(conn);
                    } else {
                        const group = this.connectionStore.connectionConfig.getGroupById(
                            dragData.id,
                        );
                        group.parentId = targetInfo.id;
                        await this.connectionStore.connectionConfig.updateGroup(group);
                    }
                }
            }
        } catch (err) {
            this.logger.error("Failed to parse drag metadata:", getErrorMessage(err));
            // TODO: telemetry
        }
    }
}
