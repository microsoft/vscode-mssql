/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useRef, useState, useCallback } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { Dab } from "../../../sharedInterfaces/dab";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs, getErrorMessage } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, MarkerType, Node, ReactFlowJsonObject, useReactFlow } from "@xyflow/react";
import { flowUtils, foreignKeyUtils } from "./schemaDesignerUtils";
import eventBus from "./schemaDesignerEvents";
import {
    registerSchemaDesignerApplyEditsHandler,
    registerSchemaDesignerGetSchemaStateHandler,
} from "./schemaDesignerRpcHandlers";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";
import {
    calculateSchemaDiff,
    ChangeAction,
    ChangeCategory,
    SchemaChange,
    SchemaChangesSummary,
} from "./diff/diffUtils";
import {
    getDeletedColumnIdsByTable,
    getDeletedForeignKeyIds,
    getDeletedTableIds,
    getModifiedColumnHighlights,
    getModifiedForeignKeyIds,
    getModifiedTableHighlights,
    getNewColumnIds,
    getNewForeignKeyIds,
    getNewTableIds,
    type ModifiedColumnHighlight,
    type ModifiedTableHighlight,
} from "./diff/diffHighlights";
import {
    buildDeletedForeignKeyEdges,
    filterDeletedEdges,
    filterDeletedNodes,
    toSchemaTables,
} from "./diff/deletedVisualUtils";
import { describeChange } from "./diff/schemaDiff";
import {
    canRevertChange as canRevertChangeCore,
    computeRevertedSchema,
    CanRevertResult,
} from "./diff/revertChange";
import { locConstants } from "../../common/locConstants";
import {
    applyColumnRenamesToIncomingForeignKeyEdges,
    applyColumnRenamesToOutgoingForeignKeyEdges,
    buildForeignKeyEdgeId,
    removeEdgesForForeignKey,
} from "./schemaDesignerEdgeUtils";
import {
    normalizeColumn,
    normalizeTable,
    waitForNextFrame,
    validateTable,
} from "./schemaDesignerToolBatchUtils";
import { useSchemaDesignerToolBatchHandlers } from "./schemaDesignerToolBatchHooks";
import { stateStack } from "./schemaDesignerUndoState";

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
    deleteTable: (table: SchemaDesigner.Table, skipConfirmation?: boolean) => Promise<boolean>;
    deleteSelectedNodes: () => void;
    getTableWithForeignKeys: (tableId: string) => SchemaDesigner.Table | undefined;
    updateSelectedNodes: (nodesIds: string[]) => void;
    setCenter: (nodeId: string, shouldZoomIn?: boolean) => void;
    consumeSkipDeleteConfirmation: () => boolean;
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
    isChangesPanelVisible: boolean;
    setIsChangesPanelVisible: (value: boolean) => void;
    newTableIds: Set<string>;
    newColumnIds: Set<string>;
    newForeignKeyIds: Set<string>;
    modifiedForeignKeyIds: Set<string>;
    modifiedColumnHighlights: Map<string, ModifiedColumnHighlight>;
    modifiedTableHighlights: Map<string, ModifiedTableHighlight>;
    deletedColumnsByTable: Map<string, SchemaDesigner.Column[]>;
    deletedForeignKeyEdges: Edge<SchemaDesigner.ForeignKey>[];
    baselineColumnOrderByTable: Map<string, string[]>;
    deletedTableNodes: Node<SchemaDesigner.Table>[];

    // Diff/Changes
    schemaChangesCount: number;
    schemaChanges: string[];
    schemaChangesSummary: SchemaChangesSummary | undefined;
    structuredSchemaChanges: SchemaChange[];
    revertChange: (change: SchemaChange) => void;
    canRevertChange: (change: SchemaChange) => CanRevertResult;

    // DAB (Data API Builder) state
    dabConfig: Dab.DabConfig | null;
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
    updateDabApiTypes: (apiTypes: Dab.ApiType[]) => void;
    toggleDabEntity: (entityId: string, isEnabled: boolean) => void;
    toggleDabEntityAction: (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => void;
    updateDabEntitySettings: (entityId: string, settings: Dab.EntityAdvancedSettings) => void;
    dabSchemaFilter: string[];
    setDabSchemaFilter: (schemas: string[]) => void;
    dabConfigContent: string;
    dabConfigRequestId: number;
    generateDabConfig: () => Promise<void>;
    openDabConfigInEditor: (configContent: string) => void;
    // DAB Deployment state
    dabDeploymentState: Dab.DabDeploymentState;
    openDabDeploymentDialog: () => void;
    closeDabDeploymentDialog: () => void;
    setDabDeploymentDialogStep: (step: Dab.DabDeploymentDialogStep) => void;
    updateDabDeploymentParams: (params: Partial<Dab.DabDeploymentParams>) => void;
    runDabDeploymentStep: (step: Dab.DabDeploymentStepOrder) => Promise<void>;
    resetDabDeploymentState: () => void;
    retryDabDeploymentSteps: () => void;
}

