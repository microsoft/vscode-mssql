/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import {
    ReactFlow,
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    BackgroundVariant,
    Connection,
    NodeTypes,
    MarkerType,
    ConnectionMode,
    type Node,
    type Edge,
    addEdge,
    FinalConnectionState,
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
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner.js";
import { isForeignKeyValid } from "../schemaDesignerUtils.js";
import {
    Toast,
    ToastBody,
    Toaster,
    ToastTitle,
    useId,
    useToastController,
} from "@fluentui/react-components";

// Component configuration
const NODE_TYPES: NodeTypes = {
    tableNode: SchemaDesignerTableNode,
};

// Graph layout configuration
const LAYOUT_CONFIG = {
    rankdir: "LR",
    marginx: 50,
    marginy: 50,
    nodesep: 50,
    ranksep: 50,
};

const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

/**
 * Schema Designer Flow Component
 * Renders a visual editor for database schema relationships using ReactFlow
 */
export const SchemaDesignerFlow = () => {
    // Toast notification setup
    const toasterId = useId("toaster");
    const { dispatchToast } = useToastController(toasterId);

    // Context for schema data
    const context = useContext(SchemaDesignerContext);

    // State for nodes and edges
    const [schemaNodes, setSchemaNodes, onNodesChange] = useNodesState<
        Node<SchemaDesigner.Table>
    >([]);
    const [relationshipEdges, setRelationshipEdges, onEdgesChange] =
        useEdgesState<Edge<SchemaDesigner.ForeignKey>>([]);

    /**
     * Displays an error toast notification
     * @param {string} errorMessage - The error message to display
     */
    const showErrorNotification = (errorMessage: string) =>
        dispatchToast(
            <Toast>
                <ToastTitle>Failed to create foreign key</ToastTitle>
                <ToastBody>{errorMessage}</ToastBody>
            </Toast>,
            { pauseOnHover: true, intent: "error" },
        );

    /**
     * Extracts the schema model from the current nodes and edges
     * @returns {SchemaDesigner.Schema} The current schema model
     */
    const extractSchemaModel = (): SchemaDesigner.Schema => {
        // Create tables without foreign keys initially
        const tables = schemaNodes.map((node) => {
            const tableData = { ...node.data };
            tableData.foreignKeys = [];
            return tableData;
        });

        // Process edges to create foreign keys
        relationshipEdges.forEach((edge) => {
            const sourceNode = schemaNodes.find(
                (node) => node.id === edge.source,
            );
            const targetNode = schemaNodes.find(
                (node) => node.id === edge.target,
            );
            if (!sourceNode || !targetNode) {
                return;
            }
            const edgeData = edge.data as SchemaDesigner.ForeignKey;
            if (!edgeData) {
                return;
            }

            const foreignKey: SchemaDesigner.ForeignKey = {
                id: edgeData.id,
                name: edgeData.name,
                columns: edgeData.columns,
                referencedSchemaName: edgeData.referencedSchemaName,
                referencedTableName: edgeData.referencedTableName,
                referencedColumns: edgeData.referencedColumns,
                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            };

            // Check if we already have a foreign key to this table
            const existingForeignKey = sourceNode.data.foreignKeys.find(
                (fk) =>
                    fk.referencedTableName === foreignKey.referencedTableName &&
                    fk.referencedSchemaName === foreignKey.referencedSchemaName,
            );

            if (existingForeignKey) {
                // Add the new column to the existing foreign key
                existingForeignKey.columns.push(foreignKey.columns[0]);
                existingForeignKey.referencedColumns.push(
                    foreignKey.referencedColumns[0],
                );
            } else {
                // Add as new foreign key
                sourceNode.data.foreignKeys.push(foreignKey);
            }
        });

        return {
            tables: tables,
        };
    };

    /**
     * Extract column name from a handle ID
     * @param {string} handleId - The handle ID
     * @returns {string} The column name
     */
    const extractColumnNameFromHandle = (handleId: string) => {
        return handleId.replace("left-", "").replace("right-", "");
    };

    /**
     * Handles new connections between nodes
     * @param {Connection} params - Connection parameters
     */
    const handleConnect = (params: Connection) => {
        const sourceNode = schemaNodes.find(
            (node: any) => node.id === params.source,
        );
        const targetNode = schemaNodes.find(
            (node: any) => node.id === params.target,
        );
        if (!sourceNode || !targetNode) {
            return;
        }
        if (!params.sourceHandle || !params.targetHandle) {
            return;
        }

        const sourceColumnName = extractColumnNameFromHandle(
            params.sourceHandle,
        );
        const targetColumnName = extractColumnNameFromHandle(
            params.targetHandle,
        );

        const sourceColumn = sourceNode.data.columns.find(
            (c) => c.name === sourceColumnName,
        );

        const targetColumn = targetNode.data.columns.find(
            (c) => c.name === targetColumnName,
        );
        if (!sourceColumn || !targetColumn) {
            return;
        }

        // Check if there's already a foreign key between these tables
        const existingForeignKey = relationshipEdges.find(
            (edge) =>
                edge.source === sourceNode.id && edge.target === targetNode.id,
        );

        // Create the new edge with foreign key data
        const newEdge: Edge<SchemaDesigner.ForeignKey> = {
            id: `${sourceNode.id}-${targetNode.id}-${sourceColumn.name}-${targetColumn.name}`,
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: params.sourceHandle,
            targetHandle: params.targetHandle,
            markerEnd: {
                type: MarkerType.ArrowClosed,
            },
            data: {
                name: existingForeignKey
                    ? (existingForeignKey.data?.name ?? "")
                    : `FK_${sourceNode.data.name}_${targetNode.data.name}`,
                id: existingForeignKey
                    ? (existingForeignKey.data?.id ?? "")
                    : "",
                columns: [sourceColumn.name],
                referencedSchemaName: targetNode.data.schema,
                referencedTableName: targetNode.data.name,
                referencedColumns: [targetColumn.name],
                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            },
        };

        setRelationshipEdges((eds) => addEdge(newEdge, eds));
    };

    /**
     * Handles the end of a connection attempt
     * @param {Event} _event - The connection event
     * @param {FinalConnectionState} connectionState - The final connection state
     */
    const handleConnectEnd = (
        _event: Event,
        connectionState: FinalConnectionState,
    ) => {
        if (!connectionState.isValid) {
            if (
                !connectionState.fromHandle ||
                !connectionState.toHandle ||
                !connectionState.fromNode ||
                !connectionState.toNode ||
                !connectionState.fromHandle.id ||
                !connectionState.toHandle.id
            ) {
                return;
            }

            // Create a test foreign key to validate
            const potentialForeignKey: SchemaDesigner.ForeignKey = {
                id: "",
                name: "random",
                columns: [
                    extractColumnNameFromHandle(connectionState.fromHandle.id),
                ],
                referencedSchemaName: connectionState.toNode.data
                    .schema as string,
                referencedTableName: connectionState.toNode.data.name as string,
                referencedColumns: [
                    extractColumnNameFromHandle(connectionState.toHandle.id),
                ],
                onDeleteAction: SchemaDesigner.OnAction.CASCADE,
                onUpdateAction: SchemaDesigner.OnAction.CASCADE,
            };

            // Validate the foreign key
            const validationResult = isForeignKeyValid(
                extractSchemaModel().tables,
                connectionState.fromNode.data as SchemaDesigner.Table,
                potentialForeignKey,
            );

            // Show error if invalid
            if (validationResult.errorMessage) {
                showErrorNotification(validationResult.errorMessage ?? "");
            }
        }
    };

    /**
     * Validates if a connection is valid
     * @param {Connection | Edge} connection - The connection to validate
     * @returns {boolean} Whether the connection is valid
     */
    const validateConnection = (
        connection: Connection | Edge<SchemaDesigner.ForeignKey>,
    ): boolean => {
        const sourceTable = schemaNodes.find(
            (node) => node.id === connection.source,
        ) as Node<SchemaDesigner.Table>;
        const targetTable = schemaNodes.find(
            (node) => node.id === connection.target,
        ) as Node<SchemaDesigner.Table>;

        if (!sourceTable || !targetTable) {
            return false;
        }

        const sourceColumnName = connection.sourceHandle
            ? extractColumnNameFromHandle(connection.sourceHandle)
            : connection.sourceHandle;
        const targetColumnName = connection.targetHandle
            ? extractColumnNameFromHandle(connection.targetHandle)
            : connection.targetHandle;

        if (!sourceColumnName || !targetColumnName) {
            return false;
        }

        // Create a foreign key for validation
        const foreignKey: SchemaDesigner.ForeignKey = {
            id: "",
            name: `FK_${sourceTable.data.name}_${targetTable.data.name}`,
            columns: [sourceColumnName],
            referencedSchemaName: targetTable.data.schema,
            referencedTableName: targetTable.data.name,
            referencedColumns: [targetColumnName],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        // Validate the foreign key relationship
        const validationResult = isForeignKeyValid(
            extractSchemaModel().tables,
            sourceTable.data,
            foreignKey,
        );

        return validationResult.isValid;
    };

    /**
     * Load and layout the schema data
     */
    useEffect(() => {
        const schema = context?.schema;
        if (!schema) {
            return;
        }

        // Configure the dagre graph
        dagreGraph.setGraph(LAYOUT_CONFIG);

        // Create nodes from tables
        let tableNodes = schema.tables.map((table) => ({
            id: table.id,
            type: "tableNode",
            data: { ...table },
        }));

        // Add nodes and edges to dagre for layout calculations
        tableNodes.forEach((node) => {
            dagreGraph.setNode(node.id, {
                width: calculateTableWidth(),
                height: calculateTableHeight(node.data),
            });

            // Add edges for foreign keys
            node.data.foreignKeys.forEach((foreignKey) => {
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

        // Calculate layout
        dagre.layout(dagreGraph);

        // Apply positions to nodes
        const positionedNodes = tableNodes.map((node) => {
            const nodeWithPosition = dagreGraph.node(node.id);
            const newNode: Node<SchemaDesigner.Table> = {
                ...node,
                // Convert dagre center position to React Flow top-left position
                position: {
                    x: nodeWithPosition.x - calculateTableWidth() / 2,
                    y: nodeWithPosition.y - calculateTableHeight(node.data) / 2,
                },
            };
            return newNode;
        });

        setSchemaNodes(positionedNodes);

        // Create edges for ReactFlow
        const relationshipEdges: Edge<SchemaDesigner.ForeignKey>[] = [];
        schema.tables.forEach((table) => {
            table.foreignKeys.forEach((foreignKey) => {
                const targetTable = schema.tables.find(
                    (t) =>
                        t.name === foreignKey.referencedTableName &&
                        t.schema === foreignKey.referencedSchemaName,
                );

                if (!targetTable) return;

                // Create an edge for each column in the foreign key
                foreignKey.columns.forEach((column, index) => {
                    const sourceHandle = `right-${column}`;
                    const targetHandle = `left-${foreignKey.referencedColumns[index]}`;

                    relationshipEdges.push({
                        id: `${table.name}-${targetTable.name}-${column}-${foreignKey.referencedColumns[index]}`,
                        source: table.id,
                        target: targetTable.id,
                        sourceHandle: sourceHandle,
                        targetHandle: targetHandle,
                        markerEnd: {
                            type: MarkerType.ArrowClosed,
                        },
                        data: {
                            name: foreignKey.name,
                            id: foreignKey.id,
                            columns: [column],
                            referencedSchemaName:
                                foreignKey.referencedSchemaName,
                            referencedTableName: foreignKey.referencedTableName,
                            referencedColumns: [
                                foreignKey.referencedColumns[index],
                            ],
                            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                        },
                    });
                });
            });
        });

        setRelationshipEdges(relationshipEdges);
    }, [context?.schema]);

    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <Toaster toasterId={toasterId} />
            <ReactFlow
                nodes={schemaNodes}
                edges={relationshipEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onConnectEnd={handleConnectEnd}
                proOptions={{
                    hideAttribution: true,
                }}
                isValidConnection={validateConnection}
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
