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
    useReactFlow,
} from "@xyflow/react";
import { SchemaDesignerTableNode } from "./schemaDesignerTableNode.js";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

import "@xyflow/react/dist/style.css";
import "./schemaDesignerFlowColors.css";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner.js";
import eventBus, {
    extractSchemaModel,
    isForeignKeyValid,
} from "../schemaDesignerUtils.js";
import {
    Toast,
    ToastBody,
    Toaster,
    ToastTitle,
    useId,
    useToastController,
} from "@fluentui/react-components";
import { v4 as uuidv4 } from "uuid";

// Component configuration
const NODE_TYPES: NodeTypes = {
    tableNode: SchemaDesignerTableNode,
};

/**
 * Schema Designer Flow Component
 * Renders a visual editor for database schema relationships using ReactFlow
 */
export const SchemaDesignerFlow = () => {
    // Toast notification setup
    const toasterId = useId("toaster");
    const { dispatchToast } = useToastController(toasterId);

    const reactFlow = useReactFlow();

    // Context for schema data
    const context = useContext(SchemaDesignerContext);

    // State for nodes and edges
    const [schemaNodes, setSchemaNodes, onNodesChange] = useNodesState<
        Node<SchemaDesigner.Table>
    >([]);
    const [relationshipEdges, setRelationshipEdges, onEdgesChange] =
        useEdgesState<Edge<SchemaDesigner.ForeignKey>>([]);

    useEffect(() => {
        const intialize = async () => {
            const { nodes, edges } = await context.initializeSchemaDesigner();
            setSchemaNodes(nodes);
            setRelationshipEdges(edges);
        };
        void intialize();
    }, []);

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
                    : uuidv4(),
                columns: [sourceColumn.name],
                referencedSchemaName: targetNode.data.schema,
                referencedTableName: targetNode.data.name,
                referencedColumns: [targetColumn.name],
                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            },
        };

        // Update create script
        eventBus.emit("getScript");

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
                extractSchemaModel(schemaNodes, relationshipEdges).tables,
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
            extractSchemaModel(schemaNodes, relationshipEdges).tables,
            sourceTable.data,
            foreignKey,
        );

        return validationResult.isValid;
    };

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
                onDelete={() => {
                    eventBus.emit("getScript");
                }}
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
