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
    useReactFlow,
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
import eventBus from "../schemaDesignerEvents";
import { v4 as uuidv4 } from "uuid";
import { locConstants } from "../../../common/locConstants.js";

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

    const reactFlow = useReactFlow();

    const refreshRafId = useRef<number | undefined>(undefined);

    const deleteNodeConfirmationPromise = useRef<
        ((value: boolean | PromiseLike<boolean>) => void) | undefined
    >(undefined);

    const [open, setOpen] = useState(false);

    const highlightedEdges = useMemo(() => {
        const highlightClass = "schema-designer-edge-added";
        let didChange = false;
        const nextEdges = relationshipEdges.map((edge) => {
            const foreignKeyId = edge.data?.id;
            const shouldHighlight =
                context.isChangesPanelVisible &&
                !!foreignKeyId &&
                context.newForeignKeyIds.has(foreignKeyId);

            const baseClass = edge.className?.split(/\s+/).filter(Boolean) ?? [];
            const classSet = new Set(baseClass);

            if (shouldHighlight) {
                classSet.add(highlightClass);
            } else {
                classSet.delete(highlightClass);
            }

            const nextClassName = classSet.size > 0 ? Array.from(classSet).join(" ") : undefined;
            if (nextClassName === edge.className) {
                return edge;
            }

            didChange = true;
            return { ...edge, className: nextClassName };
        });

        return didChange ? nextEdges : relationshipEdges;
    }, [context.isChangesPanelVisible, context.newForeignKeyIds, relationshipEdges]);

    useEffect(() => {
        const intialize = async () => {
            try {
                const { nodes, edges } = await context.initializeSchemaDesigner();
                setSchemaNodes(nodes);
                setRelationshipEdges(edges);

                // Trigger script generation to update the changes panel
                // This is necessary for restored sessions that may have changes
                setTimeout(() => {
                    eventBus.emit("getScript");
                }, 0);
            } catch (error) {
                context.log?.(`Failed to initialize schema designer: ${String(error)}`);
                setSchemaNodes([]);
                setRelationshipEdges([]);
            }
        };
        void intialize();
    }, [context.initializationRequestId]);

    // Keep the local controlled state in sync with programmatic updates done via useReactFlow() elsewhere.
    useEffect(() => {
        const refresh = () => {
            if (refreshRafId.current !== undefined) {
                cancelAnimationFrame(refreshRafId.current);
            }

            // ReactFlow's store updates can lag the caller's setNodes/setEdges;
            // defer to the next frame so we read the updated store.
            refreshRafId.current = requestAnimationFrame(() => {
                refreshRafId.current = undefined;
                setSchemaNodes(reactFlow.getNodes() as Node<SchemaDesigner.Table>[]);
                setRelationshipEdges(reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[]);
            });
        };

        eventBus.on("refreshFlowState", refresh);
        return () => {
            eventBus.off("refreshFlowState", refresh);

            if (refreshRafId.current !== undefined) {
                cancelAnimationFrame(refreshRafId.current);
                refreshRafId.current = undefined;
            }
        };
    }, [reactFlow, setSchemaNodes, setRelationshipEdges]);

    // Reveal/highlight foreign key edges in the graph.
    useEffect(() => {
        const revealForeignKeyEdges = (foreignKeyId: string) => {
            if (!foreignKeyId) {
                return;
            }

            const edgesFromStore = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
            const matchingEdges = edgesFromStore.filter((e) => e.data?.id === foreignKeyId);

            if (matchingEdges.length === 0) {
                return;
            }

            // Select all edges for this FK (FKs can be multi-column -> multiple edges)
            const updatedEdges = edgesFromStore.map((e) => ({
                ...e,
                selected: e.data?.id === foreignKeyId,
            }));
            setRelationshipEdges(updatedEdges);

            // Center the viewport between the first FK edge's source/target tables
            const first = matchingEdges[0];
            const srcNode = reactFlow.getNode(first.source) as Node<SchemaDesigner.Table>;
            const tgtNode = reactFlow.getNode(first.target) as Node<SchemaDesigner.Table>;

            if (srcNode && tgtNode) {
                const width = flowUtils.getTableWidth();
                const srcHeight = flowUtils.getTableHeight(srcNode.data);
                const tgtHeight = flowUtils.getTableHeight(tgtNode.data);

                const srcCx = srcNode.position.x + width / 2;
                const srcCy = srcNode.position.y + srcHeight / 2;
                const tgtCx = tgtNode.position.x + width / 2;
                const tgtCy = tgtNode.position.y + tgtHeight / 2;

                void reactFlow.setCenter((srcCx + tgtCx) / 2, (srcCy + tgtCy) / 2, {
                    zoom: 1,
                    duration: 500,
                });
            }
        };

        eventBus.on("revealForeignKeyEdges", revealForeignKeyEdges);

        const clearEdgeSelection = () => {
            const edgesFromStore = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
            const updatedEdges = edgesFromStore.map((e) => ({
                ...e,
                selected: false,
            }));
            setRelationshipEdges(updatedEdges);
        };

        eventBus.on("clearEdgeSelection", clearEdgeSelection);

        return () => {
            eventBus.off("revealForeignKeyEdges", revealForeignKeyEdges);
            eventBus.off("clearEdgeSelection", clearEdgeSelection);
        };
    }, [reactFlow, setRelationshipEdges]);

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

        const sourceColumnId = foreignKeyUtils.extractColumnIdFromHandle(params.sourceHandle);
        const targetColumnId = foreignKeyUtils.extractColumnIdFromHandle(params.targetHandle);

        const sourceColumn = sourceNode.data.columns.find((c) => c.id === sourceColumnId);
        const targetColumn = targetNode.data.columns.find((c) => c.id === targetColumnId);

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
            id: `${sourceNode.id}-${targetNode.id}-${sourceColumn.id}-${targetColumn.id}`,
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
            const sourceColumnId = foreignKeyUtils.extractColumnIdFromHandle(
                connectionState.fromHandle.id,
            );
            const targetColumnId = foreignKeyUtils.extractColumnIdFromHandle(
                connectionState.toHandle.id,
            );

            const sourceColumnName =
                (connectionState.fromNode.data as SchemaDesigner.Table).columns.find(
                    (c) => c.id === sourceColumnId,
                )?.name ?? "";
            const targetColumnName =
                (connectionState.toNode.data as SchemaDesigner.Table).columns.find(
                    (c) => c.id === targetColumnId,
                )?.name ?? "";

            if (!sourceColumnName || !targetColumnName) {
                return;
            }

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
                nodes={schemaNodes}
                edges={highlightedEdges}
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