const SchemaDesignerContext = createContext<SchemaDesignerContextProps>(
    undefined as unknown as SchemaDesignerContextProps,
);

interface SchemaDesignerProviderProps {
    children: React.ReactNode;
}

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
    const reactFlow = useReactFlow<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>();
    const [isInitialized, setIsInitialized] = useState(false);
    const isInitializedRef = useRef(false); // Ref to track initialization status for closures
    const [initializationError, setInitializationError] = useState<string | undefined>(undefined);
    const [initializationRequestId, setInitializationRequestId] = useState(0);
    const [findTableText, setFindTableText] = useState<string>("");
    const [renderOnlyVisibleTables, setRenderOnlyVisibleTables] = useState<boolean>(true);
    const [isExporting, setIsExporting] = useState<boolean>(false);
    const skipDeleteConfirmationRef = useRef(false);
    const [isChangesPanelVisible, setIsChangesPanelVisible] = useState<boolean>(false);

    // Baseline schema is fetched from the extension and must survive webview restore.
    const baselineSchemaRef = useRef<SchemaDesigner.Schema | undefined>(undefined);
    const lastHasChangesRef = useRef<boolean | undefined>(undefined);
    // Ref to store pending flow state during undo/redo. This ensures diff calculation
    // uses the correct state immediately, without waiting for ReactFlow's async updates.
    const pendingFlowStateRef = useRef<{
        nodes: Node<SchemaDesigner.Table>[];
        edges: Edge<SchemaDesigner.ForeignKey>[];
    } | null>(null);
    const [schemaChangesCount, setSchemaChangesCount] = useState<number>(0);
    const [schemaChanges, setSchemaChanges] = useState<string[]>([]);
    const [schemaChangesSummary, setSchemaChangesSummary] = useState<
        SchemaChangesSummary | undefined
    >(undefined);
    const [structuredSchemaChanges, setStructuredSchemaChanges] = useState<SchemaChange[]>([]);
    const [newTableIds, setNewTableIds] = useState<Set<string>>(new Set());
    const [newColumnIds, setNewColumnIds] = useState<Set<string>>(new Set());
    const [newForeignKeyIds, setNewForeignKeyIds] = useState<Set<string>>(new Set());
    const [modifiedForeignKeyIds, setModifiedForeignKeyIds] = useState<Set<string>>(new Set());
    const [modifiedColumnHighlights, setModifiedColumnHighlights] = useState<
        Map<string, ModifiedColumnHighlight>
    >(new Map());
    const [modifiedTableHighlights, setModifiedTableHighlights] = useState<
        Map<string, ModifiedTableHighlight>
    >(new Map());
    const [deletedColumnsByTable, setDeletedColumnsByTable] = useState<
        Map<string, SchemaDesigner.Column[]>
    >(new Map());
    const [deletedForeignKeyEdges, setDeletedForeignKeyEdges] = useState<
        Edge<SchemaDesigner.ForeignKey>[]
    >([]);
    const [baselineColumnOrderByTable, setBaselineColumnOrderByTable] = useState<
        Map<string, string[]>
    >(new Map());
    const [deletedTableNodes, setDeletedTableNodes] = useState<Node<SchemaDesigner.Table>[]>([]);

    // DAB state
    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabSchemaFilter, setDabSchemaFilter] = useState<string[]>([]);
    const [dabConfigContent, setDabConfigContent] = useState<string>("");
    const [dabConfigRequestId, setDabConfigRequestId] = useState<number>(0);
    const [dabDeploymentState, setDabDeploymentState] = useState<Dab.DabDeploymentState>(
        Dab.createDefaultDeploymentState(),
    );

    const { onPushUndoState, maybeAutoArrangeForToolBatch } = useSchemaDesignerToolBatchHandlers({
        reactFlow,
        resetView,
    });

    useEffect(() => {
        const handleScript = () => {
            setTimeout(() => {
                const state = reactFlow.toObject() as ReactFlowJsonObject<
                    Node<SchemaDesigner.Table>,
                    Edge<SchemaDesigner.ForeignKey>
                >;
                stateStack.pushState(state);
                eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
            }, 100);
        };
        eventBus.on("pushState", handleScript);

        const handleUndo = () => {
            if (!stateStack.canUndo()) {
                return;
            }
            const state = stateStack.undo();
            if (!state) {
                return;
            }
            // Store the state in a ref BEFORE calling setNodes/setEdges.
            // This ensures updateSchemaChanges can read the correct state immediately.
            pendingFlowStateRef.current = {
                nodes: state.nodes as Node<SchemaDesigner.Table>[],
                edges: state.edges as Edge<SchemaDesigner.ForeignKey>[],
            };
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
            eventBus.emit("refreshFlowState");
            eventBus.emit("getScript");
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
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
            // Store the state in a ref BEFORE calling setNodes/setEdges.
            // This ensures updateSchemaChanges can read the correct state immediately.
            pendingFlowStateRef.current = {
                nodes: state.nodes as Node<SchemaDesigner.Table>[],
                edges: state.edges as Edge<SchemaDesigner.ForeignKey>[],
            };
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
            eventBus.emit("refreshFlowState");
            eventBus.emit("getScript");
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
        };
        eventBus.on("redo", handleRedo);

        return () => {
            eventBus.off("pushState", handleScript);
            eventBus.off("undo", handleUndo);
            eventBus.off("redo", handleRedo);
        };
    }, []);

    // Handle bulk edits (schema designer LM tool) from extension
    useEffect(() => {
        registerSchemaDesignerApplyEditsHandler({
            isInitialized,
            extensionRpc,
            schemaNames,
            datatypes,
            waitForNextFrame,
            extractSchema,
            onMaybeAutoArrange: maybeAutoArrangeForToolBatch,
            addTable,
            updateTable,
            deleteTable,
            normalizeColumn,
            normalizeTable,
            validateTable,
            onPushUndoState,
            onRequestScriptRefresh: () => eventBus.emit("getScript"),
        });
    }, [isInitialized, extensionRpc, schemaNames, datatypes, reactFlow, onPushUndoState]);

    // Respond with the current schema state
    useEffect(() => {
        registerSchemaDesignerGetSchemaStateHandler({
            isInitialized,
            extensionRpc,
            extractSchema,
        });
    }, [isInitialized, extensionRpc]);
    useEffect(() => {
        const updateSchemaChanges = async () => {
            // Use ref instead of state to avoid stale closure issues
            if (!isInitializedRef.current) {
                return;
            }

            try {
                if (!baselineSchemaRef.current) {
                    baselineSchemaRef.current = await extensionRpc.sendRequest(
                        SchemaDesigner.GetBaselineSchemaRequest.type,
                    );
                }

                if (!baselineSchemaRef.current) {
                    return;
                }

                // Use pending flow state if available (set by undo/redo),
                // otherwise read from ReactFlow's store.
                const pendingState = pendingFlowStateRef.current;
                const nodes =
                    pendingState?.nodes ?? (reactFlow.getNodes() as Node<SchemaDesigner.Table>[]);
                const edges =
                    pendingState?.edges ??
                    (reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[]);
                // Clear the pending state after reading it
                pendingFlowStateRef.current = null;

                const currentSchema = flowUtils.extractSchemaModel(nodes, edges);

                const summary = calculateSchemaDiff(baselineSchemaRef.current, currentSchema);

                // Flatten all changes for the structured list
                const allChanges = summary.groups.flatMap((group) => group.changes);
                setStructuredSchemaChanges(allChanges);
                setSchemaChangesSummary(summary);
                if (baselineSchemaRef.current) {
                    const orderMap = new Map<string, string[]>();
                    for (const table of baselineSchemaRef.current.tables) {
                        orderMap.set(
                            table.id,
                            (table.columns ?? []).map((column) => column.id),
                        );
                    }
                    setBaselineColumnOrderByTable(orderMap);
                } else {
                    setBaselineColumnOrderByTable(new Map());
                }
                setNewTableIds(getNewTableIds(summary));
                setNewColumnIds(getNewColumnIds(summary));
                setNewForeignKeyIds(getNewForeignKeyIds(summary));
                setModifiedColumnHighlights(getModifiedColumnHighlights(summary));
                setModifiedTableHighlights(getModifiedTableHighlights(summary));
                setModifiedForeignKeyIds(getModifiedForeignKeyIds(summary));
                const deletedColumnsByTableIds = getDeletedColumnIdsByTable(summary);
                const deletedForeignKeyIds = getDeletedForeignKeyIds(summary);
                const deletedTableIds = getDeletedTableIds(summary);

                if (baselineSchemaRef.current) {
                    const baselineTablesById = new Map(
                        baselineSchemaRef.current.tables.map((table) => [table.id, table]),
                    );
                    const deletedColumns = new Map<string, SchemaDesigner.Column[]>();
                    if (deletedColumnsByTableIds.size > 0) {
                        for (const [tableId, columnIds] of deletedColumnsByTableIds) {
                            const baselineTable = baselineTablesById.get(tableId);
                            if (!baselineTable) {
                                continue;
                            }
                            const columns = baselineTable.columns.filter((column) =>
                                columnIds.has(column.id),
                            );
                            if (columns.length > 0) {
                                deletedColumns.set(
                                    tableId,
                                    columns.map((column) => ({ ...column })),
                                );
                            }
                        }
                    }

                    // Get current nodes to position deleted tables below them
                    const currentNodes = filterDeletedNodes(
                        reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
                    );

                    // Calculate the bottommost Y position of current tables
                    let bottomY = 100; // Default starting position
                    if (currentNodes.length > 0) {
                        const visibleCurrentNodes = currentNodes.filter((n) => n.hidden !== true);
                        if (visibleCurrentNodes.length > 0) {
                            bottomY = visibleCurrentNodes.reduce((maxY, node) => {
                                const nodeBottom =
                                    node.position.y + flowUtils.getTableHeight(node.data);
                                return Math.max(maxY, nodeBottom);
                            }, 0);
                            bottomY += 50; // Add spacing below current tables
                        }
                    }

                    const deletedNodes =
                        deletedTableIds.size > 0
                            ? flowUtils
                                  .generateSchemaDesignerFlowComponents(baselineSchemaRef.current)
                                  .nodes.filter((node) => deletedTableIds.has(node.id))
                                  .map((node, index) => ({
                                      ...node,
                                      id: `deleted-${node.id}`,
                                      data: { ...node.data, isDeleted: true },
                                      // Position deleted tables below current tables
                                      position: {
                                          x: 100 + (index % 3) * (flowUtils.getTableWidth() + 50),
                                          y:
                                              bottomY +
                                              Math.floor(index / 3) *
                                                  (flowUtils.getTableHeight(node.data) + 50),
                                      },
                                      draggable: true,
                                      selectable: false,
                                      connectable: false,
                                      deletable: false,
                                      focusable: false,
                                  }))
                            : [];

                    const deletedEdges =
                        deletedForeignKeyIds.size > 0
                            ? buildDeletedForeignKeyEdges({
                                  baselineSchema: baselineSchemaRef.current,
                                  currentNodes: filterDeletedNodes(
                                      reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
                                  ),
                                  deletedForeignKeyIds,
                                  deletedTableNodes: deletedNodes,
                              })
                            : [];

                    setDeletedColumnsByTable(deletedColumns);
                    setDeletedForeignKeyEdges(deletedEdges);
                    setDeletedTableNodes(deletedNodes);
                } else {
                    setDeletedColumnsByTable(new Map());
                    setDeletedForeignKeyEdges([]);
                    setDeletedTableNodes([]);
                }

                const changeStrings = summary.groups.flatMap((group) =>
                    group.changes.map((change) => {
                        const description = describeChange(change);
                        if (change.category === ChangeCategory.Table) {
                            return description;
                        }
                        const qualifiedTableName = `[${group.tableSchema}].[${group.tableName}]`;
                        return locConstants.schemaDesigner.schemaChangeInTable(
                            qualifiedTableName,
                            description,
                        );
                    }),
                );

                setSchemaChangesCount(summary.totalChanges);
                setSchemaChanges(changeStrings);

                const hasChanges = summary.totalChanges > 0;
                if (lastHasChangesRef.current !== hasChanges) {
                    lastHasChangesRef.current = hasChanges;
                    void extensionRpc.sendNotification(
                        SchemaDesigner.SchemaDesignerDirtyStateNotification.type,
                        { hasChanges },
                    );
                }
            } catch {
                // Ignore diff errors; schema designer should remain usable.
            }
        };

        const handler = () => {
            // getScript events can fire in quick succession; schedule after UI updates.
            setTimeout(() => {
                void updateSchemaChanges();
            }, 0);
        };

        eventBus.on("getScript", handler);
        return () => {
            eventBus.off("getScript", handler);
        };
    }, [extensionRpc, reactFlow]);

    const initializeSchemaDesigner = async () => {
        try {
            setIsInitialized(false);
            isInitializedRef.current = false;
            setInitializationError(undefined);
            const model = await extensionRpc.sendRequest(
                SchemaDesigner.InitializeSchemaDesignerRequest.type,
            );

            // Fetch baseline schema snapshot for diffing (must come from extension to survive restores)
            try {
                baselineSchemaRef.current = await extensionRpc.sendRequest(
                    SchemaDesigner.GetBaselineSchemaRequest.type,
                );
            } catch {
                baselineSchemaRef.current = model.schema;
            }

            const { nodes, edges } = flowUtils.generateSchemaDesignerFlowComponents(model.schema);

            setDatatypes(model.dataTypes);
            setSchemaNames(model.schemaNames);
            setIsInitialized(true);
            isInitializedRef.current = true;

            setTimeout(() => {
                stateStack.setInitialState(
                    reactFlow.toObject() as ReactFlowJsonObject<
                        Node<SchemaDesigner.Table>,
                        Edge<SchemaDesigner.ForeignKey>
                    >,
                );
            });

            return {
                nodes,
                edges,
            };
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            setInitializationError(errorMessage);
            setIsInitialized(false);
            isInitializedRef.current = false;
            throw error;
        }
    };

    const triggerInitialization = () => {
        setInitializationError(undefined);
        setIsInitialized(false);
        isInitializedRef.current = false;
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
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        return schema;
    };

    /**
     * Adds a new table to the flow
     */
    const addTable = async (table: SchemaDesigner.Table) => {
        const existingNodes = filterDeletedNodes(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
        );
        const existingEdges = filterDeletedEdges(
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );

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
            eventBus.emit("refreshFlowState");
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

        // Track column renames so we can update incoming FK handles/data.
        const renamedColumns = new Map<string, string>();
        for (const oldCol of existingTableNode.data.columns ?? []) {
            const newCol = updatedTable.columns.find((c) => c.id === oldCol.id);
            if (newCol && newCol.name !== oldCol.name) {
                renamedColumns.set(oldCol.name, newCol.name);
            }
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

        // If columns were renamed, update incoming FK edges to point to the new column names.
        applyColumnRenamesToIncomingForeignKeyEdges(existingEdges, updatedTable.id, renamedColumns);

        // Keep outgoing FK metadata in sync with column renames on this table.
        if (renamedColumns.size > 0) {
            for (const foreignKey of updatedTable.foreignKeys ?? []) {
                foreignKey.columns = foreignKey.columns.map((c) => renamedColumns.get(c) ?? c);
            }
        }

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

                const sourceColumnId = updatedTable.columns.find((c) => c.name === column)?.id;
                const referencedColumnId = referencedTable.data.columns.find(
                    (c) => c.name === referencedColumn,
                )?.id;

                if (!sourceColumnId || !referencedColumnId) {
                    return;
                }
                existingEdges.push({
                    id: buildForeignKeyEdgeId(
                        updatedTable.id,
                        referencedTable.id,
                        sourceColumnId,
                        referencedColumnId,
                    ),
                    source: updatedTable.id,
                    target: referencedTable.id,
                    sourceHandle: `right-${sourceColumnId}`,
                    targetHandle: `left-${referencedColumnId}`,
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
        eventBus.emit("refreshFlowState");
        requestAnimationFrame(() => {
            setCenter(updatedTable.id, true);
        });
        return true;
    };

    const deleteTable = async (table: SchemaDesigner.Table, skipConfirmation = false) => {
        const node = reactFlow.getNode(table.id);
        if (!node) {
            return false;
        }
        if (skipConfirmation) {
            skipDeleteConfirmationRef.current = true;
        }
        await reactFlow.deleteElements({ nodes: [node] });
        eventBus.emit("pushState");
        return true;
    };

    const consumeSkipDeleteConfirmation = () => {
        const shouldSkip = skipDeleteConfirmationRef.current;
        skipDeleteConfirmationRef.current = false;
        return shouldSkip;
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

    /**
     * Checks if a change can be reverted.
     * Foreign keys referencing deleted tables/columns cannot be simply reverted.
     */
    const canRevertChange = (change: SchemaChange): CanRevertResult => {
        const loc = locConstants.schemaDesigner.changesPanel;

        if (!baselineSchemaRef.current) {
            return { canRevert: false, reason: loc.cannotRevertForeignKey };
        }

        // Get current tables from React Flow nodes, excluding deleted ghost nodes
        const currentNodes = filterDeletedNodes(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
        );
        const currentSchema = {
            tables: toSchemaTables(currentNodes),
        };

        // Pass localized messages to the core function
        const messages = {
            cannotRevertForeignKey: loc.cannotRevertForeignKey,
            cannotRevertDeletedColumn: loc.cannotRevertDeletedColumn,
        };

        return canRevertChangeCore(
            change,
            baselineSchemaRef.current,
            currentSchema,
            structuredSchemaChanges,
            messages,
        );
    };

    /**
     * Reverts a change to its baseline state.
     * Uses the core revert logic and applies the result to React Flow.
     */
    const revertChange = (change: SchemaChange) => {
        if (!baselineSchemaRef.current) {
            return;
        }

        // Get current state from React Flow
        const existingNodes = filterDeletedNodes(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
        );
        let existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
        const currentSchema = {
            tables: toSchemaTables(existingNodes),
        };

        // For table add revert (delete), use React Flow's deleteElements for proper cleanup
        if (change.category === ChangeCategory.Table && change.action === ChangeAction.Add) {
            const nodeToDelete = existingNodes.find((n) => n.id === change.tableId);
            if (nodeToDelete) {
                void reactFlow.deleteElements({ nodes: [nodeToDelete] });
                eventBus.emit("pushState");
                eventBus.emit("getScript");
                return;
            }
        }

        // For table delete revert (restore), use addTable for proper node creation
        if (change.category === ChangeCategory.Table && change.action === ChangeAction.Delete) {
            const baselineTable = baselineSchemaRef.current.tables.find(
                (t) => t.id === change.tableId,
            );
            if (baselineTable) {
                void addTable({ ...baselineTable, foreignKeys: [] });
                eventBus.emit("pushState");
                eventBus.emit("getScript");
                return;
            }
        }

        // Use core logic for the data transformation
        const result = computeRevertedSchema(change, baselineSchemaRef.current, currentSchema);

        if (!result.success) {
            console.error("Failed to revert change:", result.error);
            return;
        }

        // Apply the reverted tables back to React Flow nodes
        const updatedNodes = existingNodes.map((node) => {
            const revertedTable = result.tables.find((t) => t.id === node.id);
            if (revertedTable) {
                return {
                    ...node,
                    data: revertedTable,
                };
            }
            return node;
        });

        // Handle column rename edge updates (incoming + outgoing)
        if (change.category === ChangeCategory.Column && change.action === ChangeAction.Modify) {
            const beforeTable = existingNodes.find((n) => n.id === change.tableId)?.data;
            const afterTable = updatedNodes.find((n) => n.id === change.tableId)?.data;

            const beforeName = beforeTable?.columns.find((c) => c.id === change.objectId)?.name;
            const afterName = afterTable?.columns.find((c) => c.id === change.objectId)?.name;

            if (beforeName && afterName && beforeName !== afterName) {
                const renameMap = new Map<string, string>([[beforeName, afterName]]);
                applyColumnRenamesToIncomingForeignKeyEdges(
                    existingEdges,
                    change.tableId,
                    renameMap,
                );
                applyColumnRenamesToOutgoingForeignKeyEdges(
                    existingEdges,
                    change.tableId,
                    renameMap,
                );
                reactFlow.setEdges(existingEdges);
            }
        }

        // Handle foreign key edge updates
        if (change.category === ChangeCategory.ForeignKey) {
            const currentNode = updatedNodes.find((n) => n.id === change.tableId);

            if (change.action === ChangeAction.Add) {
                // Revert add = remove all edges belonging to this FK
                existingEdges = removeEdgesForForeignKey(existingEdges, change.objectId);
            } else if (
                change.action === ChangeAction.Delete ||
                change.action === ChangeAction.Modify
            ) {
                // Remove existing edges for this FK and recreate them
                existingEdges = removeEdgesForForeignKey(existingEdges, change.objectId);

                const baselineTable = baselineSchemaRef.current.tables.find(
                    (t) => t.id === change.tableId,
                );
                const baselineFk = baselineTable?.foreignKeys?.find(
                    (fk) => fk.id === change.objectId,
                );

                if (baselineFk && currentNode) {
                    const referencedTable = updatedNodes.find(
                        (n) =>
                            n.data.schema === baselineFk.referencedSchemaName &&
                            n.data.name === baselineFk.referencedTableName,
                    );

                    if (referencedTable) {
                        baselineFk.columns.forEach((column, index) => {
                            const referencedColumn = baselineFk.referencedColumns[index];

                            const sourceColumnId = currentNode.data.columns.find(
                                (c) => c.name === column,
                            )?.id;
                            const referencedColumnId = referencedTable.data.columns.find(
                                (c) => c.name === referencedColumn,
                            )?.id;

                            if (!sourceColumnId || !referencedColumnId) {
                                return;
                            }
                            existingEdges.push({
                                id: buildForeignKeyEdgeId(
                                    currentNode.id,
                                    referencedTable.id,
                                    sourceColumnId,
                                    referencedColumnId,
                                ),
                                source: currentNode.id,
                                target: referencedTable.id,
                                sourceHandle: `right-${sourceColumnId}`,
                                targetHandle: `left-${referencedColumnId}`,
                                markerEnd: { type: MarkerType.ArrowClosed },
                                data: {
                                    ...baselineFk,
                                    referencedColumns: [referencedColumn],
                                    columns: [column],
                                },
                            });
                        });
                    }
                }
            }

            reactFlow.setEdges(existingEdges);
        }

        reactFlow.setNodes(updatedNodes);
        eventBus.emit("refreshFlowState");
        eventBus.emit("pushState");
        eventBus.emit("getScript");
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

        // After publish, reset baseline to the published schema so changes clear.
        const updatedSchema = (response as unknown as { updatedSchema?: SchemaDesigner.Schema })
            .updatedSchema;
        if (updatedSchema) {
            baselineSchemaRef.current = updatedSchema;
        } else {
            try {
                baselineSchemaRef.current = await extensionRpc.sendRequest(
                    SchemaDesigner.GetBaselineSchemaRequest.type,
                );
            } catch {
                // ignore
            }
        }
        setSchemaChangesCount(0);
        setSchemaChanges([]);
        setSchemaChangesSummary(undefined);
        setStructuredSchemaChanges([]);
        setNewTableIds(new Set());
        setNewColumnIds(new Set());
        setNewForeignKeyIds(new Set());
        setModifiedColumnHighlights(new Map());
        setModifiedTableHighlights(new Map());
        setModifiedForeignKeyIds(new Set());
        setDeletedColumnsByTable(new Map());
        setDeletedForeignKeyEdges([]);
        setBaselineColumnOrderByTable(new Map());
        setDeletedTableNodes([]);
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

    // DAB functions
    const initializeDabConfig = useCallback(() => {
        const schema = extractSchema();
        const config = Dab.createDefaultConfig(schema.tables);
        setDabConfig(config);
    }, [reactFlow]);

    const syncDabConfigWithSchema = useCallback(() => {
        if (!dabConfig) {
            return;
        }

        const schema = extractSchema();
        const currentTableIds = new Set(schema.tables.map((t) => t.id));
        const existingEntityIds = new Set(dabConfig.entities.map((e) => e.id));

        // Find new tables that need to be added
        const newTables = schema.tables.filter((t) => !existingEntityIds.has(t.id));

        // Filter out entities for tables that no longer exist
        const updatedEntities = dabConfig.entities.filter((e) => currentTableIds.has(e.id));

        // Add new tables with default config
        const newEntities = newTables.map((t) => Dab.createDefaultEntityConfig(t));

        // Only update if there are changes
        if (newEntities.length > 0 || updatedEntities.length !== dabConfig.entities.length) {
            setDabConfig({
                ...dabConfig,
                entities: [...updatedEntities, ...newEntities],
            });
        }
    }, [dabConfig, reactFlow]);

    const updateDabApiTypes = useCallback((apiTypes: Dab.ApiType[]) => {
        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                apiTypes,
            };
        });
    }, []);

    const toggleDabEntity = useCallback((entityId: string, isEnabled: boolean) => {
        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                entities: prev.entities.map((e) => (e.id === entityId ? { ...e, isEnabled } : e)),
            };
        });
    }, []);

    const toggleDabEntityAction = useCallback(
        (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => {
            setDabConfig((prev) => {
                if (!prev) {
                    return prev;
                }
                return {
                    ...prev,
                    entities: prev.entities.map((e) => {
                        if (e.id !== entityId) {
                            return e;
                        }
                        const enabledActions = isEnabled
                            ? [...e.enabledActions, action]
                            : e.enabledActions.filter((a) => a !== action);
                        return { ...e, enabledActions };
                    }),
                };
            });
        },
        [],
    );

    const updateDabEntitySettings = useCallback(
        (entityId: string, settings: Dab.EntityAdvancedSettings) => {
            setDabConfig((prev) => {
                if (!prev) {
                    return prev;
                }
                return {
                    ...prev,
                    entities: prev.entities.map((e) =>
                        e.id === entityId ? { ...e, advancedSettings: settings } : e,
                    ),
                };
            });
        },
        [],
    );

    const generateDabConfig = useCallback(async () => {
        if (!dabConfig) {
            return;
        }
        const response = await extensionRpc.sendRequest(Dab.GenerateConfigRequest.type, {
            config: dabConfig,
        });
        if (response.success) {
            setDabConfigContent(response.configContent);
            setDabConfigRequestId((id) => id + 1);
        }
    }, [dabConfig, extensionRpc]);

    const openDabConfigInEditor = useCallback(
        (configContent: string) => {
            void extensionRpc.sendNotification(Dab.OpenConfigInEditorNotification.type, {
                configContent,
            });
        },
        [extensionRpc],
    );

    // DAB Deployment functions
    const openDabDeploymentDialog = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...prev,
            isDialogOpen: true,
            dialogStep: Dab.DabDeploymentDialogStep.Confirmation,
        }));
    }, []);

    const closeDabDeploymentDialog = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...prev,
            isDialogOpen: false,
        }));
    }, []);

    const setDabDeploymentDialogStep = useCallback((step: Dab.DabDeploymentDialogStep) => {
        setDabDeploymentState((prev) => ({
            ...prev,
            dialogStep: step,
        }));
    }, []);

    const updateDabDeploymentParams = useCallback((params: Partial<Dab.DabDeploymentParams>) => {
        setDabDeploymentState((prev) => ({
            ...prev,
            params: {
                ...prev.params,
                ...params,
            },
        }));
    }, []);

    const updateDeploymentStepStatus = useCallback(
        (
            step: Dab.DabDeploymentStepOrder,
            status: Dab.DabDeploymentStepStatus["status"],
            errorMessage?: string,
            fullErrorText?: string,
            errorLink?: string,
            errorLinkText?: string,
        ) => {
            setDabDeploymentState((prev) => ({
                ...prev,
                stepStatuses: prev.stepStatuses.map((s) =>
                    s.step === step
                        ? { ...s, status, errorMessage, fullErrorText, errorLink, errorLinkText }
                        : s,
                ),
            }));
        },
        [],
    );

    const runDabDeploymentStep = useCallback(
        async (step: Dab.DabDeploymentStepOrder) => {
            // Mark step as running
            updateDeploymentStepStatus(step, "running");

            // For container start step, verify DAB config is available
            if (step === Dab.DabDeploymentStepOrder.startContainer && !dabConfig) {
                updateDeploymentStepStatus(step, "error", "DAB configuration is not available.");
                return;
            }

            // Run the step via extension (extension will generate config content as needed)
            const response = await extensionRpc.sendRequest(Dab.RunDeploymentStepRequest.type, {
                step,
                params: dabDeploymentState.params,
                config: dabConfig ?? undefined,
            });

            if (response.success) {
                // Update step status to completed and advance to next step
                setDabDeploymentState((prev) => {
                    const updatedStatuses = prev.stepStatuses.map((s) =>
                        s.step === step ? { ...s, status: "completed" as const } : s,
                    );

                    // If this was the last step, set completion state
                    if (step === Dab.DabDeploymentStepOrder.checkContainer) {
                        return {
                            ...prev,
                            stepStatuses: updatedStatuses,
                            currentDeploymentStep: step + 1,
                            isDeploying: false,
                            apiUrl: response.apiUrl,
                            dialogStep: Dab.DabDeploymentDialogStep.Complete,
                        };
                    }

                    return {
                        ...prev,
                        stepStatuses: updatedStatuses,
                        currentDeploymentStep: step + 1,
                    };
                });
            } else {
                updateDeploymentStepStatus(
                    step,
                    "error",
                    response.error,
                    response.fullErrorText,
                    response.errorLink,
                    response.errorLinkText,
                );
            }
        },
        [dabConfig, dabDeploymentState.params, extensionRpc, updateDeploymentStepStatus],
    );

    const resetDabDeploymentState = useCallback(() => {
        setDabDeploymentState(Dab.createDefaultDeploymentState());
    }, []);

    const retryDabDeploymentSteps = useCallback(() => {
        // Reset only deployment steps (pullImage, startContainer, checkContainer)
        // while keeping prerequisite steps as completed
        setDabDeploymentState((prev) => ({
            ...prev,
            currentDeploymentStep: Dab.DabDeploymentStepOrder.pullImage,
            stepStatuses: prev.stepStatuses.map((s) => {
                if (s.step >= Dab.DabDeploymentStepOrder.pullImage) {
                    return { ...s, status: "notStarted" as const, errorMessage: undefined };
                }
                return s;
            }),
            error: undefined,
            apiUrl: undefined,
        }));
    }, []);

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
                consumeSkipDeleteConfirmation,
                publishSession,
                isInitialized,
                closeDesigner,
                resetUndoRedoState,
                resetView,
                renderOnlyVisibleTables,
                setRenderOnlyVisibleTables,
                isExporting,
                setIsExporting,
                isChangesPanelVisible,
                setIsChangesPanelVisible,
                newTableIds,
                newColumnIds,
                newForeignKeyIds,
                modifiedForeignKeyIds,
                modifiedColumnHighlights,
                modifiedTableHighlights,
                deletedColumnsByTable,
                deletedForeignKeyEdges,
                baselineColumnOrderByTable,
                deletedTableNodes,
                schemaChangesCount,
                schemaChanges,
                schemaChangesSummary,
                structuredSchemaChanges,
                revertChange,
                canRevertChange,
                // DAB state
                dabConfig,
                initializeDabConfig,
                syncDabConfigWithSchema,
                updateDabApiTypes,
                toggleDabEntity,
                toggleDabEntityAction,
                updateDabEntitySettings,
                dabSchemaFilter,
                setDabSchemaFilter,
                dabConfigContent,
                dabConfigRequestId,
                generateDabConfig,
                openDabConfigInEditor,
                // DAB Deployment state
                dabDeploymentState,
                openDabDeploymentDialog,
                closeDabDeploymentDialog,
                setDabDeploymentDialogStep,
                updateDabDeploymentParams,
                runDabDeploymentStep,
                resetDabDeploymentState,
                retryDabDeploymentSteps,
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
