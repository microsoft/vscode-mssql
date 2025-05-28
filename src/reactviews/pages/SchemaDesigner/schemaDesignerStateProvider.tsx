/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useState } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, MarkerType, Node, ReactFlowJsonObject, useReactFlow } from "@xyflow/react";
import { flowUtils, foreignKeyUtils } from "./schemaDesignerUtils";
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
    getScript: () => Promise<string>;
    initializeSchemaDesigner: () => Promise<{
        nodes: Node<SchemaDesigner.Table>[];
        edges: Edge<SchemaDesigner.ForeignKey>[];
    }>;
    saveAsFile: (fileProps: SchemaDesigner.ExportFileOptions) => void;
    getReport: () => Promise<{
        report: SchemaDesigner.GetReportResponse;
        error?: string;
    }>;
    openInEditor: (text: string) => void;
    openInEditorWithConnection: (text: string) => void;
    setSelectedTable: (selectedTable: SchemaDesigner.Table) => void;
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
    const { state, extensionRpc, themeKind } = webviewContext;

    // Setups for schema designer model
    const [datatypes, setDatatypes] = useState<string[]>([]);
    const [schemaNames, setSchemaNames] = useState<string[]>([]);
    const reactFlow = useReactFlow();
    const [isInitialized, setIsInitialized] = useState(false);
    const [findTableText, setFindTableText] = useState<string>("");

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

    const initializeSchemaDesigner = async () => {
        const model = (await extensionRpc.call(
            "initializeSchemaDesigner",
        )) as SchemaDesigner.CreateSessionResponse;

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
    };

    // Get the script from the server
    const getScript = async () => {
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        const script = (await extensionRpc.call("getScript", {
            updatedSchema: schema,
        })) as SchemaDesigner.GenerateScriptResponse;
        return script.combinedScript;
    };

    // Reducer callers
    const saveAsFile = (fileProps: SchemaDesigner.ExportFileOptions) => {
        void extensionRpc.call("exportToFile", {
            ...fileProps,
        });
    };

    const getReport = async () => {
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );
        if (!schema) {
            return;
        }

        const result = await extensionRpc.call("getReport", {
            updatedSchema: schema,
        });
        return result;
    };

    const copyToClipboard = (text: string) => {
        void extensionRpc.call("copyToClipboard", {
            text: text,
        });
    };

    const openInEditor = (text: string) => {
        void extensionRpc.call("openInEditor", {
            text: text,
        });
    };

    const openInEditorWithConnection = (text: string) => {
        void extensionRpc.call("openInEditorWithConnection", {
            text: text,
        });
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

        const edgesForNewTable = updatedPositions.edges.filter(
            (edge) => edge.source === table.id || edge.target === table.id,
        );

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

    const deleteTable = async (table: SchemaDesigner.Table) => {
        const node = reactFlow.getNode(table.id);
        if (!node) {
            return false;
        }
        void reactFlow.deleteElements({ nodes: [node] });
        eventBus.emit("pushState");
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
        const response = await extensionRpc.call("publishSession");
        return response;
    };

    const closeDesigner = () => {
        void extensionRpc.call("closeDesigner", {});
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

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewContext),
                extensionRpc: extensionRpc,
                state: state,
                themeKind: themeKind,
                schemaNames,
                datatypes,
                findTableText,
                setFindTableText,
                getScript,
                initializeSchemaDesigner,
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
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
