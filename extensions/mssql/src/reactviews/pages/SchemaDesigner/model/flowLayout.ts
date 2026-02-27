/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dagre from "@dagrejs/dagre";
import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { FLOW_SPACING, getTableHeight, getTableWidth } from "./flowDimensions";

export interface FlowLayoutOptions {
    rankdir: string;
    marginx: number;
    marginy: number;
    nodesep: number;
    ranksep: number;
}

export const DEFAULT_FLOW_LAYOUT_OPTIONS: FlowLayoutOptions = {
    rankdir: "LR",
    marginx: FLOW_SPACING,
    marginy: FLOW_SPACING,
    nodesep: FLOW_SPACING,
    ranksep: FLOW_SPACING,
};

export function layoutFlowComponents(
    nodes: Node<SchemaDesigner.Table>[],
    edges: Edge<SchemaDesigner.ForeignKey>[],
    options: FlowLayoutOptions = DEFAULT_FLOW_LAYOUT_OPTIONS,
): {
    nodes: Node<SchemaDesigner.Table>[];
    edges: Edge<SchemaDesigner.ForeignKey>[];
} {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph(options);

    for (const node of nodes) {
        if (node.hidden) continue;
        graph.setNode(node.id, {
            width: getTableWidth(),
            height: getTableHeight(node.data),
        });
    }

    for (const edge of edges) {
        if (edge.hidden) continue;
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode?.hidden && !targetNode?.hidden) {
            graph.setEdge(edge.source, edge.target);
        }
    }

    dagre.layout(graph);

    const layoutedNodes = nodes.map((node) => {
        if (node.hidden) return node;
        const dagreNode = graph.node(node.id);
        return {
            ...node,
            position: {
                x: dagreNode.x - getTableWidth() / 2,
                y: dagreNode.y - getTableHeight(node.data) / 2,
            },
        };
    });

    return {
        nodes: layoutedNodes,
        edges,
    };
}
