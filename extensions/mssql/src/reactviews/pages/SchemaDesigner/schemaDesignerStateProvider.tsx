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
import { flowUtils, foreignKeyUtils } from "./schemaDesignerUtils";
import eventBus from "./schemaDesignerEvents";
import { UndoRedoStack } from "../../common/undoRedoStack";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesigner.SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    originalSchemaFromSession?: SchemaDesigner.Schema;
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
    setCenterOnEdge: (edgeId: string, shouldZoomIn?: boolean) => void;
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
    const [originalSchemaFromSession, setOriginalSchemaFromSession] = useState<
        SchemaDesigner.Schema | undefined
    >(undefined);
    const reactFlow = useReactFlow();
    const [isInitialized, setIsInitialized] = useState(false);
    const [initializationError, setInitializationError] = useState<string | undefined>(undefined);
    const [initializationRequestId, setInitializationRequestId] = useState(0);
    const [findTableText, setFindTableText] = useState<string>("");
    const [renderOnlyVisibleTables, setRenderOnlyVisibleTables] = useState<boolean>(true);
    const [isExporting, setIsExporting] = useState<boolean>(false);

    useEffect(() => {
        const handleScript = () => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const state = reactFlow.toObject() as ReactFlowJsonObject<
                        Node<SchemaDesigner.Table>,
                        Edge<SchemaDesigner.ForeignKey>
                    >;
                    stateStack.pushState(state);
                    eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
                });
            });
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
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
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
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
        };
        eventBus.on("redo", handleRedo);

        return () => {
            eventBus.off("pushState", handleScript);
            eventBus.off("undo", handleUndo);
            eventBus.off("redo", handleRedo);
        };
    }, []);

    const initializeSchemaDesigner = async () => {
        try {
            setIsInitialized(false);
            setInitializationError(undefined);
            setOriginalSchemaFromSession(undefined);
            const model = await extensionRpc.sendRequest(
                SchemaDesigner.InitializeSchemaDesignerRequest.type,
            );

            const { nodes, edges } = flowUtils.generateSchemaDesignerFlowComponents(model.schema);

            setOriginalSchemaFromSession(model.originalSchema ?? model.schema);
            setDatatypes(model.dataTypes);
            setSchemaNames(model.schemaNames);
            setIsInitialized(true);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const initialState = reactFlow.toObject() as ReactFlowJsonObject<
                        Node<SchemaDesigner.Table>,
                        Edge<SchemaDesigner.ForeignKey>
                    >;
                    stateStack.setInitialState(initialState);
                    eventBus.emit("initialStateReady");
                });
            });

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
        setOriginalSchemaFromSession(undefined);
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
        const existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

        const existingTableNode = existingNodes.find((node) => node.id === updatedTable.id);

        if (!existingTableNode) {
            return false;
        }

        // Build map of renamed columns (old name -> new name) based on column IDs
        const oldColumnNamesById = new Map(
            existingTableNode.data.columns.map((column) => [column.id, column.name]),
        );
        const renamedColumns = new Map<string, string>();
        updatedTable.columns.forEach((column) => {
            const oldName = oldColumnNamesById.get(column.id);
            if (oldName && oldName !== column.name) {
                renamedColumns.set(oldName, column.name);
            }
        });

        // Update incoming edges that reference this table (schema/name/column renames)
        const updatedEdgesFromExisting = existingEdges.map((edge) => {
            if (
                edge?.data?.referencedSchemaName === existingTableNode?.data?.schema &&
                edge?.data?.referencedTableName === existingTableNode?.data?.name
            ) {
                const updatedReferencedColumns =
                    renamedColumns.size > 0
                        ? edge.data.referencedColumns.map(
                              (columnName) => renamedColumns.get(columnName) ?? columnName,
                          )
                        : edge.data.referencedColumns;
                const updatedTargetHandle =
                    renamedColumns.size > 0 && edge.target === updatedTable.id && edge.targetHandle
                        ? `left-${renamedColumns.get(
                              foreignKeyUtils.extractColumnNameFromHandle(edge.targetHandle),
                          ) ?? foreignKeyUtils.extractColumnNameFromHandle(edge.targetHandle)}`
                        : edge.targetHandle;

                return {
                    ...edge,
                    targetHandle: updatedTargetHandle,
                    data: {
                        ...edge.data,
                        referencedSchemaName: updatedTable.schema,
                        referencedTableName: updatedTable.name,
                        referencedColumns: updatedReferencedColumns,
                    },
                };
            }
            return edge;
        });

        // Update foreign keys on other tables that reference this table's renamed columns
        const tablesWithUpdatedReferences = new Set<string>();
        if (renamedColumns.size > 0) {
            existingNodes.forEach((node) => {
                if (node.id === updatedTable.id) {
                    return;
                }
                let didUpdate = false;
                const updatedForeignKeys = node.data.foreignKeys.map((fk) => {
                    if (
                        fk.referencedSchemaName === existingTableNode?.data?.schema &&
                        fk.referencedTableName === existingTableNode?.data?.name
                    ) {
                        const nextReferencedColumns = fk.referencedColumns.map(
                            (columnName) => renamedColumns.get(columnName) ?? columnName,
                        );
                        if (
                            nextReferencedColumns.some(
                                (columnName, index) =>
                                    columnName !== fk.referencedColumns[index],
                            )
                        ) {
                            didUpdate = true;
                            return { ...fk, referencedColumns: nextReferencedColumns };
                        }
                    }
                    return fk;
                });

                if (didUpdate) {
                    node.data = { ...node.data, foreignKeys: updatedForeignKeys };
                    tablesWithUpdatedReferences.add(node.id);
                }
            });
        }

        // Update outgoing FK column names for this table when columns are renamed
        if (renamedColumns.size > 0) {
            updatedTable.foreignKeys = updatedTable.foreignKeys.map((fk) => ({
                ...fk,
                columns: fk.columns.map((columnName) => renamedColumns.get(columnName) ?? columnName),
            }));
        }

        // Update the table node with the new data
        existingTableNode.data = updatedTable;

        // Remove the existing foreign keys from the table
        const updatedEdges = updatedEdgesFromExisting.filter(
            (edge) =>
                edge.source !== updatedTable.id && !tablesWithUpdatedReferences.has(edge.source),
        );

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
                updatedEdges.push({
                    id: foreignKey.id,
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

        // Rebuild edges for tables that had incoming FK references updated
        tablesWithUpdatedReferences.forEach((tableId) => {
            const sourceTableNode = existingNodes.find((node) => node.id === tableId);
            if (!sourceTableNode) {
                return;
            }
            sourceTableNode.data.foreignKeys.forEach((foreignKey) => {
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
                    updatedEdges.push({
                        id: foreignKey.id,
                        source: sourceTableNode.id,
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
        });

        reactFlow.setNodes(existingNodes);
        reactFlow.setEdges(updatedEdges);
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
        void reactFlow.deleteElements({ nodes: [node] });
        eventBus.emit("pushState");
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

    const setCenterOnEdge = (edgeId: string, shouldZoomIn: boolean = false) => {
        const edge = reactFlow.getEdge(edgeId) as Edge<SchemaDesigner.ForeignKey>;
        if (edge) {
            const sourceNode = reactFlow.getNode(edge.source) as Node<SchemaDesigner.Table>;
            const targetNode = reactFlow.getNode(edge.target) as Node<SchemaDesigner.Table>;
            if (sourceNode && targetNode) {
                // Calculate center point between source and target nodes
                const sourceCenter = {
                    x: sourceNode.position.x + flowUtils.getTableWidth() / 2,
                    y: sourceNode.position.y + flowUtils.getTableHeight(sourceNode.data) / 2,
                };
                const targetCenter = {
                    x: targetNode.position.x + flowUtils.getTableWidth() / 2,
                    y: targetNode.position.y + flowUtils.getTableHeight(targetNode.data) / 2,
                };
                const midpoint = {
                    x: (sourceCenter.x + targetCenter.x) / 2,
                    y: (sourceCenter.y + targetCenter.y) / 2,
                };
                void reactFlow.setCenter(midpoint.x, midpoint.y, {
                    zoom: shouldZoomIn ? 1 : reactFlow.getZoom(),
                    duration: 500,
                });
            }
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
        requestAnimationFrame(() => {
            void reactFlow.fitView({
                nodes: reactFlow.getNodes().filter((node) => node.hidden !== true),
            });
        });
    }

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewContext),
                extensionRpc,
                state,
                themeKind,
                keyBindings,
                originalSchemaFromSession,
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
                setCenterOnEdge,
                publishSession,
                isInitialized,
                closeDesigner,
                resetUndoRedoState,
                resetView,
                renderOnlyVisibleTables,
                setRenderOnlyVisibleTables,
                isExporting,
                setIsExporting,
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
