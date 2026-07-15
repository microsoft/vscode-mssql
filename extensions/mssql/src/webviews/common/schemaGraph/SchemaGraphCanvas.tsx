/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral schema graph canvas (SV-R3; addendum §10.2). A thin
 * React Flow shell driven ENTIRELY by props — the hosting page owns state,
 * layout, filtering, and instrumentation. Read-only by contract in P0:
 * nodes drag (view arrangement), nothing connects, nothing deletes.
 */

import { useMemo } from "react";
import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    MarkerType,
    MiniMap,
    ReactFlow,
    type Edge,
    type Node,
    type NodeTypes,
    type OnNodesChange,
    type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./schemaGraphFlowColors.css";
import { SchemaGraphTableNode } from "./SchemaGraphTableNode";
import { SchemaGraphTableData } from "./schemaGraphTypes";

export const SCHEMA_GRAPH_TABLE_NODE_TYPE = "schemaGraphTable";

export interface SchemaGraphCanvasProps {
    nodes: Node<SchemaGraphTableData>[];
    edges: Edge[];
    /** Controlled node changes (drag positions, selection). */
    onNodesChange?: OnNodesChange<Node<SchemaGraphTableData>>;
    onSelectionChange?: OnSelectionChangeFunc;
    onNodeDoubleClick?: (nodeId: string) => void;
    /** Fired once React Flow finished its initial render (ready marker). */
    onInitialized?: () => void;
    children?: React.ReactNode;
}

export const SchemaGraphCanvas = (props: SchemaGraphCanvasProps) => {
    const nodeTypes: NodeTypes = useMemo(
        () => ({ [SCHEMA_GRAPH_TABLE_NODE_TYPE]: SchemaGraphTableNode }),
        [],
    );
    return (
        <ReactFlow
            nodes={props.nodes}
            edges={props.edges}
            nodeTypes={nodeTypes}
            onNodesChange={props.onNodesChange}
            onSelectionChange={props.onSelectionChange}
            onNodeDoubleClick={(_event, node) => props.onNodeDoubleClick?.(node.id)}
            onInit={() => props.onInitialized?.()}
            connectionMode={ConnectionMode.Loose}
            nodesConnectable={false}
            nodesDraggable={true}
            deleteKeyCode={null}
            fitView
            minZoom={0.05}
            defaultEdgeOptions={{
                markerEnd: { type: MarkerType.ArrowClosed },
                // Legacy parity: default bezier (curved) edges at width 1
                // (schemaGraphFlowColors.css); smoothstep read as heavy
                // orthogonal wiring next to the old designer.
            }}
            proOptions={{ hideAttribution: true }}>
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} />
            {props.children}
        </ReactFlow>
    );
};
