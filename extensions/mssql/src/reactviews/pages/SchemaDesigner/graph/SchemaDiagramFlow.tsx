/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState, useMemo } from "react";
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
import { diffUtils, flowUtils, foreignKeyUtils, namingUtils } from "../schemaDesignerUtils.js";
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
import eventBus, { type SchemaDesignerToast } from "../schemaDesignerEvents.js";
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

    // Shared toast handler (used by undo validations, etc.)
    useEffect(() => {
        const handleToast = (toast: SchemaDesignerToast) => {
            dispatchToast(
                <Toast appearance="inverted">
                    <ToastTitle>{toast.title}</ToastTitle>
                    <ToastBody>{toast.body}</ToastBody>
                </Toast>,
                { pauseOnHover: true, intent: toast.intent ?? "info" },
            );
        };

        eventBus.on("showToast", handleToast);
        return () => {
            eventBus.off("showToast", handleToast);
        };
    }, [dispatchToast]);

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
            id: `${foreignKeyData.id}-${sourceColumn.name}-${targetColumn.name}`,
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

    // Compute nodes with diff classes when diff view is enabled
    const nodesWithDiffClasses = useMemo(() => {
        if (!context.isDiffViewEnabled || !context.originalSchema) {
            // When diff view is disabled, ensure we strip any diff classes from nodes
            return schemaNodes.map((node) => {
                if (
                    node.className &&
                    (node.className.includes("diff-table-added") ||
                        node.className.includes("diff-table-modified") ||
                        node.className.includes("diff-table-deleted"))
                ) {
                    return {
                        ...node,
                        className: node.className
                            .replace(/diff-table-added/g, "")
                            .replace(/diff-table-modified/g, "")
                            .replace(/diff-table-deleted/g, "")
                            .trim(),
                    };
                }
                return node;
            });
        }

        const schemaDiff = context.getSchemaDiff();
        if (!schemaDiff) {
            return schemaNodes;
        }

        // Add diff classes to existing nodes
        const updatedNodes = schemaNodes.map((node) => {
            const tableDiff = schemaDiff.tableDiffs.find((td) => td.tableId === node.id);
            if (!tableDiff || tableDiff.status === SchemaDesigner.DiffStatus.Unchanged) {
                return node;
            }

            let diffClass = "";
            switch (tableDiff.status) {
                case SchemaDesigner.DiffStatus.Added:
                    diffClass = "diff-table-added";
                    break;
                case SchemaDesigner.DiffStatus.Modified:
                    diffClass = "diff-table-modified";
                    break;
                case SchemaDesigner.DiffStatus.Deleted:
                    diffClass = "diff-table-deleted";
                    break;
            }

            return {
                ...node,
                className: `${node.className || ""} ${diffClass}`.trim(),
            };
        });

        // Add deleted table nodes (tables that exist in original but not in current)
        const deletedTableNodes: Node<SchemaDesigner.Table>[] = [];
        for (const tableDiff of schemaDiff.tableDiffs) {
            if (
                tableDiff.status === SchemaDesigner.DiffStatus.Deleted &&
                tableDiff.originalTable
            ) {
                // Check if this node already exists in updatedNodes (shouldn't, but be safe)
                if (!updatedNodes.find((n) => n.id === tableDiff.tableId)) {
                    // Find a suitable position for the deleted table
                    // Place it near where it might have been or in a default location
                    const existingPositions = updatedNodes.map((n) => n.position);
                    let posX = 100;
                    let posY = 100;

                    if (existingPositions.length > 0) {
                        // Place it to the right of the rightmost table
                        const maxX = Math.max(...existingPositions.map((p) => p.x));
                        posX = maxX + flowUtils.getTableWidth() + 50;
                        posY = existingPositions[0].y;
                    }

                    deletedTableNodes.push({
                        id: tableDiff.tableId,
                        type: "tableNode",
                        position: { x: posX, y: posY },
                        data: tableDiff.originalTable,
                        className: "diff-table-deleted",
                        draggable: false, // Deleted tables shouldn't be draggable
                        selectable: true,
                        deletable: false,
                        connectable: false,
                    });
                }
            }
        }

        return [...updatedNodes, ...deletedTableNodes];
    }, [schemaNodes, context.isDiffViewEnabled, context.originalSchema, context.schemaChangeVersion]);

    // Compute edges with diff classes when diff view is enabled
    const edgesWithDiffClasses = useMemo(() => {
        if (!context.isDiffViewEnabled || !context.originalSchema) {
            // When diff view is disabled, strip any diff classes from edges
            // and filter out deleted edges (those starting with "deleted-")
            return relationshipEdges
                .filter((edge) => !edge.id.startsWith("deleted-"))
                .map((edge) => {
                    if (
                        edge.className &&
                        (edge.className.includes("diff-edge-added") ||
                            edge.className.includes("diff-edge-deleted"))
                    ) {
                        return {
                            ...edge,
                            className: edge.className
                                .replace(/diff-edge-added/g, "")
                                .replace(/diff-edge-deleted/g, "")
                                .trim(),
                        };
                    }
                    return edge;
                });
        }

        const schemaDiff = context.getSchemaDiff();
        if (!schemaDiff) {
            return relationshipEdges;
        }

        // Create a set of original FK IDs for quick lookup
        const originalFKIds = new Set<string>();
        for (const table of context.originalSchema.tables) {
            for (const fk of table.foreignKeys) {
                originalFKIds.add(fk.id);
            }
        }

        // Add diff classes to existing edges
        const updatedEdges = relationshipEdges.map((edge) => {
            if (!edge.data?.id) return edge;

            const fkDiff = diffUtils.getForeignKeyDiffStatus(schemaDiff, edge.data.id);

            if (fkDiff) {
                let className = edge.className || "";
                if (fkDiff.status === SchemaDesigner.DiffStatus.Added) {
                    className = `${className} diff-edge-added`.trim();
                } else if (fkDiff.status === SchemaDesigner.DiffStatus.Deleted) {
                    className = `${className} diff-edge-deleted`.trim();
                }
                return { ...edge, className };
            }

            // Check if this is a new FK (not in original)
            if (!originalFKIds.has(edge.data.id)) {
                return { ...edge, className: `${edge.className || ""} diff-edge-added`.trim() };
            }

            return edge;
        });

        // Add deleted FK edges (edges that existed in original but not in current)
        const deletedEdges: Edge<SchemaDesigner.ForeignKey>[] = [];

        // Helper function to find a node by table ID - checks both current schema nodes
        // and deleted tables from the original schema
        const findNodeById = (tableId: string): Node<SchemaDesigner.Table> | undefined => {
            const currentNode = schemaNodes.find((n) => n.id === tableId);
            if (currentNode) return currentNode;

            // If not found in current nodes, check if it's a deleted table
            const deletedTableDiff = schemaDiff.tableDiffs.find(
                (td) =>
                    td.tableId === tableId &&
                    td.status === SchemaDesigner.DiffStatus.Deleted &&
                    td.originalTable,
            );
            if (deletedTableDiff && deletedTableDiff.originalTable) {
                // Create a virtual node for the deleted table
                // Position will be adjusted in nodesWithDiffClasses
                return {
                    id: tableId,
                    type: "tableNode",
                    position: { x: 0, y: 0 },
                    data: deletedTableDiff.originalTable,
                } as Node<SchemaDesigner.Table>;
            }
            return undefined;
        };

        // Helper function to find a node by schema and table name
        const findNodeBySchemaAndName = (
            schemaName: string,
            tableName: string,
        ): Node<SchemaDesigner.Table> | undefined => {
            const currentNode = schemaNodes.find(
                (n) => n.data.schema === schemaName && n.data.name === tableName,
            );
            if (currentNode) return currentNode;

            // Check deleted tables
            const deletedTableDiff = schemaDiff.tableDiffs.find(
                (td) =>
                    td.status === SchemaDesigner.DiffStatus.Deleted &&
                    td.originalTable &&
                    td.originalTable.schema === schemaName &&
                    td.originalTable.name === tableName,
            );
            if (deletedTableDiff && deletedTableDiff.originalTable) {
                return {
                    id: deletedTableDiff.tableId,
                    type: "tableNode",
                    position: { x: 0, y: 0 },
                    data: deletedTableDiff.originalTable,
                } as Node<SchemaDesigner.Table>;
            }
            return undefined;
        };

        for (const tableDiff of schemaDiff.tableDiffs) {
            for (const fkDiff of tableDiff.foreignKeyDiffs) {
                if (
                    fkDiff.status === SchemaDesigner.DiffStatus.Deleted &&
                    fkDiff.originalForeignKey
                ) {
                    const fk = fkDiff.originalForeignKey;
                    const sourceNode = findNodeById(tableDiff.tableId);
                    const targetNode = findNodeBySchemaAndName(
                        fk.referencedSchemaName,
                        fk.referencedTableName,
                    );

                    if (sourceNode && targetNode) {
                        fk.columns.forEach((col, idx) => {
                            deletedEdges.push({
                                id: `deleted-${fk.id}-${idx}`,
                                source: tableDiff.tableId,
                                target: targetNode.id,
                                sourceHandle: `right-${col}`,
                                targetHandle: `left-${fk.referencedColumns[idx]}`,
                                markerEnd: { type: MarkerType.ArrowClosed },
                                className: "diff-edge-deleted",
                                deletable: false,
                                selectable: false,
                                data: {
                                    ...fk,
                                    columns: [col],
                                    referencedColumns: [fk.referencedColumns[idx]],
                                },
                            });
                        });
                    }
                }
            }
        }

        return [...updatedEdges, ...deletedEdges];
    }, [
        relationshipEdges,
        schemaNodes,
        context.isDiffViewEnabled,
        context.originalSchema,
        context.schemaChangeVersion,
    ]);

    return (
        <div style={{ width: "100%", height: "100%" }}>
            <Toaster toasterId={toasterId} position="top-end" />
            <ReactFlow
                nodes={nodesWithDiffClasses}
                edges={edgesWithDiffClasses}
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
                    eventBus.emit("endTransaction", "delete-elements");
                }}
                onNodeDragStop={() => {
                    eventBus.emit("pushState");
                }}
                onBeforeDelete={async (props) => {
                    if (props.nodes.length === 0 && props.edges.length === 0) {
                        return true;
                    }
                    const confirmed = await deleteElementsConfirmation();
                    if (confirmed) {
                        eventBus.emit("beginTransaction", "delete-elements");
                    }
                    return confirmed;
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
