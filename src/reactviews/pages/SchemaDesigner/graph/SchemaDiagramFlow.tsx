/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect } from "react";
import {
    ReactFlow,
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    BackgroundVariant,
    Connection,
    NodeTypes,
    MarkerType,
    ConnectionMode,
} from "@xyflow/react";
import { SchemaDesignerTableNode } from "./schemaDesignerTableNode.js";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import dagre from "@dagrejs/dagre";

import "@xyflow/react/dist/style.css";
import "./schemaDesignerFlowColors.css";
import {
    calculateTableHeight,
    calculateTableWidth,
} from "./schemaDesignerFlowConstants.js";

const nodeTypes: NodeTypes = {
    tableNode: SchemaDesignerTableNode,
};
const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

export const SchemaDesignerFlow = () => {
    const context = useContext(SchemaDesignerContext);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    );

    useEffect(() => {
        const schema = context?.schema;
        if (!schema) {
            return;
        }

        dagreGraph.setGraph({
            rankdir: "LR",
            marginx: 50,
            marginy: 50,
            nodesep: 50,
            ranksep: 50,
        });

        let tableNodes = schema.tables.map((table) => ({
            id: table.id,
            type: "tableNode",
            data: { ...table },
        }));
        tableNodes.forEach((node) => {
            dagreGraph.setNode(node.id, {
                width: calculateTableWidth(),
                height: calculateTableHeight(node.data),
            });

            const foreignKeys = node.data.foreignKeys;
            foreignKeys.forEach((foreignKey) => {
                const targetTable = schema.tables.find(
                    (table) =>
                        table.name === foreignKey.referencedTableName &&
                        table.schema === foreignKey.referencedSchemaName,
                );
                if (targetTable) {
                    dagreGraph.setEdge(node.id, targetTable.id);
                }
            });
        });

        dagre.layout(dagreGraph);

        const newNodes = tableNodes.map((node) => {
            const nodeWithPosition = dagreGraph.node(node.id);
            const newNode = {
                ...node,
                targetPosition: "left",
                sourcePosition: "right",
                // We are shifting the dagre node position (anchor=center center) to the top left
                // so it matches the React Flow node anchor point (top left).
                position: {
                    x: nodeWithPosition.x - calculateTableWidth() / 2,
                    y: nodeWithPosition.y - calculateTableHeight(node.data) / 2,
                },
            };
            return newNode;
        });

        setNodes(newNodes as any);

        const edges: any = [];
        schema.tables.forEach((table) => {
            const foreignKeys = table.foreignKeys;
            foreignKeys.forEach((foreignKey) => {
                const targetTable = schema.tables.find(
                    (t) =>
                        t.name === foreignKey.referencedTableName &&
                        t.schema === foreignKey.referencedSchemaName,
                );
                foreignKey.columns.forEach((column, index) => {
                    const sourceHandle = `column-out-${column}`;
                    const targetHandle = `column-in-${foreignKey.referencedColumns[index]}`;
                    if (targetTable) {
                        edges.push({
                            id: `${table.name}-${targetTable.name}-${column}-${foreignKey.referencedColumns[index]}`,
                            source: table.id,
                            target: targetTable.id,
                            sourceHandle: sourceHandle,
                            targetHandle: targetHandle,
                            markerEnd: {
                                type: MarkerType.ArrowClosed,
                            },
                        });
                    }
                });
            });
        });
        console.log("edges", edges);
        setEdges(edges as any);
    }, [context?.schema]);

    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                proOptions={{
                    hideAttribution: true,
                }}
                connectionMode={ConnectionMode.Loose}
                fitView
            >
                <Controls />
                <MiniMap pannable zoomable />
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={12}
                    size={1}
                />
            </ReactFlow>
        </div>
    );
};
