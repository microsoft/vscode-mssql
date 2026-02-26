/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useRef, useState, useCallback } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs, getErrorMessage } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, Node, ReactFlowJsonObject, useReactFlow } from "@xyflow/react";
import eventBus from "./schemaDesignerEvents";
import { registerSchemaDesignerGetSchemaStateHandler } from "./schemaDesignerRpcHandlers";
import { CoreRPCs } from "../../../sharedInterfaces/webview";
import { filterDeletedEdges, filterDeletedNodes } from "./diff/deletedVisualUtils";
import {
    applyAddTableMutation,
    applyDeleteTableMutation,
    applyUpdateTableMutation,
    buildFlowComponentsFromSchema,
    buildSchemaFromFlowState,
    getTableHeight,
    getTableWidth,
    layoutFlowComponents,
} from "./model";
import { useSchemaDesignerToolBatchHandlers } from "./schemaDesignerToolBatchHooks";
import { stateStack } from "./schemaDesignerUndoState";
import { useSchemaDesignerSelector } from "./schemaDesignerSelector";

export interface SchemaDesignerContextProps extends CoreRPCs {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    schemaNames: string[];
    datatypes: string[];
    findTableText: string;
    setFindTableText: (text: string) => void;
    getDefinition: () => Promise<string>;
    getBaselineDefinition: () => Promise<string>;
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
    revealTables: (tableIds: string[]) => Promise<void>;
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
    baselineRevision: number;
    schemaRevision: number;
    notifySchemaChanged: () => void;
    isDabEnabled: () => boolean;
    onPushUndoState: () => void;
    maybeAutoArrangeForToolBatch: (
        preTableCount: number,
        postTableCount: number,
        preForeignKeyCount: number,
        postForeignKeyCount: number,
    ) => Promise<void>;
}

const SchemaDesignerContext = createContext<SchemaDesignerContextProps>(
    undefined as unknown as SchemaDesignerContextProps,
);

interface SchemaDesignerProviderProps {
    children: React.ReactNode;
}

