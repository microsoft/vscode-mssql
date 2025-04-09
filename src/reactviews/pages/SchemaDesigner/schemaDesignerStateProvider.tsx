/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useEffect, useState } from "react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";

import { Edge, Node, ReactFlowJsonObject, useReactFlow } from "@xyflow/react";
import { flowUtils, foreignKeyUtils } from "./schemaDesignerUtils";
import eventBus from "./schemaDesignerEvents";
import { UndoRedoStack } from "../../common/undoRedoStack";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";

export interface SchemaDesignerContextProps
    extends WebviewContextProps<SchemaDesigner.SchemaDesignerWebviewState> {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    schemaNames: string[];
    datatypes: string[];
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
        const newReactFlowNode: Node<SchemaDesigner.Table> = {
            id: table.id,
            type: "tableNode",
            data: { ...table },
            position: { x: 0, y: 0 },
        };

        const schemaModel = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );

        schemaModel.tables.push(newReactFlowNode.data);
        const updatedPositions = flowUtils.generateSchemaDesignerFlowComponents(schemaModel);

        const nodeWithPosition = updatedPositions.nodes.find(
            (node) => node.id === newReactFlowNode.id,
        );

        const edgesForNewTable = updatedPositions.edges.filter(
            (edge) => edge.source === newReactFlowNode.id || edge.target === newReactFlowNode.id,
        );

        if (nodeWithPosition) {
            nodeWithPosition.selected = true;
            reactFlow.addNodes(nodeWithPosition);
            reactFlow.addEdges(edgesForNewTable);
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
    const updateTable = async (table: SchemaDesigner.Table) => {
        const schemaModel = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );

        const tableNode = schemaModel.tables.find((node) => node.id === table.id);
        if (!tableNode) {
            console.warn(`Table with id ${table.id} not found`);
            return false;
        }

        for (const t of schemaModel.tables) {
            if (t.id !== table.id) {
                // Update the foreign keys for other tables
                t.foreignKeys.forEach((fk) => {
                    if (
                        fk.referencedSchemaName === tableNode.schema &&
                        fk.referencedTableName === tableNode.name
                    ) {
                        fk.referencedSchemaName = table.schema;
                        fk.referencedTableName = table.name;
                    }
                });
            }
        }

        const updatedTable = {
            ...tableNode,
            ...table,
        };

        const updatedSchema = {
            ...schemaModel,
            tables: schemaModel.tables.map((node) => (node.id === table.id ? updatedTable : node)),
        };

        // Delete existing edges for this table
        const edgesToDelete = reactFlow
            .getEdges()
            .filter((edge) => edge.source === table.id || edge.target === table.id);

        await reactFlow.deleteElements({
            nodes: [],
            edges: edgesToDelete,
        });

        // Regenerate flow components with updated schema
        const newFlowComponents = flowUtils.generateSchemaDesignerFlowComponents(updatedSchema);

        const nodeWithPosition = newFlowComponents.nodes.find((node) => node.id === table.id);

        if (nodeWithPosition) {
            const edgesForUpdatedTable = newFlowComponents.edges.filter(
                (edge) => edge.source === table.id || edge.target === table.id,
            );

            reactFlow.updateNodeData(nodeWithPosition.id, nodeWithPosition.data);
            reactFlow.addEdges(edgesForUpdatedTable);
            return true;
        }
        return false;
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

    return (
        <SchemaDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewContext),
                extensionRpc: extensionRpc,
                state: state,
                themeKind: themeKind,
                schemaNames,
                datatypes,
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
                isInitialized,
            }}>
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
