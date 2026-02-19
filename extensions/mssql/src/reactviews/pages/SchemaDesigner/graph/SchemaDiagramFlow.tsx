/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    ReactFlow,
    MiniMap,
    Controls,
    ControlButton,
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
    type NodeChange,
    addEdge,
    applyNodeChanges,
    FinalConnectionState,
    ConnectionLineType,
} from "@xyflow/react";
import {
    ArrowDown16Regular,
    ArrowUndo16Regular,
    ArrowUp16Regular,
    BranchCompare16Regular,
    BranchCompare16Filled,
    Checkmark16Regular,
    Sparkle16Regular,
} from "@fluentui/react-icons";
import { SchemaDesignerTableNode } from "./schemaDesignerTableNode.js";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import {
    filterDeletedEdges,
    filterDeletedNodes,
    mergeDeletedTableNodes,
} from "../diff/deletedVisualUtils";
import {
    getVisiblePendingAiItems,
    getVisiblePendingAiSchemaChanges,
    toPendingAiSchemaChange,
} from "../aiLedger/ledgerUtils";

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
    Tooltip,
    Toast,
    ToastBody,
    Toaster,
    ToastTitle,
    useId,
    useToastController,
    Divider,
} from "@fluentui/react-components";
import eventBus from "../schemaDesignerEvents";
import { v4 as uuidv4 } from "uuid";
import { locConstants } from "../../../common/locConstants.js";
import { ChangeAction, ChangeCategory, type SchemaChange } from "../diff/diffUtils";

// Component configuration
const NODE_TYPES: NodeTypes = {
    tableNode: SchemaDesignerTableNode,
};

