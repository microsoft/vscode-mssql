/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import { ConnectionNode } from "./nodes/connectionNode";
import { ConnectionGroupNode } from "./nodes/connectionGroupNode";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getErrorMessage } from "../utils/utils";
import { ConnectionStore } from "../models/connectionStore";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ConnectionConfig } from "../connectionconfig/connectionconfig";
import { ObjectExplorerOrderingStore } from "./objectExplorerOrderingStore";
import { AddConnectionTreeNode } from "./nodes/addConnectionTreeNode";
import { NewDeploymentTreeNode } from "../deployment/newDeploymentTreeNode";

interface ObjectExplorerDragMetadata {
    name: string;
    isConnectionOrGroup: boolean;
    type?: "connection" | "connectionGroup";
    id?: string;
    /** Parent group ID at the time the drag started. ROOT_GROUP_ID for items at the root. */
    parentId?: string;
}

const OE_MIME_TYPE = "application/vnd.code.tree.objectExplorer";
const TEXT_MIME_TYPE = "text/plain";

export class ObjectExplorerDragAndDropController
    implements vscode.TreeDragAndDropController<TreeNodeInfo>
{
    readonly dragMimeTypes = [OE_MIME_TYPE, TEXT_MIME_TYPE];
    readonly dropMimeTypes = [OE_MIME_TYPE];

    private readonly _logger: Logger;

    constructor(
        vscodeWrapper: VscodeWrapper,
        private connectionStore: ConnectionStore,
        private orderingStore?: ObjectExplorerOrderingStore,
        private refreshTree?: () => void,
    ) {
        this._logger = Logger.create(vscodeWrapper.outputChannel, "DragAndDrop");
    }

    public handleDrag(
        source: TreeNodeInfo[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): void {
        const item = source[0]; // Handle only the first item for simplicity

        if (item instanceof ConnectionNode || item instanceof ConnectionGroupNode) {
            const dragData: ObjectExplorerDragMetadata = {
                name: item.label.toString(),
                type: item instanceof ConnectionNode ? "connection" : "connectionGroup",
                id:
                    item instanceof ConnectionNode
                        ? item.connectionProfile.id
                        : item.connectionGroup.id,
                parentId:
                    item instanceof ConnectionNode
                        ? item.connectionProfile.groupId
                        : (item.connectionGroup.parentId ?? ConnectionConfig.ROOT_GROUP_ID),
                isConnectionOrGroup: true,
            };
            dataTransfer.set(OE_MIME_TYPE, new vscode.DataTransferItem(dragData));
            if (item instanceof ConnectionNode) {
                dataTransfer.set(
                    TEXT_MIME_TYPE,
                    new vscode.DataTransferItem(ObjectExplorerUtils.getQualifiedName(item)),
                );
            }
        } else {
            dataTransfer.set(
                TEXT_MIME_TYPE,
                new vscode.DataTransferItem(ObjectExplorerUtils.getQualifiedName(item)),
            );
        }
    }

    public async handleDrop(
        target: TreeNodeInfo | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const dragData: ObjectExplorerDragMetadata = await dataTransfer.get(OE_MIME_TYPE)?.value;
        if (!dragData) {
            return;
        }

        try {
            if (!dragData.isConnectionOrGroup || !dragData.type || !dragData.id) {
                return;
            }

            // Empty groups render "Add Connection" / "New Deployment" placeholder rows
            // as their only children. A drop on one of those rows should behave as a
            // drop on the owning (empty) group.
            if (
                target instanceof AddConnectionTreeNode ||
                target instanceof NewDeploymentTreeNode
            ) {
                const owningGroup = target.parentNode;
                target = owningGroup instanceof ConnectionGroupNode ? owningGroup : undefined;
            }

            // Decide whether this drop is a "move into a container" or a "reorder".
            // - drop on undefined (root) → move into root container (append)
            // - drop on a ConnectionGroupNode that is NOT a sibling → move into that group
            // - drop on a ConnectionGroupNode that IS a sibling → reorder before the target group
            // - drop on a ConnectionNode → reorder before the target connection
            //   (and reparent if it lives in a different group)
            const draggedParentId = dragData.parentId ?? ConnectionConfig.ROOT_GROUP_ID;

            if (target === undefined) {
                await this.moveIntoContainer(dragData, ConnectionConfig.ROOT_GROUP_ID, "ROOT");
            } else if (target instanceof ConnectionGroupNode) {
                const targetParentId =
                    target.connectionGroup.parentId ?? ConnectionConfig.ROOT_GROUP_ID;
                const isSibling = targetParentId === draggedParentId;

                if (isSibling) {
                    // Reorder among siblings: place dragged item immediately before the target group.
                    await this.reorderBefore(dragData, target.connectionGroup.id, targetParentId);
                } else {
                    await this.moveIntoContainer(
                        dragData,
                        target.connectionGroup.id,
                        target.label.toString(),
                    );
                }
            } else if (target instanceof ConnectionNode) {
                // Connections are leaves, so dropping on one always means "reorder before this connection
                // within its parent group" (reparenting if necessary).
                const targetParentId =
                    target.connectionProfile.groupId ?? ConnectionConfig.ROOT_GROUP_ID;
                await this.reorderBefore(dragData, target.connectionProfile.id, targetParentId);
            }
        } catch (err) {
            this._logger.error("Failed to handle drag-and-drop:", getErrorMessage(err));
            sendErrorEvent(
                TelemetryViews.ObjectExplorer,
                TelemetryActions.DragAndDrop,
                err,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    dragType: dragData.type,
                    dropTarget: target ? "connectionGroup" : "ROOT",
                },
            );
        }
    }

    /**
     * Moves the dragged connection or group into the specified container group.
     * Position within the container falls back to the default alphabetical sort
     * unless the user later reorders explicitly.
     */
    private async moveIntoContainer(
        dragData: ObjectExplorerDragMetadata,
        targetGroupId: string,
        targetLabel: string,
    ): Promise<void> {
        const draggedParentId = dragData.parentId ?? ConnectionConfig.ROOT_GROUP_ID;

        this._logger.verbose(
            `Dragged ${dragData.type} '${dragData.name}' (ID: ${dragData.id}) into group '${targetLabel}' (ID: ${targetGroupId})`,
        );

        if (dragData.type === "connection") {
            const conn = await this.connectionStore.connectionConfig.getConnectionById(
                dragData.id!,
            );
            if (!conn) {
                return;
            }
            if (conn.groupId === targetGroupId) {
                // Already in this container; nothing to do.
                return;
            }
            conn.groupId = targetGroupId;
            await this.connectionStore.connectionConfig.updateConnection(conn);
        } else {
            const group = this.connectionStore.connectionConfig.getGroupById(dragData.id!);
            if (!group) {
                return;
            }
            if (group.id === targetGroupId) {
                this._logger.verbose("Cannot move group into itself; skipping.");
                return;
            }
            if (group.parentId === targetGroupId) {
                return;
            }
            group.parentId = targetGroupId;
            await this.connectionStore.connectionConfig.updateGroup(group);
        }

        // Clear any stale order entry under the previous parent.
        if (this.orderingStore && draggedParentId !== targetGroupId) {
            await this.orderingStore.removeFromParent(draggedParentId, dragData.id!);
        }

        sendActionEvent(TelemetryViews.ObjectExplorer, TelemetryActions.DragAndDrop, {
            dragType: dragData.type!,
            dropTarget:
                targetGroupId === ConnectionConfig.ROOT_GROUP_ID ? "ROOT" : "connectionGroup",
            mode: "move",
        });

        // The settings write triggers onDidChangeConfiguration → tree refresh, so no
        // explicit refresh is needed here.
    }

    /**
     * Reorders the dragged item to sit immediately before `anchorId` within
     * `targetParentId`. If the dragged item currently lives in a different parent,
     * it is also reparented.
     */
    private async reorderBefore(
        dragData: ObjectExplorerDragMetadata,
        anchorId: string,
        targetParentId: string,
    ): Promise<void> {
        if (dragData.id === anchorId) {
            // Dropped onto itself; nothing to do.
            return;
        }
        if (dragData.type === "connectionGroup" && dragData.id === targetParentId) {
            this._logger.verbose("Cannot reorder a group into itself; skipping.");
            return;
        }

        const draggedParentId = dragData.parentId ?? ConnectionConfig.ROOT_GROUP_ID;
        let configChanged = false;

        // If the dragged item lives in a different parent group, reparent it first.
        if (draggedParentId !== targetParentId) {
            if (dragData.type === "connection") {
                const conn = await this.connectionStore.connectionConfig.getConnectionById(
                    dragData.id!,
                );
                if (!conn) {
                    return;
                }
                conn.groupId = targetParentId;
                await this.connectionStore.connectionConfig.updateConnection(conn);
                configChanged = true;
            } else {
                const group = this.connectionStore.connectionConfig.getGroupById(dragData.id!);
                if (!group) {
                    return;
                }
                group.parentId = targetParentId;
                await this.connectionStore.connectionConfig.updateGroup(group);
                configChanged = true;
            }

            if (this.orderingStore) {
                await this.orderingStore.removeFromParent(draggedParentId, dragData.id!);
            }
        }

        if (this.orderingStore) {
            await this.orderingStore.insertAdjacent(
                targetParentId,
                dragData.id!,
                anchorId,
                "before",
            );
        }

        this._logger.verbose(
            `Reordered ${dragData.type} '${dragData.name}' (ID: ${dragData.id}) before '${anchorId}' in group '${targetParentId}'`,
        );

        sendActionEvent(TelemetryViews.ObjectExplorer, TelemetryActions.DragAndDrop, {
            dragType: dragData.type!,
            dropTarget:
                targetParentId === ConnectionConfig.ROOT_GROUP_ID ? "ROOT" : "connectionGroup",
            mode: "reorder",
        });

        // If we only updated global state (no settings write), the configuration change
        // listener won't fire — so refresh the tree explicitly.
        if (!configChanged) {
            this.refreshTree?.();
        }
    }
}
