/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useState } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs, getErrorMessage } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, MarkerType, Node, ReactFlowJsonObject, useReactFlow } from "@xyflow/react";
import { diffUtils, flowUtils, foreignKeyUtils } from "./schemaDesignerUtils";
import eventBus from "./schemaDesignerEvents";
import { UndoRedoStack } from "../../common/undoRedoStack";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesigner.SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    schemaNames: string[];
    datatypes: string[];
    findTableText: string;
    setFindTableText: (text: string) => void;
    getDefinition: () => Promise<string>;
    initializeSchemaDesigner: () => Promise<{
        nodes: Node<SchemaDesigner.Table>[];
        edges: Edge<SchemaDesigner.ForeignKey>[];
    }>;
    saveAsFile: (fileProps: SchemaDesigner.ExportFileOptions) => void;
    getReport: () => Promise<SchemaDesigner.GetReportWebviewResponse | undefined>;
    openInEditor: (text: string) => void;
    openInEditorWithConnection: () => void;
    copyToClipboard: (text: string) => void;
    extractSchema: () => SchemaDesigner.Schema;
    addTable: (table: SchemaDesigner.Table) => Promise<boolean>;
    updateTable: (table: SchemaDesigner.Table) => Promise<boolean>;
    deleteTable: (table: SchemaDesigner.Table) => Promise<boolean>;
    deleteSelectedNodes: () => void;
    getTableWithForeignKeys: (tableId: string) => SchemaDesigner.Table | undefined;
    updateSelectedNodes: (nodesIds: string[]) => void;
    setCenter: (nodeId: string, shouldZoomIn?: boolean) => void;
    publishSession: () => Promise<{
        success: boolean;
        error?: string;
    }>;
    closeDesigner: () => void;
    resetUndoRedoState: () => void;
    resetView: () => void;
    isInitialized: boolean;
    initializationError?: string;
    initializationRequestId: number;
    triggerInitialization: () => void;
    renderOnlyVisibleTables: boolean;
    setRenderOnlyVisibleTables: (value: boolean) => void;
    isExporting: boolean;
    setIsExporting: (value: boolean) => void;
    // Diff view related properties
    /** Whether diff view mode is enabled */
    isDiffViewEnabled: boolean;
    /** Toggle diff view mode */
    setDiffViewEnabled: (enabled: boolean) => void;
    /** The original schema from the database (baseline for diff) */
    originalSchema: SchemaDesigner.Schema | undefined;
    /** Version counter that increments on schema changes (for triggering re-renders) */
    schemaChangeVersion: number;
    /** Get the current schema diff */
    getSchemaDiff: () => SchemaDesigner.SchemaDiff | undefined;
    /** Get change entries for the changes panel */
    getChangeEntries: () => SchemaDesigner.ChangeEntry[];
    /** Revert a table change (undo add, undo delete, or undo modifications) */
    revertTableChange: (tableId: string, changeType: SchemaDesigner.DiffStatus) => void;
    /** Revert a column change */
    revertColumnChange: (
        tableId: string,
        columnId: string,
        changeType: SchemaDesigner.DiffStatus,
    ) => void;
    /** Revert a foreign key change */
    revertForeignKeyChange: (
        tableId: string,
        foreignKeyId: string,
        changeType: SchemaDesigner.DiffStatus,
    ) => void;
}

const SchemaDesignerContext = createContext<SchemaDesignerContextProps>(
    undefined as unknown as SchemaDesignerContextProps,
);

interface SchemaDesignerProviderProps {
    children: React.ReactNode;
}

export const stateStack = new UndoRedoStack<
    ReactFlowJsonObject<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>
>();

