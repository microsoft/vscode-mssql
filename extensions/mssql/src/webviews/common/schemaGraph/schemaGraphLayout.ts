/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral Dagre layout (SV-R3; addendum §11.2). Pure function over
 * plain layout facts → positions map. Fixes the legacy A-13 hazard: edge
 * wiring resolves nodes through a prebuilt Map (O(1)), never a per-edge
 * `nodes.find` scan (O(N·E) freezes on large catalogs).
 *
 * Dagre itself is synchronous and non-slicable — CANCELLATION AND SIZE
 * POLICY LIVE AT THE CALLER (§11.3): gate by rendered-node count before
 * calling, and treat a worker as the escalation path if measured budgets
 * demand it (§11.4). This module stays a pure math kernel.
 */

import * as dagre from "@dagrejs/dagre";
import {
    schemaGraphTableHeight,
    schemaGraphTableWidth,
    SCHEMA_GRAPH_SPACING,
} from "./schemaGraphDimensions";

export interface SchemaGraphLayoutNode {
    id: string;
    columnCount: number;
    hidden?: boolean;
}

export interface SchemaGraphLayoutEdge {
    sourceId: string;
    targetId: string;
    hidden?: boolean;
}

export interface SchemaGraphLayoutOptions {
    rankdir: "LR" | "TB" | "RL" | "BT";
    marginx: number;
    marginy: number;
    nodesep: number;
    ranksep: number;
}

export const DEFAULT_SCHEMA_GRAPH_LAYOUT_OPTIONS: SchemaGraphLayoutOptions = {
    rankdir: "LR",
    marginx: SCHEMA_GRAPH_SPACING,
    marginy: SCHEMA_GRAPH_SPACING,
    nodesep: SCHEMA_GRAPH_SPACING,
    ranksep: SCHEMA_GRAPH_SPACING,
};

export interface SchemaGraphPosition {
    x: number;
    y: number;
}

/**
 * Returns top-left positions for every VISIBLE node (hidden nodes are not
 * in the result — callers keep their previous positions, which preserves
 * stable placement across filter toggles keyed by stable node ids).
 */
export function layoutSchemaGraph(
    nodes: readonly SchemaGraphLayoutNode[],
    edges: readonly SchemaGraphLayoutEdge[],
    options: SchemaGraphLayoutOptions = DEFAULT_SCHEMA_GRAPH_LAYOUT_OPTIONS,
): Map<string, SchemaGraphPosition> {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph(options);

    // O(1) visibility lookups — built once (A-13 fix).
    const visibleById = new Map<string, SchemaGraphLayoutNode>();
    for (const node of nodes) {
        if (node.hidden === true) {
            continue;
        }
        visibleById.set(node.id, node);
        graph.setNode(node.id, {
            width: schemaGraphTableWidth(),
            height: schemaGraphTableHeight(node.columnCount),
        });
    }
    for (const edge of edges) {
        if (edge.hidden === true) {
            continue;
        }
        if (visibleById.has(edge.sourceId) && visibleById.has(edge.targetId)) {
            graph.setEdge(edge.sourceId, edge.targetId);
        }
    }

    dagre.layout(graph);

    const positions = new Map<string, SchemaGraphPosition>();
    for (const [id, node] of visibleById) {
        const dagreNode = graph.node(id);
        positions.set(id, {
            x: dagreNode.x - schemaGraphTableWidth() / 2,
            y: dagreNode.y - schemaGraphTableHeight(node.columnCount) / 2,
        });
    }
    return positions;
}
