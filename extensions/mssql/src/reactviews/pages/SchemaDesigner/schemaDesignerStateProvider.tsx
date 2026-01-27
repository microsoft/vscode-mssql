/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useState, useCallback, useRef } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { Dab } from "../../../sharedInterfaces/dab";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs, getErrorMessage } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, MarkerType, Node, ReactFlowJsonObject, useReactFlow } from "@xyflow/react";
import { columnUtils, flowUtils, foreignKeyUtils, tableUtils } from "./schemaDesignerUtils";
import eventBus from "./schemaDesignerEvents";
import {
    registerSchemaDesignerApplyEditsHandler,
    registerSchemaDesignerGetSchemaStateHandler,
} from "./schemaDesignerRpcHandlers";
import { UndoRedoStack } from "../../common/undoRedoStack";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";
import { v4 as uuidv4 } from "uuid";
import { locConstants } from "../../common/locConstants";

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
    // DAB (Data API Builder) state
    dabConfig: Dab.DabConfig | null;
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
    updateDabApiType: (apiType: Dab.ApiType) => void;
    toggleDabEntity: (entityId: string, isEnabled: boolean) => void;
    toggleDabEntityAction: (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => void;
    updateDabEntitySettings: (entityId: string, settings: Dab.EntityAdvancedSettings) => void;
    dabSchemaFilter: string;
    setDabSchemaFilter: (schemaName: string) => void;
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
    const skipDeleteConfirmationRef = useRef(false);

    // DAB state
    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabSchemaFilter, setDabSchemaFilter] = useState<string>("");

    // TODO: Replace RAF wait with a deterministic schema-commit signal for tool-driven ops.
    const waitForNextFrame = useCallback(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
            }),
        [],
    );

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

    const normalizeColumn = (column: SchemaDesigner.Column): SchemaDesigner.Column => {
        const dataType = column.dataType || "int";
        const isPrimaryKey = column.isPrimaryKey ?? false;
        const isNullable = column.isNullable !== undefined ? column.isNullable : !isPrimaryKey;
        const normalized: SchemaDesigner.Column = {
            id: column.id || uuidv4(),
            name: column.name ?? "",
            dataType,
            maxLength: column.maxLength ?? "",
            precision: column.precision ?? 0,
            scale: column.scale ?? 0,
            isPrimaryKey,
            isIdentity: column.isIdentity ?? false,
            identitySeed: column.identitySeed ?? 1,
            identityIncrement: column.identityIncrement ?? 1,
            isNullable,
            defaultValue: column.defaultValue ?? "",
            isComputed: column.isComputed ?? false,
            computedFormula: column.computedFormula ?? "",
            computedPersisted: column.computedPersisted ?? false,
        };

        if (columnUtils.isLengthBasedType(dataType) && normalized.maxLength === "") {
            normalized.maxLength = columnUtils.getDefaultLength(dataType);
        }
        if (columnUtils.isPrecisionBasedType(dataType)) {
            if (column.precision === undefined) {
                normalized.precision = columnUtils.getDefaultPrecision(dataType);
            }
            if (column.scale === undefined) {
                normalized.scale = columnUtils.getDefaultScale(dataType);
            }
        }
        if (columnUtils.isTimeBasedWithScale(dataType) && column.scale === undefined) {
            normalized.scale = columnUtils.getDefaultScale(dataType);
        }

        return normalized;
    };

    const normalizeTable = (table: SchemaDesigner.Table): SchemaDesigner.Table | undefined => {
        if (!table || !Array.isArray(table.columns)) {
            return undefined;
        }

        const normalizedColumns = table.columns.map((column) => normalizeColumn(column));

        const normalizedForeignKeys = Array.isArray(table.foreignKeys)
            ? table.foreignKeys.map((fk) => ({
                  ...fk,
                  id: fk.id || uuidv4(),
                  columns: Array.isArray(fk.columns) ? fk.columns : [],
                  referencedColumns: Array.isArray(fk.referencedColumns)
                      ? fk.referencedColumns
                      : [],
              }))
            : [];

        return {
            ...table,
            id: table.id || uuidv4(),
            columns: normalizedColumns,
            foreignKeys: normalizedForeignKeys,
        };
    };

    const validateTable = (
        schema: SchemaDesigner.Schema,
        table: SchemaDesigner.Table,
        schemas: string[],
    ): string | undefined => {
        if (!table.columns || table.columns.length === 0) {
            return locConstants.schemaDesigner.tableMustHaveColumns;
        }
        if (!schemas.includes(table.schema)) {
            return locConstants.schemaDesigner.schemaNotAvailable(table.schema);
        }

        const normalizedSchema: SchemaDesigner.Schema = {
            tables: [...schema.tables.filter((t) => t.id !== table.id), table],
        };

        const nameError = tableUtils.tableNameValidationError(normalizedSchema, table);
        if (nameError) {
            return nameError;
        }

        for (const column of table.columns) {
            const columnError = columnUtils.isColumnValid(column, table.columns);
            if (columnError) {
                return columnError;
            }
        }

        for (const fk of table.foreignKeys) {
            if (fk.columns.length === 0 || fk.referencedColumns.length === 0) {
                return locConstants.schemaDesigner.foreignKeyMappingRequired;
            }
            if (fk.columns.length !== fk.referencedColumns.length) {
                return locConstants.schemaDesigner.foreignKeyMappingLengthMismatch;
            }
            const foreignKeyErrors = foreignKeyUtils.isForeignKeyValid(
                normalizedSchema.tables,
                table,
                fk,
            );
            if (!foreignKeyErrors.isValid) {
                return (
                    foreignKeyErrors.errorMessage ?? locConstants.schemaDesigner.invalidForeignKey
                );
            }
        }

        return undefined;
    };

    // Handle bulk edits (vNext LM tool plumbing) from extension
    useEffect(() => {
        registerSchemaDesignerApplyEditsHandler({
            isInitialized,
            extensionRpc,
            schemaNames,
            datatypes,
            waitForNextFrame,
            extractSchema,
            addTable,
            updateTable,
            deleteTable,
            normalizeColumn,
            normalizeTable,
            validateTable,
            onPushUndoState: () => {
                const state = reactFlow.toObject() as ReactFlowJsonObject<
                    Node<SchemaDesigner.Table>,
                    Edge<SchemaDesigner.ForeignKey>
                >;
                stateStack.pushState(state);
                eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
            },
            onRequestScriptRefresh: () => eventBus.emit("getScript"),
        });
    }, [isInitialized, extensionRpc, schemaNames, datatypes, reactFlow, waitForNextFrame]);

    // Respond with the current schema state
    useEffect(() => {
        registerSchemaDesignerGetSchemaStateHandler({
            isInitialized,
            extensionRpc,
            extractSchema,
        });
    }, [isInitialized, extensionRpc]);

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
                    // TODO: FK edge id collision for multi-column mappings. A single FK can create
                    // multiple edges (one per mapping); using foreignKey.id here causes duplicate
                    // edge ids and can lead to lost/duplicated mappings. Keep legacy behavior in
                    // this branch; pull in the upstream fix when available.
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

        reactFlow.setNodes(existingNodes);
        reactFlow.setEdges(existingEdges);
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

    const updateDabApiType = useCallback((apiType: Dab.ApiType) => {
        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                apiType,
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
                // DAB state
                dabConfig,
                initializeDabConfig,
                syncDabConfigWithSchema,
                updateDabApiType,
                toggleDabEntity,
                toggleDabEntityAction,
                updateDabEntitySettings,
                dabSchemaFilter,
                setDabSchemaFilter,
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