// Workaround: ESLint bans `null` literals; produce null at runtime to satisfy the rule.
const NULL_VALUE = JSON.parse("null") as null;

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
    const [deletedSchemaNodes, setDeletedSchemaNodes] = useState<Node<SchemaDesigner.Table>[]>([]);
    const [relationshipEdges, setRelationshipEdges, onEdgesChange] = useEdgesState<
        Edge<SchemaDesigner.ForeignKey>
    >([]);

    const reactFlow = useReactFlow();

    const refreshRafId = useRef<number | undefined>(undefined);
    const flowWrapperRef = useRef<HTMLDivElement | null>(NULL_VALUE);
    const edgeUndoWrapperRef = useRef<HTMLDivElement | null>(NULL_VALUE);

    const deleteNodeConfirmationPromise = useRef<
        ((value: boolean | PromiseLike<boolean>) => void) | undefined
    >(undefined);

    const [open, setOpen] = useState(false);
    const [edgeUndoState, setEdgeUndoState] = useState<{
        change: SchemaChange;
        canRevert: boolean;
        reason?: string;
        position: { x: number; y: number };
    } | null>(NULL_VALUE);
    const [pendingAiEdgeToolbarState, setPendingAiEdgeToolbarState] = useState<{
        change: SchemaChange;
        position: { x: number; y: number };
    } | null>(NULL_VALUE);
    const [edgeUndoDialogOpen, setEdgeUndoDialogOpen] = useState(false);
    const [pendingEdgeUndoChange, setPendingEdgeUndoChange] = useState<SchemaChange | null>(
        NULL_VALUE,
    );
    const [activePendingAiChangeId, setActivePendingAiChangeId] = useState<string | undefined>(
        undefined,
    );
    const [isApplyingPendingAiAction, setIsApplyingPendingAiAction] = useState(false);
    const isPendingAiVisualMode =
        context.isChangesPanelVisible && context.changesPanelTab === "pendingAi";
    const shouldShowBaselineHighlights = context.showChangesHighlight && !isPendingAiVisualMode;
    const visiblePendingAiItems = useMemo(
        () => getVisiblePendingAiItems(context.aiLedger),
        [context.aiLedger],
    );
    const pendingAiForeignKeyActions = useMemo(() => {
        const actionByForeignKeyId = new Map<string, ChangeAction>();
        for (const item of visiblePendingAiItems) {
            if (item.category !== ChangeCategory.ForeignKey || !item.objectId) {
                continue;
            }
            actionByForeignKeyId.set(item.objectId, item.action);
        }
        return actionByForeignKeyId;
    }, [visiblePendingAiItems]);
    const pendingAiForeignKeyChanges = useMemo(() => {
        const changesByForeignKeyId = new Map<string, SchemaChange>();
        for (const item of visiblePendingAiItems) {
            if (item.category !== ChangeCategory.ForeignKey || !item.objectId) {
                continue;
            }
            changesByForeignKeyId.set(item.objectId, toPendingAiSchemaChange(item));
        }
        return changesByForeignKeyId;
    }, [visiblePendingAiItems]);

    const highlightedEdges = useMemo(() => {
        const addedClass = "schema-designer-edge-added";
        const modifiedClass = "schema-designer-edge-modified";
        let didChange = false;
        const nextEdges = relationshipEdges.map((edge) => {
            const foreignKeyId = edge.data?.id;
            const aiAction = foreignKeyId
                ? pendingAiForeignKeyActions.get(foreignKeyId)
                : undefined;
            const shouldHighlight = isPendingAiVisualMode
                ? aiAction === ChangeAction.Add
                : shouldShowBaselineHighlights &&
                  !!foreignKeyId &&
                  context.newForeignKeyIds.has(foreignKeyId);
            const shouldShowModified = isPendingAiVisualMode
                ? aiAction === ChangeAction.Modify
                : shouldShowBaselineHighlights &&
                  !!foreignKeyId &&
                  context.modifiedForeignKeyIds.has(foreignKeyId);

            const baseClass = edge.className?.split(/\s+/).filter(Boolean) ?? [];
            const classSet = new Set(baseClass);

            if (shouldHighlight) {
                classSet.add(addedClass);
            } else {
                classSet.delete(addedClass);
            }

            if (shouldShowModified) {
                classSet.add(modifiedClass);
            } else {
                classSet.delete(modifiedClass);
            }

            const nextClassName = classSet.size > 0 ? Array.from(classSet).join(" ") : undefined;
            if (nextClassName === edge.className) {
                return edge;
            }

            didChange = true;
            return { ...edge, className: nextClassName };
        });

        return didChange ? nextEdges : relationshipEdges;
    }, [
        context.newForeignKeyIds,
        context.modifiedForeignKeyIds,
        isPendingAiVisualMode,
        pendingAiForeignKeyActions,
        relationshipEdges,
        shouldShowBaselineHighlights,
    ]);

    const displayEdges = useMemo(() => {
        if (!shouldShowBaselineHighlights || context.deletedForeignKeyEdges.length === 0) {
            return highlightedEdges;
        }

        return [...highlightedEdges, ...context.deletedForeignKeyEdges];
    }, [context.deletedForeignKeyEdges, highlightedEdges, shouldShowBaselineHighlights]);

    const displayNodes = useMemo(() => {
        if (!shouldShowBaselineHighlights) {
            return schemaNodes;
        }

        return mergeDeletedTableNodes(schemaNodes, deletedSchemaNodes);
    }, [deletedSchemaNodes, schemaNodes, shouldShowBaselineHighlights]);

    const pendingAiChanges = useMemo<SchemaChange[]>(() => {
        return getVisiblePendingAiSchemaChanges(context.aiLedger);
    }, [context.aiLedger]);

    const activePendingAiIndex = useMemo(() => {
        if (pendingAiChanges.length === 0) {
            return -1;
        }
        if (!activePendingAiChangeId) {
            return 0;
        }
        const index = pendingAiChanges.findIndex((change) => change.id === activePendingAiChangeId);
        return index >= 0 ? index : 0;
    }, [activePendingAiChangeId, pendingAiChanges]);

    const activePendingAiChange =
        activePendingAiIndex >= 0 ? pendingAiChanges[activePendingAiIndex] : undefined;

    const revealChangeInDiagram = useCallback(
        (change: SchemaChange) => {
            context.updateSelectedNodes([]);
            eventBus.emit("clearEdgeSelection");

            if (change.category === ChangeCategory.ForeignKey && change.objectId) {
                eventBus.emit("revealForeignKeyEdges", change.objectId);
                return;
            }

            context.updateSelectedNodes([change.tableId]);
            context.setCenter(change.tableId, true);
        },
        [context],
    );

    const showPendingAiFloatingToolbar = isPendingAiVisualMode && pendingAiChanges.length > 0;

    useEffect(() => {
        if (!shouldShowBaselineHighlights) {
            setEdgeUndoState(NULL_VALUE);
        }
    }, [shouldShowBaselineHighlights]);

    useEffect(() => {
        if (!isPendingAiVisualMode) {
            setPendingAiEdgeToolbarState(NULL_VALUE);
        }
    }, [isPendingAiVisualMode]);

    useEffect(() => {
        if (pendingAiChanges.length === 0) {
            setActivePendingAiChangeId(undefined);
            return;
        }

        if (
            !activePendingAiChangeId ||
            !pendingAiChanges.some((change) => change.id === activePendingAiChangeId)
        ) {
            setActivePendingAiChangeId(pendingAiChanges[0].id);
        }
    }, [activePendingAiChangeId, pendingAiChanges]);

    useEffect(() => {
        const handleSetActivePendingAiChange = (changeId: string | undefined) => {
            if (!changeId) {
                setActivePendingAiChangeId(undefined);
                return;
            }
            const change = pendingAiChanges.find((pendingChange) => pendingChange.id === changeId);
            if (change) {
                setActivePendingAiChangeId(changeId);
                revealChangeInDiagram(change);
            }
        };

        eventBus.on("setActivePendingAiChange", handleSetActivePendingAiChange);
        return () => {
            eventBus.off("setActivePendingAiChange", handleSetActivePendingAiChange);
        };
    }, [pendingAiChanges, revealChangeInDiagram]);

    useEffect(() => {
        eventBus.emit("activePendingAiChangeUpdated", activePendingAiChange?.id);
    }, [activePendingAiChange?.id, isPendingAiVisualMode]);

    useEffect(() => {
        setDeletedSchemaNodes((prev) => {
            if (context.deletedTableNodes.length === 0) {
                return [];
            }

            const prevById = new Map(prev.map((node) => [node.id, node]));
            return context.deletedTableNodes.map((node) => {
                const existing = prevById.get(node.id);
                if (!existing) {
                    return node;
                }

                return {
                    ...node,
                    position: existing.position,
                };
            });
        });
    }, [context.deletedTableNodes]);

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
                setSchemaNodes(
                    filterDeletedNodes(reactFlow.getNodes() as Node<SchemaDesigner.Table>[]),
                );
                setRelationshipEdges(
                    filterDeletedEdges(reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[]),
                );
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

            const edgesFromStore = filterDeletedEdges(
                reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
            );
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
            const edgesFromStore = filterDeletedEdges(
                reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
            );
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
     * @param errorMessage - The error message to display
     */
    const showErrorNotification = (errorMessage: string) =>
        dispatchToast(
            <Toast appearance="inverted">
                <ToastTitle>{locConstants.schemaDesigner.failedToCreateForeignKey}</ToastTitle>
                <ToastBody>{errorMessage}</ToastBody>
            </Toast>,
            { pauseOnHover: true, intent: "error" },
        );

    const showPendingAiUndoBlockedNotification = (reason?: string) =>
        dispatchToast(
            <Toast appearance="inverted">
                <ToastTitle>{locConstants.schemaDesigner.undoAiChangeUnavailableTitle}</ToastTitle>
                <ToastBody>{reason ?? locConstants.schemaDesigner.cannotUndoAiChange}</ToastBody>
            </Toast>,
            { pauseOnHover: true, intent: "warning" },
        );

    /**
     * Handles new connections between nodes
     * @param params - Connection parameters
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
     * @param _event - The connection event
     * @param connectionState - The final connection state
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
     * @param connection - The connection to validate
     * @returns Whether the connection is valid
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

    const handleRevealActivePendingAiChange = () => {
        if (!activePendingAiChange) {
            return;
        }
        revealChangeInDiagram(activePendingAiChange);
    };

    const handleKeepActivePendingAiChange = () => {
        if (!activePendingAiChange || isApplyingPendingAiAction) {
            return;
        }
        context.keepAiLedgerChange(activePendingAiChange);
    };

    const handleUndoActivePendingAiChange = async () => {
        if (
            !activePendingAiChange ||
            isApplyingPendingAiAction ||
            !activePendingAiUndoState.canRevert
        ) {
            return;
        }
        setIsApplyingPendingAiAction(true);
        try {
            const didUndo = await context.undoAiLedgerChange(activePendingAiChange);
            if (!didUndo) {
                showPendingAiUndoBlockedNotification(activePendingAiUndoState.reason);
            }
        } finally {
            setIsApplyingPendingAiAction(false);
        }
    };

    const handleKeepPendingAiEdgeChange = () => {
        if (!pendingAiEdgeToolbarState || isApplyingPendingAiAction) {
            return;
        }
        context.keepAiLedgerChange(pendingAiEdgeToolbarState.change);
        setPendingAiEdgeToolbarState(NULL_VALUE);
    };

    const handleUndoPendingAiEdgeChange = async () => {
        if (
            !pendingAiEdgeToolbarState ||
            isApplyingPendingAiAction ||
            !pendingAiEdgeUndoState.canRevert
        ) {
            return;
        }
        setIsApplyingPendingAiAction(true);
        try {
            const didUndo = await context.undoAiLedgerChange(pendingAiEdgeToolbarState.change);
            if (!didUndo) {
                showPendingAiUndoBlockedNotification(pendingAiEdgeUndoState.reason);
                return;
            }
            setPendingAiEdgeToolbarState(NULL_VALUE);
        } finally {
            setIsApplyingPendingAiAction(false);
        }
    };

    const navigatePendingAiChange = (step: 1 | -1) => {
        if (pendingAiChanges.length === 0) {
            return;
        }

        const currentIndex = activePendingAiIndex >= 0 ? activePendingAiIndex : 0;
        const nextIndex = (currentIndex + step + pendingAiChanges.length) % pendingAiChanges.length;
        const nextChange = pendingAiChanges[nextIndex];
        setActivePendingAiChangeId(nextChange.id);
        revealChangeInDiagram(nextChange);
    };

    const activePendingAiUndoState = useMemo(() => {
        if (!activePendingAiChange) {
            return {
                canRevert: false,
                reason: locConstants.schemaDesigner.cannotUndoAiChange,
            };
        }
        return context.canUndoAiLedgerChange(activePendingAiChange);
    }, [activePendingAiChange, context]);

    const pendingAiEdgeUndoState = useMemo(() => {
        if (!pendingAiEdgeToolbarState) {
            return {
                canRevert: false,
                reason: locConstants.schemaDesigner.cannotUndoAiChange,
            };
        }
        return context.canUndoAiLedgerChange(pendingAiEdgeToolbarState.change);
    }, [context, pendingAiEdgeToolbarState]);

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }} ref={flowWrapperRef}>
            <Toaster toasterId={toasterId} position="top-end" />
            <ReactFlow
                nodes={displayNodes}
                edges={displayEdges}
                nodeTypes={NODE_TYPES}
                onNodesChange={(changes) => {
                    const isDeletedNodeChange = (change: NodeChange<Node<SchemaDesigner.Table>>) =>
                        "id" in change &&
                        typeof change.id === "string" &&
                        change.id.startsWith("deleted-");
                    const deletedChanges = changes.filter(isDeletedNodeChange);
                    const regularChanges = changes.filter((change) => !isDeletedNodeChange(change));

                    if (regularChanges.length > 0) {
                        onNodesChange(regularChanges);
                    }

                    if (deletedChanges.length > 0) {
                        setDeletedSchemaNodes((nodes) => applyNodeChanges(deletedChanges, nodes));
                    }
                }}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onConnectEnd={handleConnectEnd}
                onlyRenderVisibleElements={context.renderOnlyVisibleTables}
                proOptions={{
                    hideAttribution: true,
                }}
                isValidConnection={validateConnection}
                connectionMode={ConnectionMode.Loose}
                onEdgeMouseEnter={(event, edge) => {
                    if (isPendingAiVisualMode && !context.isExporting) {
                        const foreignKeyId = edge.data?.id;
                        if (!foreignKeyId) {
                            setPendingAiEdgeToolbarState(NULL_VALUE);
                            return;
                        }

                        const pendingAiFkChange = pendingAiForeignKeyChanges.get(foreignKeyId);
                        if (!pendingAiFkChange) {
                            setPendingAiEdgeToolbarState(NULL_VALUE);
                            return;
                        }

                        const rect = flowWrapperRef.current?.getBoundingClientRect();
                        if (!rect) {
                            setPendingAiEdgeToolbarState(NULL_VALUE);
                            return;
                        }

                        setPendingAiEdgeToolbarState({
                            change: pendingAiFkChange,
                            position: {
                                x: event.clientX - rect.left + 6,
                                y: event.clientY - rect.top - 6,
                            },
                        });
                        return;
                    }

                    if (!shouldShowBaselineHighlights || context.isExporting) {
                        setEdgeUndoState(NULL_VALUE);
                        return;
                    }

                    const foreignKeyId = edge.data?.id;
                    if (!foreignKeyId) {
                        setEdgeUndoState(NULL_VALUE);
                        return;
                    }

                    const isDeleted = Boolean(
                        (edge.data as SchemaDesigner.ForeignKeyWithDeletedFlag)?.isDeleted,
                    );
                    const changeAction = isDeleted
                        ? ChangeAction.Delete
                        : context.newForeignKeyIds.has(foreignKeyId)
                          ? ChangeAction.Add
                          : context.modifiedForeignKeyIds.has(foreignKeyId)
                            ? ChangeAction.Modify
                            : undefined;

                    if (!changeAction) {
                        setEdgeUndoState(NULL_VALUE);
                        return;
                    }

                    const sourceNode =
                        displayNodes.find((node) => node.id === edge.source) ??
                        (reactFlow.getNode(edge.source) as Node<SchemaDesigner.Table> | undefined);
                    if (!sourceNode) {
                        setEdgeUndoState(NULL_VALUE);
                        return;
                    }

                    const rawTableId = sourceNode.id;
                    const tableId = rawTableId.startsWith("deleted-")
                        ? rawTableId.replace(/^deleted-/, "")
                        : rawTableId;

                    const change: SchemaChange = {
                        id: `foreignKey:${changeAction}:${tableId}:${foreignKeyId}`,
                        action: changeAction,
                        category: ChangeCategory.ForeignKey,
                        tableId,
                        tableName: sourceNode.data.name,
                        tableSchema: sourceNode.data.schema,
                        objectId: foreignKeyId,
                        objectName: edge.data?.name,
                    };

                    const rect = flowWrapperRef.current?.getBoundingClientRect();
                    if (!rect) {
                        setEdgeUndoState(NULL_VALUE);
                        return;
                    }

                    const x = event.clientX - rect.left + 6;
                    const y = event.clientY - rect.top - 6;
                    const revertInfo = context.canRevertChange(change);
                    setEdgeUndoState({
                        change,
                        canRevert: revertInfo.canRevert,
                        reason: revertInfo.reason,
                        position: { x, y },
                    });
                }}
                onEdgeMouseLeave={(event) => {
                    if (
                        edgeUndoWrapperRef.current?.contains(
                            event.relatedTarget as unknown as globalThis.Node,
                        )
                    ) {
                        return;
                    }
                    setEdgeUndoState(NULL_VALUE);
                    setPendingAiEdgeToolbarState(NULL_VALUE);
                }}
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
                    if (context.consumeSkipDeleteConfirmation()) {
                        return true;
                    }
                    return await deleteElementsConfirmation();
                }}
                minZoom={0.05}
                fitView>
                <Controls>
                    {context.isDabEnabled() && (
                        <ControlButton
                            onClick={() =>
                                context.setShowChangesHighlight(!context.showChangesHighlight)
                            }
                            title={
                                context.showChangesHighlight
                                    ? locConstants.schemaDesigner.hideChangesHighlight
                                    : locConstants.schemaDesigner.highlightChanges
                            }
                            aria-label={
                                context.showChangesHighlight
                                    ? locConstants.schemaDesigner.hideChangesHighlight
                                    : locConstants.schemaDesigner.highlightChanges
                            }>
                            {context.showChangesHighlight ? (
                                <BranchCompare16Filled />
                            ) : (
                                <BranchCompare16Regular />
                            )}
                        </ControlButton>
                    )}
                </Controls>
                <MiniMap pannable zoomable />
                <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
            </ReactFlow>
            {showPendingAiFloatingToolbar && (
                <div className="sd-pending-ai-floating-toolbar">
                    <Tooltip
                        content={locConstants.schemaDesigner.pendingAiTabLabel}
                        relationship="label">
                        <span aria-label={locConstants.schemaDesigner.pendingAiTabLabel}>
                            <Sparkle16Regular />
                        </span>
                    </Tooltip>
                    <Button
                        size="small"
                        appearance="primary"
                        onClick={handleKeepActivePendingAiChange}
                        disabled={!activePendingAiChange || isApplyingPendingAiAction}>
                        {locConstants.schemaDesigner.keep}
                    </Button>
                    <Tooltip
                        content={
                            activePendingAiUndoState.canRevert
                                ? locConstants.schemaDesigner.undo
                                : (activePendingAiUndoState.reason ?? "")
                        }
                        relationship="label">
                        <Button
                            size="small"
                            appearance="subtle"
                            onClick={() => {
                                void handleUndoActivePendingAiChange();
                            }}
                            disabled={
                                !activePendingAiChange ||
                                isApplyingPendingAiAction ||
                                !activePendingAiUndoState.canRevert
                            }>
                            {locConstants.schemaDesigner.undo}
                        </Button>
                    </Tooltip>
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={handleRevealActivePendingAiChange}
                        disabled={!activePendingAiChange}>
                        {locConstants.schemaDesigner.changesPanel.reveal}
                    </Button>
                    <Divider vertical />
                    <span className="sd-pending-ai-floating-toolbar__counter">
                        {locConstants.common.searchResultSummary(
                            activePendingAiIndex + 1,
                            pendingAiChanges.length,
                        )}
                    </span>
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<ArrowUp16Regular />}
                        aria-label={locConstants.schemaDesigner.previousAiChange}
                        onClick={() => navigatePendingAiChange(-1)}
                        disabled={pendingAiChanges.length === 0}
                    />
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<ArrowDown16Regular />}
                        aria-label={locConstants.schemaDesigner.nextAiChange}
                        onClick={() => navigatePendingAiChange(1)}
                        disabled={pendingAiChanges.length === 0}
                    />
                </div>
            )}
            {pendingAiEdgeToolbarState && (
                <div
                    ref={edgeUndoWrapperRef}
                    className="sd-edge-tooltip-wrapper"
                    style={{
                        left: pendingAiEdgeToolbarState.position.x,
                        top: pendingAiEdgeToolbarState.position.y,
                    }}
                    onMouseLeave={() => setPendingAiEdgeToolbarState(NULL_VALUE)}>
                    <div className="sd-edge-tooltip-inner">
                        <Tooltip content={locConstants.schemaDesigner.keep} relationship="label">
                            <Button
                                size="small"
                                appearance="primary"
                                icon={<Checkmark16Regular />}
                                disabled={isApplyingPendingAiAction}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleKeepPendingAiEdgeChange();
                                }}
                            />
                        </Tooltip>
                        <Tooltip
                            content={
                                pendingAiEdgeUndoState.canRevert
                                    ? locConstants.schemaDesigner.undo
                                    : (pendingAiEdgeUndoState.reason ?? "")
                            }
                            relationship="label">
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<ArrowUndo16Regular />}
                                disabled={
                                    isApplyingPendingAiAction || !pendingAiEdgeUndoState.canRevert
                                }
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void handleUndoPendingAiEdgeChange();
                                }}
                            />
                        </Tooltip>
                    </div>
                </div>
            )}
            {edgeUndoState && (
                <div
                    ref={edgeUndoWrapperRef}
                    className="sd-edge-tooltip-wrapper"
                    style={{
                        left: edgeUndoState.position.x,
                        top: edgeUndoState.position.y,
                    }}
                    onMouseLeave={() => setEdgeUndoState(NULL_VALUE)}>
                    <Tooltip
                        content={
                            edgeUndoState.canRevert
                                ? locConstants.schemaDesigner.undo
                                : (edgeUndoState.reason ?? "")
                        }
                        relationship="label">
                        <Button
                            appearance="primary"
                            size="small"
                            icon={<ArrowUndo16Regular />}
                            disabled={!edgeUndoState.canRevert}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (!edgeUndoState.canRevert) {
                                    return;
                                }
                                setPendingEdgeUndoChange(edgeUndoState.change);
                                setEdgeUndoDialogOpen(true);
                            }}
                        />
                    </Tooltip>
                </div>
            )}
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
            <Dialog
                open={edgeUndoDialogOpen}
                onOpenChange={(_event, data) => {
                    setEdgeUndoDialogOpen(data.open);
                    if (!data.open) {
                        setPendingEdgeUndoChange(NULL_VALUE);
                    }
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{locConstants.schemaDesigner.deleteConfirmation}</DialogTitle>
                        <DialogContent>
                            {locConstants.schemaDesigner.deleteConfirmationContent}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    if (pendingEdgeUndoChange) {
                                        context.revertChange(pendingEdgeUndoChange);
                                    }
                                    setEdgeUndoDialogOpen(false);
                                    setEdgeUndoState(NULL_VALUE);
                                }}>
                                {locConstants.schemaDesigner.undo}
                            </Button>
                            <Button
                                appearance="secondary"
                                onClick={() => setEdgeUndoDialogOpen(false)}>
                                {locConstants.schemaDesigner.cancel}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};