const SchemaDesignerStateProvider: React.FC<SchemaDesignerProviderProps> = ({ children }) => {
    // Set up necessary webview context
    const { extensionRpc } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();

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
    const [baselineRevision, setBaselineRevision] = useState(0);
    const [schemaRevision, setSchemaRevision] = useState(0);
    const baselineSchemaRef = useRef<SchemaDesigner.Schema | undefined>(undefined);
    const baselineDefinitionRef = useRef<string | undefined>(undefined);
    const { onPushUndoState, maybeAutoArrangeForToolBatch } = useSchemaDesignerToolBatchHandlers({
        reactFlow,
        resetView,
    });

    const extractSchema = useCallback(() => {
        const schema = buildSchemaFromFlowState(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        return schema;
    }, [reactFlow]);

    const notifySchemaChanged = useCallback(() => {
        setSchemaRevision((revision) => revision + 1);
    }, []);

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
            reactFlow.setNodes(state.nodes);
            reactFlow.setEdges(state.edges);
            eventBus.emit("refreshFlowState");
            notifySchemaChanged();
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
            eventBus.emit("refreshFlowState");
            notifySchemaChanged();
            eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
        };
        eventBus.on("redo", handleRedo);

        return () => {
            eventBus.off("pushState", handleScript);
            eventBus.off("undo", handleUndo);
            eventBus.off("redo", handleRedo);
        };
    }, []);

    // Respond with the current schema state
    useEffect(() => {
        registerSchemaDesignerGetSchemaStateHandler({
            isInitialized,
            extensionRpc,
            extractSchema,
        });
    }, [isInitialized, extensionRpc, extractSchema]);

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
            baselineDefinitionRef.current = undefined;
            setBaselineRevision((revision) => revision + 1);

            const { nodes: rawNodes, edges: rawEdges } = buildFlowComponentsFromSchema(
                model.schema,
            );
            const { nodes, edges } = layoutFlowComponents(rawNodes, rawEdges);

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
        baselineSchemaRef.current = undefined;
        baselineDefinitionRef.current = undefined;
        setBaselineRevision((revision) => revision + 1);
        setInitializationRequestId((id) => id + 1);
    };

    // Get the script from the server
    const getDefinition = useCallback(async () => {
        const schema = buildSchemaFromFlowState(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        const result = await extensionRpc.sendRequest(SchemaDesigner.GetDefinitionRequest.type, {
            updatedSchema: schema,
        });
        return result.script;
    }, [extensionRpc, reactFlow]);

    const getBaselineDefinition = useCallback(async () => {
        if (baselineDefinitionRef.current !== undefined) {
            return baselineDefinitionRef.current;
        }

        if (!baselineSchemaRef.current) {
            baselineSchemaRef.current = await extensionRpc.sendRequest(
                SchemaDesigner.GetBaselineSchemaRequest.type,
            );
        }

        if (!baselineSchemaRef.current) {
            return "";
        }

        const result = await extensionRpc.sendRequest(SchemaDesigner.GetDefinitionRequest.type, {
            updatedSchema: baselineSchemaRef.current,
        });
        baselineDefinitionRef.current = result.script;
        return result.script;
    }, [extensionRpc]);

    // Reducer callers
    const saveAsFile = (fileProps: SchemaDesigner.ExportFileOptions) => {
        void extensionRpc.sendNotification(SchemaDesigner.ExportToFileNotification.type, fileProps);
    };

    const getReport = async () => {
        const schema = buildSchemaFromFlowState(
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

        const addTableResult = applyAddTableMutation({
            existingNodes,
            existingEdges,
            table,
        });

        if (!addTableResult.success) {
            console.error("Node with position not found for table:", table);
            return false;
        }

        reactFlow.setNodes(addTableResult.nodes);
        reactFlow.setEdges(addTableResult.edges);
        eventBus.emit("refreshFlowState");
        requestAnimationFrame(async () => {
            setCenter(addTableResult.addedNodeId, true);
        });
        notifySchemaChanged();
        return true;
    };

    /**
     * Updates a table in the flow
     */
    const updateTable = async (updatedTable: SchemaDesigner.Table) => {
        const updateTableResult = applyUpdateTableMutation({
            existingNodes: reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            existingEdges: reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
            updatedTable,
        });

        if (!updateTableResult.success) {
            return false;
        }

        reactFlow.setNodes(updateTableResult.nodes);
        reactFlow.setEdges(updateTableResult.edges);
        eventBus.emit("refreshFlowState");
        requestAnimationFrame(() => {
            setCenter(updatedTable.id, true);
        });
        notifySchemaChanged();
        return true;
    };

    const deleteTable = async (table: SchemaDesigner.Table, skipConfirmation = false) => {
        const deleteTableResult = applyDeleteTableMutation({
            tableId: table.id,
            existingNodes: reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            skipConfirmation,
        });
        if (!deleteTableResult.success) {
            return false;
        }
        if (deleteTableResult.shouldSkipDeleteConfirmation) {
            skipDeleteConfirmationRef.current = true;
        }
        await reactFlow.deleteElements({ nodes: [deleteTableResult.nodeToDelete] });
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
        const schema = buildSchemaFromFlowState(
            reactFlow.getNodes() as Node<SchemaDesigner.TableWithDeletedFlag>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[],
        );

        return schema.tables.find((table) => table.id === tableId);
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
                node.position.x + getTableWidth() / 2,
                node.position.y + getTableHeight(node.data) / 2,
                {
                    zoom: shouldZoomIn ? 1 : reactFlow.getZoom(),
                    duration: 500,
                },
            );
        }
    };

    const revealTables = useCallback(
        async (tableIds: string[]) => {
            const uniqueTableIds = [...new Set(tableIds)].filter((tableId) => !!tableId);
            if (uniqueTableIds.length === 0) {
                return;
            }

            const nodesToReveal = uniqueTableIds
                .map((tableId) => reactFlow.getNode(tableId))
                .filter((node): node is Node<SchemaDesigner.Table> => !!node);

            if (nodesToReveal.length === 0) {
                return;
            }

            await reactFlow.fitView({
                nodes: nodesToReveal,
            });
        },
        [reactFlow],
    );

    const publishSession = async () => {
        const schema = buildSchemaFromFlowState(
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
        baselineDefinitionRef.current = undefined;
        setBaselineRevision((revision) => revision + 1);
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

    const dabEnabled = useSchemaDesignerSelector((s) => s?.enableDAB);
    const isDabEnabled = () => dabEnabled ?? false;

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(extensionRpc),
                extensionRpc,
                schemaNames,
                datatypes,
                findTableText,
                setFindTableText,
                getDefinition,
                getBaselineDefinition,
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
                revealTables,
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
                baselineRevision,
                schemaRevision,
                notifySchemaChanged,
                isDabEnabled,
                onPushUndoState,
                maybeAutoArrangeForToolBatch,
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
