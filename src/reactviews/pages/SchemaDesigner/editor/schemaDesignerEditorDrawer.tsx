/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerEditor } from "./schemaDesignerEditor";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { createContext, useContext, useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import eventBus, {
    createNewTable,
    extractSchemaModel,
    generateSchemaDesignerFlowComponents,
} from "../schemaDesignerUtils";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Edge, Node, useReactFlow } from "@xyflow/react";

export interface SchemaDesignerEditorContextProps {
    schema: SchemaDesigner.Schema;
    table: SchemaDesigner.Table;
    setTable: (table: SchemaDesigner.Table) => void;
    isEditDrawerOpen: boolean;
    setIsEditDrawerOpen: (open: boolean) => void;
    save(): void;
    cancel(): void;
    isNewTable: boolean;
    errors: Record<string, string>;
    setErrors: (errors: Record<string, string>) => void;
    schemas: string[];
    dataTypes: string[];
    showForeignKey: boolean;
}

export const SchemaDesignerEditorContext =
    createContext<SchemaDesignerEditorContextProps>(
        undefined as unknown as SchemaDesignerEditorContextProps,
    );

export const SchemaDesignerEditorDrawer = () => {
    const context = useContext(SchemaDesignerContext);
    const reactFlow = useReactFlow();
    if (!context) {
        return undefined;
    }

    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

    const [schema, setSchema] = useState<SchemaDesigner.Schema>({
        tables: [],
    });

    const [table, setTable] = useState<SchemaDesigner.Table>({
        name: "",
        columns: [],
        schema: "",
        foreignKeys: [],
        id: "",
    });

    const [isNewTable, setIsNewTable] = useState(false);

    const [errors, setErrors] = useState<Record<string, string>>({});

    const [schemas, setSchemas] = useState<string[]>([]);
    const [dataTypes, setDataTypes] = useState<string[]>([]);

    const [showForeignKey, setShowForeignKey] = useState(false);

    useEffect(() => {
        eventBus.on("editTable", (table, schema, showForeignKey) => {
            const edges = reactFlow
                .getEdges()
                .filter(
                    (edge) => edge.source === table.id,
                ) as Edge<SchemaDesigner.ForeignKey>[];

            const edgesMap = new Map<string, SchemaDesigner.ForeignKey>();
            edges.forEach((edge) => {
                const sourceTable = schema.tables.find(
                    (t) => t.id === edge.source,
                );
                const targetTable = schema.tables.find(
                    (t) => t.id === edge.target,
                );
                if (!sourceTable || !targetTable) {
                    return;
                }
                if (!edge.data) {
                    return;
                }
                const foreignKey: SchemaDesigner.ForeignKey = {
                    id: edge.data.id,
                    columns: edge.data.columns,
                    name: edge.data.name,
                    onDeleteAction: edge.data.onDeleteAction,
                    onUpdateAction: edge.data.onUpdateAction,
                    referencedColumns: edge.data.referencedColumns,
                    referencedSchemaName: edge.data.referencedSchemaName,
                    referencedTableName: edge.data.referencedTableName,
                };
                if (edgesMap.has(edge.id)) {
                    // If the edge already exists, append columns and referencedColumns
                    const existingForeignKey = edgesMap.get(edge.id);
                    if (existingForeignKey) {
                        existingForeignKey.columns.push(...foreignKey.columns);
                        existingForeignKey.referencedColumns.push(
                            ...foreignKey.referencedColumns,
                        );
                    }
                } else {
                    edgesMap.set(edge.id, foreignKey);
                }
            });

            table.foreignKeys = Array.from(edgesMap.values());

            setSchemas(context.schemaNames);
            setDataTypes(context.datatypes);
            setIsEditDrawerOpen(true);
            setSchema(schema);
            setTable(table);
            setIsNewTable(false);
            if (showForeignKey) {
                setShowForeignKey(true);
            } else {
                setShowForeignKey(false);
            }
        });
        eventBus.on("newTable", (schema) => {
            setSchemas(context.schemaNames);
            setDataTypes(context.datatypes);
            setSchema(schema);
            setTable(createNewTable(schema, context.schemaNames));
            setIsNewTable(true);
            setIsEditDrawerOpen(true);
        });
    });

    useEffect(() => {}, [table]);

    return (
        <OverlayDrawer
            position={"end"}
            open={isEditDrawerOpen}
            onOpenChange={(_, { open }) => setIsEditDrawerOpen(open)}
            style={{ width: `600px` }}
        >
            <SchemaDesignerEditorContext.Provider
                value={{
                    schemas: schemas,
                    dataTypes: dataTypes,
                    schema: schema,
                    table: table,
                    setTable: setTable,
                    isEditDrawerOpen: isEditDrawerOpen,
                    setIsEditDrawerOpen: setIsEditDrawerOpen,
                    save: async () => {
                        // If errors are present, do not save
                        if (Object.keys(errors).length > 0) {
                            return;
                        }
                        // Save the table
                        if (isNewTable) {
                            const newReactFlowNode: Node<SchemaDesigner.Table> =
                                {
                                    id: table.id,
                                    type: "tableNode",
                                    data: {
                                        ...table,
                                    },
                                    position: { x: 0, y: 0 },
                                };

                            const schemaModel = extractSchemaModel(
                                reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
                                reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
                            );

                            schemaModel.tables.push(newReactFlowNode.data);

                            const updatedPositions =
                                generateSchemaDesignerFlowComponents(
                                    schemaModel,
                                );

                            const nodeWithPosition =
                                updatedPositions.nodes.find(
                                    (node) => node.id === newReactFlowNode.id,
                                );

                            const edgesForNewTable =
                                updatedPositions.edges.filter(
                                    (edge) =>
                                        edge.source === newReactFlowNode.id ||
                                        edge.target === newReactFlowNode.id,
                                );
                            if (!nodeWithPosition && !edgesForNewTable) {
                                return;
                            }
                            reactFlow.addNodes(nodeWithPosition!);
                            reactFlow.addEdges(edgesForNewTable);
                        } else {
                            const schema = extractSchemaModel(
                                reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
                                reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
                            );

                            const tableNode = schema.tables.find(
                                (node) => node.id === table.id,
                            );

                            if (!tableNode) {
                                return;
                            }

                            const updatedTable = {
                                ...tableNode,
                                ...table,
                            };

                            const updatedSchema = {
                                ...schema,
                                tables: schema.tables.map((node) =>
                                    node.id === table.id ? updatedTable : node,
                                ),
                            };

                            // delete the old edges
                            const edgesToDelete = reactFlow
                                .getEdges()
                                .filter(
                                    (edge) =>
                                        edge.source === table.id ||
                                        edge.target === table.id,
                                );
                            await reactFlow.deleteElements({
                                nodes: [],
                                edges: edgesToDelete,
                            });

                            const newFlowComponents =
                                generateSchemaDesignerFlowComponents(
                                    updatedSchema,
                                );
                            const nodeWithPosition =
                                newFlowComponents.nodes.find(
                                    (node) => node.id === table.id,
                                );
                            if (!nodeWithPosition) {
                                return;
                            }
                            const edgesForUpdatedTable =
                                newFlowComponents.edges.filter(
                                    (edge) =>
                                        edge.source === table.id ||
                                        edge.target === table.id,
                                );
                            reactFlow.updateNode(
                                nodeWithPosition.id,
                                nodeWithPosition.data,
                            );
                            reactFlow.addEdges(edgesForUpdatedTable);
                        }
                        setIsEditDrawerOpen(false);
                    },
                    cancel: () => {
                        setIsEditDrawerOpen(false);
                    },
                    isNewTable: isNewTable,
                    errors: errors,
                    setErrors: setErrors,
                    showForeignKey: showForeignKey,
                }}
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label="Close"
                                icon={<FluentIcons.Dismiss24Regular />}
                                onClick={() => setIsEditDrawerOpen(false)}
                            />
                        }
                    >
                        {isNewTable
                            ? locConstants.schemaDesigner.addTable
                            : locConstants.schemaDesigner.editTable}
                    </DrawerHeaderTitle>
                </DrawerHeader>

                <DrawerBody>
                    <SchemaDesignerEditor />
                </DrawerBody>
            </SchemaDesignerEditorContext.Provider>
        </OverlayDrawer>
    );
};
