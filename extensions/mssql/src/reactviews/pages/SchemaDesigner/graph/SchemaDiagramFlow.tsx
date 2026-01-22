/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
    ConnectionLineType,
} from "@xyflow/react";
import { SchemaDesignerTableNode } from "./schemaDesignerTableNode.js";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

import "@xyflow/react/dist/style.css";
import "./schemaDesignerFlowColors.css";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner.js";
import { flowUtils, foreignKeyUtils, namingUtils } from "../schemaDesignerUtils.js";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Toast,
    ToastBody,
    Toaster,
    ToastTitle,
    useId,
    useToastController,
} from "@fluentui/react-components";
import eventBus from "../schemaDesignerEvents.js";
import { v4 as uuidv4 } from "uuid";
import { locConstants } from "../../../common/locConstants.js";
import {
    useStyledEdgesForDiff,
    useGhostNodes,
    useGhostEdges,
    useTableRenameInfo,
} from "../diffViewer/diffViewerContext.js";

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

    // Context for schema data
    const context = useContext(SchemaDesignerContext);

    // State for nodes and edges
    const [schemaNodes, setSchemaNodes, onNodesChange] = useNodesState<Node<SchemaDesigner.Table>>(
        [],
    );
    const [relationshipEdges, setRelationshipEdges, onEdgesChange] = useEdgesState<
        Edge<SchemaDesigner.ForeignKey>
    >([]);

    // Get ghost nodes and edges for deleted element visualization (T014, T018)
    const ghostNodes = useGhostNodes();
    const ghostEdges = useGhostEdges();
    const tableRenameInfo = useTableRenameInfo();
    // fkModificationType is used inside useStyledEdgesForDiff via context

    // Merge real nodes with ghost nodes for display (T014, T015)
    const displayNodes = useMemo(() => {
        if (ghostNodes.length === 0) {
            // Pass rename info to existing nodes
            if (Object.keys(tableRenameInfo).length === 0) {
                return schemaNodes;
            }
            return schemaNodes.map((node) => {
                const rename = tableRenameInfo[node.id];
                if (rename) {
                    return {
                        ...node,
                        data: { ...node.data, renameInfo: rename },
                    };
                }
                return node;
            });
        }

        // Convert ghost nodes to ReactFlow nodes with deleted styling
        const ghostReactFlowNodes: Node<
            SchemaDesigner.Table & {
                isGhostNode?: boolean;
                renameInfo?: SchemaDesigner.RenameDisplayInfo;
            }
        >[] = ghostNodes.map((ghost) => ({
            id: ghost.id,
            type: "tableNode",
            position: ghost.originalPosition,
            data: { ...ghost, isGhostNode: true },
            className: "schema-node--ghost",
            selectable: false,
            draggable: false,
        }));

        // Add rename info to existing nodes
        const nodesWithRename = schemaNodes.map((node) => {
            const rename = tableRenameInfo[node.id];
            if (rename) {
                return {
                    ...node,
                    data: { ...node.data, renameInfo: rename },
                };
            }
            return node;
        });

        return [...nodesWithRename, ...ghostReactFlowNodes];
    }, [schemaNodes, ghostNodes, tableRenameInfo]);

    // Merge real edges with ghost edges for display (T018)
    const displayEdges = useMemo(() => {
        if (ghostEdges.length === 0) {
            return relationshipEdges;
        }

        // Convert ghost edges to ReactFlow edges with deleted styling (T019)
        const ghostReactFlowEdges: Edge<SchemaDesigner.ForeignKey & { isGhostEdge: boolean }>[] =
            ghostEdges.map((ghost) => ({
                id: ghost.id,
                source: ghost.sourceTableId,
                target: ghost.targetTableId,
                sourceHandle: `${ghost.sourceColumn}-source`,
                targetHandle: `${ghost.targetColumn}-target`,
                markerEnd: { type: MarkerType.ArrowClosed },
                data: { ...ghost.fkData, isGhostEdge: true },
                className: "schema-edge--ghost",
                style: {
                    stroke: "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
                    strokeWidth: 2,
                    strokeDasharray: "5 3",
                    opacity: 0.7,
                },
            }));

        return [...relationshipEdges, ...ghostReactFlowEdges];
    }, [relationshipEdges, ghostEdges]);

    // Apply diff indicator styles to edges (including ghost edges)
    const styledEdges = useStyledEdgesForDiff(displayEdges);

    const deleteNodeConfirmationPromise = useRef<
        ((value: boolean | PromiseLike<boolean>) => void) | undefined
    >(undefined);

    const [open, setOpen] = useState(false);

    useEffect(() => {
        const intialize = async () => {
            try {
                const { nodes, edges } = await context.initializeSchemaDesigner();
                setSchemaNodes(nodes);
                setRelationshipEdges(edges);
            } catch (error) {
                context.log?.(`Failed to initialize schema designer: ${String(error)}`);
                setSchemaNodes([]);
                setRelationshipEdges([]);
            }
        };
        void intialize();
    }, [context.initializationRequestId]);

    /**
     * Displays an error toast notification
     * @param {string} errorMessage - The error message to display
     */
    const showErrorNotification = (errorMessage: string) =>
        dispatchToast(
            <Toast appearance="inverted">
                <ToastTitle>Failed to create foreign key</ToastTitle>
                <ToastBody>{errorMessage}</ToastBody>
            </Toast>,
            { pauseOnHover: true, intent: "error" },
        );

    /**
     * Handles new connections between nodes
     * @param {Connection} params - Connection parameters
     */
    const handleConnect = (params: Connection) => {
        const sourceNode = schemaNodes.find((node) => node.id === params.source);
        const targetNode = schemaNodes.find((node) => node.id === params.target);

        if (!sourceNode || !targetNode || !params.sourceHandle || !params.targetHandle) {
            return;
        }

        const sourceColumnName = foreignKeyUtils.extractColumnNameFromHandle(params.sourceHandle);
        const targetColumnName = foreignKeyUtils.extractColumnNameFromHandle(params.targetHandle);

        const sourceColumn = sourceNode.data.columns.find((c) => c.name === sourceColumnName);
        const targetColumn = targetNode.data.columns.find((c) => c.name === targetColumnName);

        if (!sourceColumn || !targetColumn) {
            return;
        }

        const schema = flowUtils.extractSchemaModel(schemaNodes, relationshipEdges);

        const existingForeignKeys = foreignKeyUtils.extractForeignKeysFromEdges(
            relationshipEdges,
            sourceNode.data.id,
            schema,
        );

        // Create the foreign key data
        const foreignKeyData = foreignKeyUtils.createForeignKeyFromConnection(
            sourceNode,
            targetNode,
            sourceColumn.name,
            targetColumn.name,
            uuidv4(),
            namingUtils.getNextForeignKeyName(existingForeignKeys, schema.tables),
        );

        // Create the edge data from foreign key
        const newEdge: Edge<SchemaDesigner.ForeignKey> = {
            id: `${sourceNode.id}-${targetNode.id}-${sourceColumn.name}-${targetColumn.name}`,
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: params.sourceHandle,
            targetHandle: params.targetHandle,
            markerEnd: {
                type: MarkerType.ArrowClosed,
            },
            data: foreignKeyData,
            type: sourceNode.id === targetNode.id ? ConnectionLineType.SmoothStep : undefined, // Use SmoothStep for self-references
        };

        setRelationshipEdges((eds) => addEdge(newEdge, eds));

        // Update create script
        eventBus.emit("getScript");
        eventBus.emit("pushState");
    };

    /**
     * Handles the end of a connection attempt
     * @param {Event} _event - The connection event
     * @param {FinalConnectionState} connectionState - The final connection state
     */
    const handleConnectEnd = (_event: Event, connectionState: FinalConnectionState) => {
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
            const sourceColumnName = foreignKeyUtils.extractColumnNameFromHandle(
                connectionState.fromHandle.id,
            );
            const targetColumnName = foreignKeyUtils.extractColumnNameFromHandle(
                connectionState.toHandle.id,
            );

            const potentialForeignKey = foreignKeyUtils.createForeignKeyFromConnection(
                connectionState.fromNode as unknown as Node<SchemaDesigner.Table>,
                connectionState.toNode as unknown as Node<SchemaDesigner.Table>,
                sourceColumnName,
                targetColumnName,
            );

            // Validate the foreign key
            const validationResult = foreignKeyUtils.isForeignKeyValid(
                flowUtils.extractSchemaModel(schemaNodes, relationshipEdges).tables,
                connectionState.fromNode.data as SchemaDesigner.Table,
                potentialForeignKey,
            );

            // Show error if invalid
            if (validationResult.errorMessage) {
                showErrorNotification(validationResult.errorMessage);
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
        const validationResult = foreignKeyUtils.validateConnection(
            connection,
            schemaNodes,
            relationshipEdges,
        );

        return validationResult.isValid;
    };

    const deleteElementsConfirmation = async () => {
        setOpen(true);
        const dialogResponse = await new Promise<boolean>((resolve) => {
            deleteNodeConfirmationPromise.current = resolve;
        });
        return dialogResponse;
    };

    return (
        <div style={{ width: "100%", height: "100%" }}>
            <Toaster toasterId={toasterId} position="top-end" />
            <ReactFlow
                nodes={displayNodes}
                edges={styledEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onConnectEnd={handleConnectEnd}
                onlyRenderVisibleElements={context.renderOnlyVisibleTables}
                proOptions={{
                    hideAttribution: true,
                }}
                isValidConnection={validateConnection}
                connectionMode={ConnectionMode.Loose}
                onDelete={() => {
                    eventBus.emit("getScript");
                    eventBus.emit("pushState");
                }}
                onNodeDragStop={() => {
                    eventBus.emit("pushState");
                }}
                onBeforeDelete={async (props) => {
                    if (props.nodes.length === 0 && props.edges.length === 0) {
                        return true;
                    }
                    return await deleteElementsConfirmation();
                }}
                minZoom={0.05}
                fitView>
                <Controls />
                <MiniMap pannable zoomable />
                <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
            </ReactFlow>
            <Dialog
                open={open}
                onOpenChange={(_event, data) => {
                    setOpen(data.open);
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{locConstants.schemaDesigner.deleteConfirmation}</DialogTitle>
                        <DialogContent>
                            {locConstants.schemaDesigner.deleteConfirmationContent}
                        </DialogContent>

                        <DialogActions>
                            <DialogTrigger disableButtonEnhancement>
                                <Button
                                    appearance="primary"
                                    onClick={() => {
                                        if (!deleteNodeConfirmationPromise.current) {
                                            return;
                                        }
                                        deleteNodeConfirmationPromise.current(true);
                                    }}>
                                    {locConstants.schemaDesigner.delete}
                                </Button>
                            </DialogTrigger>
                            <DialogTrigger disableButtonEnhancement>
                                <Button
                                    appearance="secondary"
                                    onClick={() => {
                                        if (!deleteNodeConfirmationPromise.current) {
                                            return;
                                        }
                                        deleteNodeConfirmationPromise.current(false);
                                    }}>
                                    {locConstants.schemaDesigner.cancel}
                                </Button>
                            </DialogTrigger>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};
