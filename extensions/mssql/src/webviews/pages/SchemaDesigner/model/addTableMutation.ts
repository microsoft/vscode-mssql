/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { buildSchemaFromFlowState } from "./schemaFromFlowState";
import { layoutFlowComponents } from "./flowLayout";
import { buildFlowComponentsFromSchema } from "./schemaToFlowState";
import { FLOW_SPACING, getTableHeight } from "./flowDimensions";

export interface AddTableMutationParams {
    existingNodes: Node<SchemaDesigner.Table>[];
    existingEdges: Edge<SchemaDesigner.ForeignKey>[];
    table: SchemaDesigner.Table;
}

export type AddTableMutationResult =
    | {
          success: false;
      }
    | {
          success: true;
          nodes: Node<SchemaDesigner.Table>[];
          edges: Edge<SchemaDesigner.ForeignKey>[];
          addedNodeId: string;
      };

export function applyAddTableMutation(params: AddTableMutationParams): AddTableMutationResult {
    const { existingNodes, existingEdges, table } = params;

    const schemaModel = buildSchemaFromFlowState(existingNodes, existingEdges);
    schemaModel.tables.push(table);

    const generated = buildFlowComponentsFromSchema(schemaModel);
    const updatedPositions = layoutFlowComponents(generated.nodes, generated.edges);
    const nodeWithPosition = updatedPositions.nodes.find((node) => node.id === table.id);

    if (!nodeWithPosition) {
        return { success: false };
    }

    const edgesForNewTable = updatedPositions.edges.filter(
        (edge) => edge.source === table.id || edge.target === table.id,
    );

    const visibleNodes = existingNodes.filter((node) => node.hidden !== true);

    if (visibleNodes.length === 0) {
        nodeWithPosition.position = {
            x: 100,
            y: 100,
        };
    } else {
        const bottomMostNode = visibleNodes.reduce((prev, current) => {
            const currentBottom = current.position.y + getTableHeight(current.data);
            const prevBottom = prev.position.y + getTableHeight(prev.data);
            return currentBottom > prevBottom ? current : prev;
        });

        nodeWithPosition.position = {
            x: bottomMostNode.position.x,
            y: bottomMostNode.position.y + getTableHeight(bottomMostNode.data) + FLOW_SPACING,
        };
    }

    return {
        success: true,
        nodes: [...existingNodes, nodeWithPosition],
        edges: [...existingEdges, ...edgesForNewTable],
        addedNodeId: nodeWithPosition.id,
    };
}
