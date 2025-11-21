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
import {
  TelemetryActions,
  TelemetryViews,
} from "../sharedInterfaces/telemetry";

interface ObjectExplorerDragMetadata {
  name: string;
  isConnectionOrGroup: boolean;
  type?: "connection" | "connectionGroup";
  id?: string;
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
        isConnectionOrGroup: true,
      };
      dataTransfer.set(OE_MIME_TYPE, new vscode.DataTransferItem(dragData));
      if (item instanceof ConnectionNode) {
        dataTransfer.set(
          TEXT_MIME_TYPE,
          new vscode.DataTransferItem(
            ObjectExplorerUtils.getQualifiedName(item),
          ),
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
    const dragData: ObjectExplorerDragMetadata =
      await dataTransfer.get(OE_MIME_TYPE)?.value;
    if (!dragData) {
      return;
    }

    try {
      if (dragData.isConnectionOrGroup && dragData.type && dragData.id) {
        if (target instanceof ConnectionGroupNode || target === undefined) {
          let targetInfo: { label: string; id: string };

          // If the target is undefined, we're dropping onto the root of the Object Explorer
          if (target === undefined) {
            targetInfo = {
              label: "ROOT",
              id: this.connectionStore.rootGroupId,
            };
          } else {
            targetInfo = {
              label: target.label.toString(),
              id: target.id,
            };
          }

          this._logger.verbose(
            `Dragged ${dragData.type} '${dragData.name}' (ID: ${dragData.id}) onto group '${targetInfo.label}' (ID: ${targetInfo.id})`,
          );

          if (dragData.type === "connection") {
            const conn =
              await this.connectionStore.connectionConfig.getConnectionById(
                dragData.id,
              );
            conn.groupId = targetInfo.id;
            await this.connectionStore.connectionConfig.updateConnection(conn);
          } else {
            const group = this.connectionStore.connectionConfig.getGroupById(
              dragData.id,
            );

            if (group.id === targetInfo.id) {
              this._logger.verbose("Cannot move group into itself; skipping.");
              return;
            }

            group.parentId = targetInfo.id;
            await this.connectionStore.connectionConfig.updateGroup(group);
          }

          sendActionEvent(
            TelemetryViews.ObjectExplorer,
            TelemetryActions.DragAndDrop,
            {
              dragType: dragData.type,
              dropTarget: target ? "connectionGroup" : "ROOT",
            },
          );
        }
      }
    } catch (err) {
      this._logger.error(
        "Failed to parse drag metadata:",
        getErrorMessage(err),
      );
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
}
