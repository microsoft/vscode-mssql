/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export interface DeleteTableMutationParams {
    tableId: string;
    existingNodes: Node<SchemaDesigner.Table>[];
    skipConfirmation: boolean;
}

export type DeleteTableMutationResult =
    | {
          success: false;
      }
    | {
          success: true;
          nodeToDelete: Node<SchemaDesigner.Table>;
          shouldSkipDeleteConfirmation: boolean;
      };

export function applyDeleteTableMutation(
    params: DeleteTableMutationParams,
): DeleteTableMutationResult {
    const { tableId, existingNodes, skipConfirmation } = params;

    const nodeToDelete = existingNodes.find((node) => node.id === tableId);
    if (!nodeToDelete) {
        return { success: false };
    }

    return {
        success: true,
        nodeToDelete,
        shouldSkipDeleteConfirmation: skipConfirmation,
    };
}