const SchemaDesignerStateProvider: React.FC<SchemaDesignerProviderProps> = ({ children }) => {
    // Set up necessary webview context
    const webviewContext = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const { state, extensionRpc, themeKind, keyBindings } = webviewContext;

    // Setups for schema designer model
    const [datatypes, setDatatypes] = useState<string[]>([]);
    const [schemaNames, setSchemaNames] = useState<string[]>([]);
    const reactFlow = useReactFlow();
    const [isInitialized, setIsInitialized] = useState(false);
    const [initializationError, setInitializationError] = useState<string | undefined>(undefined);
    const [initializationRequestId, setInitializationRequestId] = useState(0);
    const [findTableText, setFindTableText] = useState<string>("");
    const [renderOnlyVisibleTables, setRenderOnlyVisibleTables] = useState<boolean>(true);
    const [isExporting, setIsExporting] = useState<boolean>(false);

    // Diff view state
    const [isDiffViewEnabled, setDiffViewEnabled] = useState<boolean>(false);
    const [originalSchema, setOriginalSchema] = useState<SchemaDesigner.Schema | undefined>(
        undefined,
    );
    const [schemaChangeVersion, setSchemaChangeVersion] = useState<number>(0);

    useEffect(() => {
        let transactionDepth = 0;
        let pendingCommit = false;
        let commitScheduled = false;

        const captureFlowState = () => {
            const state = reactFlow.toObject() as ReactFlowJsonObject<
                Node<SchemaDesigner.Table>,
                Edge<SchemaDesigner.ForeignKey>
            >;
            // Clone defensively (ReactFlow mutates nodes/edges in-place)
            return JSON.parse(JSON.stringify(state)) as typeof state;
        };

        const commitHistoryState = () => {
            const state = captureFlowState();
            stateStack.pushState(state);
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
        };

        const scheduleCommit = () => {
            if (commitScheduled) {
                pendingCommit = true;
                return;
            }
            commitScheduled = true;
            requestAnimationFrame(() => {
                commitScheduled = false;
                if (transactionDepth > 0) {
                    pendingCommit = true;
                    return;
                }
                pendingCommit = false;
                commitHistoryState();
            });
        };

        const handlePushState = () => {
            scheduleCommit();
        };

        const handleBeginTransaction = () => {
            transactionDepth++;
        };

        const handleEndTransaction = () => {
            transactionDepth = Math.max(0, transactionDepth - 1);
            if (transactionDepth === 0 && pendingCommit) {
                scheduleCommit();
            }
        };

        eventBus.on("pushState", handlePushState);
        eventBus.on("beginTransaction", handleBeginTransaction);
        eventBus.on("endTransaction", handleEndTransaction);

        // Listen to getScript event for immediate diff view updates
        // This event is emitted whenever the schema changes and needs script regeneration
        const handleGetScript = () => {
            // Increment version to trigger diff recalculation immediately
            setSchemaChangeVersion((v) => v + 1);
        };
        eventBus.on("getScript", handleGetScript);

        const handleUndo = () => {
            if (!stateStack.canUndo()) {
                return;
            }
            const state = stateStack.undo();
            if (!state) {
                return;
            }
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
            // Increment version to trigger diff recalculation after undo
            setSchemaChangeVersion((v) => v + 1);
        };
        eventBus.on("undo", handleUndo);

        const handleRedo = () => {
            if (!stateStack.canRedo()) {
                return;
            }
            const state = stateStack.redo();
            if (!state) {
                return;
            }
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
            // Increment version to trigger diff recalculation after redo
            setSchemaChangeVersion((v) => v + 1);
        };
        eventBus.on("redo", handleRedo);

        return () => {
            eventBus.off("pushState", handlePushState);
            eventBus.off("beginTransaction", handleBeginTransaction);
            eventBus.off("endTransaction", handleEndTransaction);
            eventBus.off("getScript", handleGetScript);
            eventBus.off("undo", handleUndo);
            eventBus.off("redo", handleRedo);
        };
    }, []);

    const initializeSchemaDesigner = async () => {
        try {
            setIsInitialized(false);
            setInitializationError(undefined);
            const model = await extensionRpc.sendRequest(
                SchemaDesigner.InitializeSchemaDesignerRequest.type,
            );

            const { nodes, edges } = flowUtils.generateSchemaDesignerFlowComponents(model.schema);

            setDatatypes(model.dataTypes);
            setSchemaNames(model.schemaNames);
            setIsInitialized(true);

            // Store the original schema from the controller for diff computation
            // Use the originalSchema from the server response - this is the baseline from the database
            // when the session was first created (not when the webview was created)
            setOriginalSchema(JSON.parse(JSON.stringify(model.originalSchema)));

            setTimeout(() => {
                stateStack.setInitialState(
                    JSON.parse(
                        JSON.stringify(
                            reactFlow.toObject() as ReactFlowJsonObject<
                                Node<SchemaDesigner.Table>,
                                Edge<SchemaDesigner.ForeignKey>
                            >,
                        ),
                    ) as ReactFlowJsonObject<
                        Node<SchemaDesigner.Table>,
                        Edge<SchemaDesigner.ForeignKey>
                    >,
                );
            }, 200); // Delay to ensure ReactFlow state is synchronized

            return {
                nodes,
                edges,
            };
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            setInitializationError(errorMessage);
            setIsInitialized(false);
            throw error;
        }
    };

    const triggerInitialization = () => {
        setInitializationError(undefined);
        setIsInitialized(false);
        setInitializationRequestId((id) => id + 1);
    };

    // Get the script from the server
    const getDefinition = async () => {
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        const result = await extensionRpc.sendRequest(SchemaDesigner.GetDefinitionRequest.type, {
            updatedSchema: schema,
        });
        return result.script;
    };

    // Reducer callers
    const saveAsFile = (fileProps: SchemaDesigner.ExportFileOptions) => {
        void extensionRpc.sendNotification(SchemaDesigner.ExportToFileNotification.type, fileProps);
    };

    const getReport = async () => {
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        if (!schema) {
            return;
        }

        const result = await extensionRpc.sendRequest(SchemaDesigner.GetReportWebviewRequest.type, {
            updatedSchema: schema,
        });
        return result;
    };

    const copyToClipboard = (text: string) => {
        void extensionRpc.sendNotification(SchemaDesigner.CopyToClipboardNotification.type, {
            text: text,
        });
    };

    const openInEditor = () => {
        void extensionRpc.sendNotification(SchemaDesigner.OpenInEditorNotification.type);
    };

    const openInEditorWithConnection = () => {
        void extensionRpc.sendNotification(
            SchemaDesigner.OpenInEditorWithConnectionNotification.type,
        );
    };

    const extractSchema = () => {
        // Filter out deleted placeholder nodes (those with diff-table-deleted class)
        // These are added for diff visualization only and shouldn't be part of the actual schema
        const nodes = (reactFlow.getNodes() as Node<SchemaDesigner.Table>[]).filter(
            (node) => !node.className?.includes("diff-table-deleted"),
        );
        // Also filter out deleted placeholder edges (diff view overlay)
        const edges = (reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[]).filter(
            (edge) => !edge.id.startsWith("deleted-"),
        );
        const schema = flowUtils.extractSchemaModel(nodes, edges);
        return schema;
    };

    /**
     * Adds a new table to the flow
     */
    const addTable = async (table: SchemaDesigner.Table) => {
        const existingNodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        const existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

        const schemaModel = flowUtils.extractSchemaModel(existingNodes, existingEdges);

        schemaModel.tables.push(table);

        const updatedPositions = flowUtils.generateSchemaDesignerFlowComponents(schemaModel);

        const nodeWithPosition = updatedPositions.nodes.find((node) => node.id === table.id);

        if (!nodeWithPosition) {
            console.error("Node with position not found for table:", table);
            return false;
        }

        const edgesForNewTable = updatedPositions.edges.filter(
            (edge) => edge.source === table.id || edge.target === table.id,
        );

        const visibleNodes = existingNodes.filter((n) => n.hidden !== true);

        // If no node is present, use the default position
        if (visibleNodes.length === 0) {
            nodeWithPosition.position = {
                x: 100,
                y: 100,
            };
        } else {
            // Bottommost node position
            const bottomMostNode = visibleNodes
                .filter((n) => n.hidden !== true)
                .reduce((prev, current) => {
                    // Consider the node's position and height
                    const currentBottom =
                        current.position.y + flowUtils.getTableHeight(current.data);
                    const prevBottom = prev.position.y + flowUtils.getTableHeight(prev.data);
                    return currentBottom > prevBottom ? current : prev;
                });

            // Position the new node below the bottommost node
            nodeWithPosition.position = {
                x: bottomMostNode.position.x,
                y: bottomMostNode.position.y + flowUtils.getTableHeight(bottomMostNode.data) + 50,
            };
        }

        if (nodeWithPosition) {
            existingNodes.push(nodeWithPosition);
            existingEdges.push(...edgesForNewTable);

            reactFlow.setNodes(existingNodes);
            reactFlow.setEdges(existingEdges);
            requestAnimationFrame(async () => {
                setCenter(nodeWithPosition.id, true);
            });
            eventBus.emit("getScript");
            return true;
        }

        return false;
    };

    /**
     * Updates a table in the flow
     */
    const updateTable = async (updatedTable: SchemaDesigner.Table) => {
        const existingNodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        let existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

        const existingTableNode = existingNodes.find((node) => node.id === updatedTable.id);

        if (!existingTableNode) {
            return false;
        }

        // Updating the table name and schema in all foreign keys that reference this table
        // This is necessary because the table name and schema might have changed
        existingEdges.forEach((edge) => {
            if (
                edge?.data?.referencedSchemaName === existingTableNode?.data?.schema &&
                edge?.data?.referencedTableName === existingTableNode?.data?.name
            ) {
                edge.data.referencedSchemaName = updatedTable.schema;
                edge.data.referencedTableName = updatedTable.name;
            }
        });

        // Update the table node with the new data
        existingTableNode.data = updatedTable;

        // Remove the existing foreign keys from the table
        existingEdges = existingEdges.filter((edge) => edge.source !== updatedTable.id);

        // Add the new foreign keys to the table
        updatedTable.foreignKeys.forEach((foreignKey) => {
            const referencedTable = existingNodes.find(
                (node) =>
                    node.data.schema === foreignKey.referencedSchemaName &&
                    node.data.name === foreignKey.referencedTableName,
            );
            if (!referencedTable) {
                return;
            }

            foreignKey.columns.forEach((column, index) => {
                const referencedColumn = foreignKey.referencedColumns[index];
                existingEdges.push({
                    id: `${foreignKey.id}-${column}-${referencedColumn}`,
                    source: updatedTable.id,
                    target: referencedTable.id,
                    sourceHandle: `right-${column}`,
                    targetHandle: `left-${referencedColumn}`,
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                    },
                    data: {
                        ...foreignKey,
                        referencedColumns: [referencedColumn],
                        columns: [column],
                    },
                });
            });
        });

        reactFlow.setNodes(existingNodes);
        reactFlow.setEdges(existingEdges);
        requestAnimationFrame(() => {
            setCenter(updatedTable.id, true);
        });
        return true;
    };

    const deleteTable = async (table: SchemaDesigner.Table) => {
        const node = reactFlow.getNode(table.id);
        if (!node) {
            return false;
        }
        // Deletions triggered from the table node menu are programmatic and may not
        // always flow through the ReactFlow component's onDelete callback.
        // Wrap in a transaction and explicitly push history so undo works reliably.
        eventBus.emit("beginTransaction", "delete-table");
        void reactFlow.deleteElements({ nodes: [node] });
        requestAnimationFrame(() => {
            eventBus.emit("getScript");
            eventBus.emit("pushState");
            eventBus.emit("endTransaction", "delete-table");
        });
        return true;
    };

    /**
     * Gets a table with its foreign keys from the flow
     */
    const getTableWithForeignKeys = (tableId: string): SchemaDesigner.Table | undefined => {
        const schemaModel = extractSchema();
        const table = schemaModel.tables.find((t) => t.id === tableId);

        if (!table) {
            return undefined;
        }

        // Update foreign keys from edges
        table.foreignKeys = foreignKeyUtils.extractForeignKeysFromEdges(
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
            tableId,
            schemaModel,
        );

        return table;
    };

    const deleteSelectedNodes = () => {
        const selectedNodes = reactFlow.getNodes().filter((node) => node.selected);
        if (selectedNodes.length > 0) {
            void reactFlow.deleteElements({
                nodes: selectedNodes,
            });
        } else {
            const selectedEdges = reactFlow.getEdges().filter((edge) => edge.selected);
            void reactFlow.deleteElements({
                nodes: [],
                edges: selectedEdges,
            });
        }
    };

    const updateSelectedNodes = (nodesIds: string[]) => {
        reactFlow.getNodes().forEach((node) => {
            reactFlow.updateNode(node.id, {
                selected: nodesIds.includes(node.id),
            });
        });
    };

    const setCenter = (nodeId: string, shouldZoomIn: boolean = false) => {
        const node = reactFlow.getNode(nodeId) as Node<SchemaDesigner.Table>;
        if (node) {
            // Select the node and deselect others
            reactFlow.getNodes().forEach((n) => {
                reactFlow.updateNode(n.id, {
                    selected: n.id === nodeId,
                });
            });

            void reactFlow.setCenter(
                node.position.x + flowUtils.getTableWidth() / 2,
                node.position.y + flowUtils.getTableHeight(node.data) / 2,
                {
                    zoom: shouldZoomIn ? 1 : reactFlow.getZoom(),
                    duration: 500,
                },
            );
        }
    };

    const publishSession = async () => {
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        const response = await extensionRpc.sendRequest(SchemaDesigner.PublishSessionRequest.type, {
            schema: schema,
        });
        return response;
    };

    const closeDesigner = () => {
        void extensionRpc.sendNotification(SchemaDesigner.CloseSchemaDesignerNotification.type);
    };

    const resetUndoRedoState = () => {
        stateStack.clearHistory();
        eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
    };

    function resetView() {
        setTimeout(async () => {
            await reactFlow.fitView({
                nodes: reactFlow.getNodes().filter((node) => node.hidden !== true),
            });
        }, 10);
    }

    // ========== DIFF VIEW METHODS ==========

    /**
     * Get the current schema diff compared to the original
     */
    const getSchemaDiff = (): SchemaDesigner.SchemaDiff | undefined => {
        if (!originalSchema) return undefined;
        const currentSchema = extractSchema();
        return diffUtils.computeSchemaDiff(originalSchema, currentSchema);
    };

    /**
     * Get change entries for the changes panel
     */
    const getChangeEntries = (): SchemaDesigner.ChangeEntry[] => {
        const diff = getSchemaDiff();
        if (!diff) {
            return [];
        }
        return diffUtils.convertDiffToChangeEntries(diff);
    };

    /**
     * Revert a table change (granular undo)
     */
    const revertTableChange = (tableId: string, changeType: SchemaDesigner.DiffStatus): void => {
        if (!originalSchema) return;

        const existingNodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        let existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

        switch (changeType) {
            case SchemaDesigner.DiffStatus.Added: {
                // Undo table addition - remove the table
                const nodeToRemove = existingNodes.find((n) => n.id === tableId);
                if (nodeToRemove) {
                    // Remove the node and its edges
                    const newNodes = existingNodes.filter((n) => n.id !== tableId);
                    const newEdges = existingEdges.filter(
                        (e) => e.source !== tableId && e.target !== tableId,
                    );
                    reactFlow.setNodes(newNodes);
                    reactFlow.setEdges(newEdges);
                    eventBus.emit("pushState");
                    eventBus.emit("getScript");
                }
                break;
            }

            case SchemaDesigner.DiffStatus.Deleted: {
                // Undo table deletion - restore the original table
                const originalTable = originalSchema.tables.find((t) => t.id === tableId);
                if (originalTable) {
                    void (async () => {
                        eventBus.emit("beginTransaction", "revert-table-deleted");
                        const added = await addTable({ ...originalTable });
                        if (added) {
                            // Also restore foreign keys in other tables that referenced this table
                            // (incoming relationships), so the action is atomic from the user's POV.
                            const nodesAfterAdd =
                                reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
                            let edgesAfterAdd =
                                reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

                            const tableKeyMatches = (fk: SchemaDesigner.ForeignKey) =>
                                fk.referencedSchemaName === originalTable.schema &&
                                fk.referencedTableName === originalTable.name;

                            for (const sourceTable of originalSchema.tables) {
                                if (sourceTable.id === originalTable.id) {
                                    continue;
                                }
                                const incomingFks = sourceTable.foreignKeys.filter(tableKeyMatches);
                                if (incomingFks.length === 0) {
                                    continue;
                                }

                                const sourceNode = nodesAfterAdd.find(
                                    (n) => n.id === sourceTable.id,
                                );
                                const targetNode = nodesAfterAdd.find(
                                    (n) => n.id === originalTable.id,
                                );
                                if (!sourceNode || !targetNode) {
                                    continue;
                                }

                                for (const fk of incomingFks) {
                                    const alreadyPresent = sourceNode.data.foreignKeys?.some(
                                        (existing) => existing.id === fk.id,
                                    );
                                    if (!alreadyPresent) {
                                        sourceNode.data = {
                                            ...sourceNode.data,
                                            foreignKeys: [
                                                ...(sourceNode.data.foreignKeys || []),
                                                { ...fk },
                                            ],
                                        };
                                    }

                                    fk.columns.forEach((col, idx) => {
                                        const refCol = fk.referencedColumns[idx];
                                        const edgeExists = edgesAfterAdd.some(
                                            (e) =>
                                                e.data?.id === fk.id &&
                                                e.source === sourceNode.id &&
                                                e.target === targetNode.id &&
                                                e.sourceHandle === `right-${col}` &&
                                                e.targetHandle === `left-${refCol}`,
                                        );
                                        if (!edgeExists) {
                                            edgesAfterAdd.push({
                                                id: `${fk.id}-${col}-${refCol}`,
                                                source: sourceNode.id,
                                                target: targetNode.id,
                                                sourceHandle: `right-${col}`,
                                                targetHandle: `left-${refCol}`,
                                                markerEnd: { type: MarkerType.ArrowClosed },
                                                data: {
                                                    ...fk,
                                                    columns: [col],
                                                    referencedColumns: [refCol],
                                                },
                                            });
                                        }
                                    });
                                }
                            }

                            reactFlow.setNodes([...nodesAfterAdd]);
                            reactFlow.setEdges([...edgesAfterAdd]);
                            eventBus.emit("pushState");
                            eventBus.emit("getScript");
                        }
                        eventBus.emit("endTransaction", "revert-table-deleted");
                    })();
                }
                break;
            }

            case SchemaDesigner.DiffStatus.Modified: {
                // Undo table modifications - restore to original state
                const originalTable = originalSchema.tables.find((t) => t.id === tableId);
                if (originalTable) {
                    // Update the node with original data
                    const nodeIndex = existingNodes.findIndex((n) => n.id === tableId);
                    if (nodeIndex !== -1) {
                        existingNodes[nodeIndex].data = { ...originalTable };

                        // Remove current edges for this table
                        existingEdges = existingEdges.filter((e) => e.source !== tableId);

                        // Recreate edges from original foreign keys
                        for (const fk of originalTable.foreignKeys) {
                            const targetTable = existingNodes.find(
                                (n) =>
                                    n.data.schema === fk.referencedSchemaName &&
                                    n.data.name === fk.referencedTableName,
                            );
                            if (targetTable) {
                                fk.columns.forEach((col, idx) => {
                                    existingEdges.push({
                                        id: `${fk.id}-${col}-${fk.referencedColumns[idx]}`,
                                        source: tableId,
                                        target: targetTable.id,
                                        sourceHandle: `right-${col}`,
                                        targetHandle: `left-${fk.referencedColumns[idx]}`,
                                        markerEnd: { type: MarkerType.ArrowClosed },
                                        data: {
                                            ...fk,
                                            columns: [col],
                                            referencedColumns: [fk.referencedColumns[idx]],
                                        },
                                    });
                                });
                            }
                        }

                        reactFlow.setNodes([...existingNodes]);
                        reactFlow.setEdges([...existingEdges]);
                        eventBus.emit("pushState");
                        eventBus.emit("getScript");
                    }
                }
                break;
            }
        }
    };

    /**
     * Revert a column change (granular undo)
     */
    const revertColumnChange = (
        tableId: string,
        columnId: string,
        changeType: SchemaDesigner.DiffStatus,
    ): void => {
        if (!originalSchema) return;

        const existingNodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        const nodeIndex = existingNodes.findIndex((n) => n.id === tableId);

        if (nodeIndex === -1) return;

        const tableNode = existingNodes[nodeIndex];
        const originalTable = originalSchema.tables.find((t) => t.id === tableId);

        switch (changeType) {
            case SchemaDesigner.DiffStatus.Added: {
                // Undo column addition - remove the column
                tableNode.data = {
                    ...tableNode.data,
                    columns: tableNode.data.columns.filter((c) => c.id !== columnId),
                };
                break;
            }

            case SchemaDesigner.DiffStatus.Deleted: {
                // Undo column deletion - restore the original column
                if (originalTable) {
                    const originalColumn = originalTable.columns.find((c) => c.id === columnId);
                    if (originalColumn) {
                        // Preserve original ordering:
                        // 1) Rebuild the "original columns" portion in originalTable order, using current
                        //    versions for existing columns and original version for the restored column.
                        // 2) Append any newly-added columns (not present in originalTable) in their current order.
                        const originalIds = new Set(originalTable.columns.map((c) => c.id));
                        const currentById = new Map(
                            tableNode.data.columns.map((c) => [c.id, c] as const),
                        );

                        const rebuiltOriginalCols = originalTable.columns
                            .filter((c) => c.id === columnId || currentById.has(c.id))
                            .map((c) => {
                                if (c.id === columnId) {
                                    return { ...originalColumn };
                                }
                                return { ...(currentById.get(c.id) as SchemaDesigner.Column) };
                            });

                        const newCols = tableNode.data.columns
                            .filter((c) => !originalIds.has(c.id))
                            .map((c) => ({ ...c }));

                        tableNode.data = {
                            ...tableNode.data,
                            columns: [...rebuiltOriginalCols, ...newCols],
                        };
                    }
                }
                break;
            }

            case SchemaDesigner.DiffStatus.Modified: {
                // Undo column modification - restore to original state
                if (originalTable) {
                    const originalColumn = originalTable.columns.find((c) => c.id === columnId);
                    if (originalColumn) {
                        tableNode.data = {
                            ...tableNode.data,
                            columns: tableNode.data.columns.map((c) =>
                                c.id === columnId ? { ...originalColumn } : c,
                            ),
                        };
                    }
                }
                break;
            }
        }

        reactFlow.setNodes([...existingNodes]);
        eventBus.emit("pushState");
        eventBus.emit("getScript");
    };

    /**
     * Revert a foreign key change (granular undo)
     */
    const revertForeignKeyChange = (
        tableId: string,
        foreignKeyId: string,
        changeType: SchemaDesigner.DiffStatus,
    ): void => {
        if (!originalSchema) return;

        const existingNodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        let existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

        const nodeIndex = existingNodes.findIndex((n) => n.id === tableId);
        if (nodeIndex === -1) return;

        const tableNode = existingNodes[nodeIndex];
        const originalTable = originalSchema.tables.find((t) => t.id === tableId);

        switch (changeType) {
            case SchemaDesigner.DiffStatus.Added: {
                // Undo FK addition - remove the foreign key and its edges
                existingEdges = existingEdges.filter((e) => e.data?.id !== foreignKeyId);
                tableNode.data = {
                    ...tableNode.data,
                    foreignKeys: tableNode.data.foreignKeys.filter((fk) => fk.id !== foreignKeyId),
                };
                break;
            }

            case SchemaDesigner.DiffStatus.Modified: {
                // Undo FK modification - restore original FK definition
                if (originalTable) {
                    const originalFK = originalTable.foreignKeys.find(
                        (fk) => fk.id === foreignKeyId,
                    );
                    if (!originalFK) {
                        return;
                    }

                    // Remove current FK edges and definition
                    existingEdges = existingEdges.filter((e) => e.data?.id !== foreignKeyId);
                    tableNode.data = {
                        ...tableNode.data,
                        foreignKeys: tableNode.data.foreignKeys
                            .filter((fk) => fk.id !== foreignKeyId)
                            .concat({ ...originalFK }),
                    };

                    const targetTable = existingNodes.find(
                        (n) =>
                            n.data.schema === originalFK.referencedSchemaName &&
                            n.data.name === originalFK.referencedTableName,
                    );

                    if (!targetTable) {
                        eventBus.emit("showToast", {
                            title: "Undo failed",
                            body: "Cannot restore the foreign key because the referenced table is deleted. Restore the table first.",
                            intent: "error",
                        });
                        return;
                    }

                    originalFK.columns.forEach((col, idx) => {
                        const refCol = originalFK.referencedColumns[idx];
                        existingEdges.push({
                            id: `${originalFK.id}-${col}-${refCol}`,
                            source: tableId,
                            target: targetTable.id,
                            sourceHandle: `right-${col}`,
                            targetHandle: `left-${refCol}`,
                            markerEnd: { type: MarkerType.ArrowClosed },
                            data: {
                                ...originalFK,
                                columns: [col],
                                referencedColumns: [refCol],
                            },
                        });
                    });
                }
                break;
            }

            case SchemaDesigner.DiffStatus.Deleted: {
                // Undo FK deletion - restore the original foreign key
                if (originalTable) {
                    const originalFK = originalTable.foreignKeys.find(
                        (fk) => fk.id === foreignKeyId,
                    );
                    if (originalFK) {
                        const targetTable = existingNodes.find(
                            (n) =>
                                n.data.schema === originalFK.referencedSchemaName &&
                                n.data.name === originalFK.referencedTableName,
                        );

                        if (!targetTable) {
                            eventBus.emit("showToast", {
                                title: "Undo failed",
                                body: "Cannot restore the foreign key because the referenced table is deleted. Restore the table first.",
                                intent: "error",
                            });
                            return;
                        }

                        // Add the FK back to the table
                        tableNode.data = {
                            ...tableNode.data,
                            foreignKeys: [...tableNode.data.foreignKeys, { ...originalFK }],
                        };

                        // Recreate the edges
                        originalFK.columns.forEach((col, idx) => {
                            const refCol = originalFK.referencedColumns[idx];
                            existingEdges.push({
                                id: `${originalFK.id}-${col}-${refCol}`,
                                source: tableId,
                                target: targetTable.id,
                                sourceHandle: `right-${col}`,
                                targetHandle: `left-${refCol}`,
                                markerEnd: { type: MarkerType.ArrowClosed },
                                data: {
                                    ...originalFK,
                                    columns: [col],
                                    referencedColumns: [refCol],
                                },
                            });
                        });
                    }
                }
                break;
            }
        }

        reactFlow.setNodes([...existingNodes]);
        reactFlow.setEdges([...existingEdges]);
        eventBus.emit("pushState");
        eventBus.emit("getScript");
    };

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewContext),
                extensionRpc,
                state,
                themeKind,
                keyBindings,
                schemaNames,
                datatypes,
                findTableText,
                setFindTableText,
                getDefinition,
                initializeSchemaDesigner,
                initializationError,
                initializationRequestId,
                triggerInitialization,
                saveAsFile,
                getReport,
                openInEditor,
                openInEditorWithConnection,
                copyToClipboard,
                extractSchema,
                getTableWithForeignKeys,
                updateTable,
                addTable,
                deleteTable,
                deleteSelectedNodes,
                updateSelectedNodes,
                setCenter,
                publishSession,
                isInitialized,
                closeDesigner,
                resetUndoRedoState,
                resetView,
                renderOnlyVisibleTables,
                setRenderOnlyVisibleTables,
                isExporting,
                setIsExporting,
                // Diff view properties
                isDiffViewEnabled,
                setDiffViewEnabled,
                originalSchema,
                schemaChangeVersion,
                getSchemaDiff,
                getChangeEntries,
                revertTableChange,
                revertColumnChange,
                revertForeignKeyChange,
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
