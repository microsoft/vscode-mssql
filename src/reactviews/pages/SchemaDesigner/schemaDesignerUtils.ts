/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../common/locConstants";
import { Connection, Edge, MarkerType, Node } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { v4 as uuidv4 } from "uuid";

export const namingUtils = {
    getNextColumnName: (columns: SchemaDesigner.Column[]): string => {
        let index = 1;
        while (columns.some((c) => c.name === `column_${index}`)) index++;
        return `column_${index}`;
    },

    getNextForeignKeyName: (
        foreignKeys: SchemaDesigner.ForeignKey[],
    ): string => {
        let index = 1;
        while (foreignKeys.some((fk) => fk.name === `FK_${index}`)) index++;
        return `FK_${index}`;
    },

    getNextTableName: (tables: SchemaDesigner.Table[]): string => {
        let index = 1;
        while (tables.some((t) => t.name === `table_${index}`)) index++;
        return `table_${index}`;
    },
};

export const tableUtils = {
    getAllTables: (
        schema: SchemaDesigner.Schema,
        current: SchemaDesigner.Table,
    ): SchemaDesigner.Table[] => {
        return schema.tables
            .filter(
                (t) => t.schema !== current.schema || t.name !== current.name,
            )
            .sort();
    },

    getTableFromDisplayName: (
        schema: SchemaDesigner.Schema,
        displayName: string,
    ): SchemaDesigner.Table => {
        return schema.tables.find(
            (t) => `${t.schema}.${t.name}` === displayName,
        )!;
    },

    tableNameValidationError: (
        schema: SchemaDesigner.Schema,
        table: SchemaDesigner.Table,
    ): string | undefined => {
        const conflict = schema.tables.find(
            (t) =>
                t.name.toLowerCase() === table.name.toLowerCase() &&
                t.schema.toLowerCase() === table.schema.toLowerCase() &&
                t.id !== table.id,
        );

        if (conflict)
            return locConstants.schemaDesigner.tableNameRepeatedError(
                table.name,
            );
        if (!table.name) return locConstants.schemaDesigner.tableNameEmptyError;
        return undefined;
    },

    createNewTable: (
        schema: SchemaDesigner.Schema,
        schemaNames: string[],
    ): SchemaDesigner.Table => {
        const name = namingUtils.getNextTableName(schema.tables);
        return {
            name,
            schema: schemaNames[0],
            columns: [
                {
                    name: "Id",
                    dataType: "int",
                    maxLength: 0,
                    precision: 0,
                    scale: 0,
                    isNullable: true,
                    isPrimaryKey: true,
                    isUnique: false,
                    id: uuidv4(),
                    isIdentity: true,
                    identitySeed: 1,
                    identityIncrement: 1,
                    collation: "",
                },
            ],
            foreignKeys: [],
            id: uuidv4(),
        };
    },
};

export const columnUtils = {
    isLengthBasedType: (type: string): boolean => {
        return [
            "char",
            "varchar",
            "nchar",
            "nvarchar",
            "binary",
            "varbinary",
        ].includes(type);
    },

    isPrecisionBasedType: (type: string): boolean => {
        return ["decimal", "numeric", "float", "real"].includes(type);
    },

    getDefaultLength: (type: string): number => {
        switch (type) {
            case "char":
            case "nchar":
            case "binary":
                return 1;
            case "varchar":
            case "nvarchar":
            case "varbinary":
                return 50;
            default:
                return 0;
        }
    },

    getDefaultPrecision: (type: string): number => {
        switch (type) {
            case "decimal":
            case "numeric":
                return 18;
            case "float":
                return 53;
            case "real":
                return 24;
            default:
                return 0;
        }
    },

    getDefaultScale: (type: string): number => {
        switch (type) {
            case "decimal":
            case "numeric":
                return 2;
            default:
                return 0;
        }
    },

    fillColumnDefaults: (
        column: SchemaDesigner.Column,
    ): SchemaDesigner.Column => {
        if (columnUtils.isLengthBasedType(column.dataType))
            column.maxLength = columnUtils.getDefaultLength(column.dataType);
        else column.maxLength = 0;

        if (columnUtils.isPrecisionBasedType(column.dataType)) {
            column.precision = columnUtils.getDefaultPrecision(column.dataType);
            column.scale = columnUtils.getDefaultScale(column.dataType);
        } else {
            column.precision = 0;
            column.scale = 0;
        }

        return column;
    },
};

// Foreign key validation
export interface ForeignKeyValidationResult {
    isValid: boolean;
    errorMessage?: string;
}

export const foreignKeyUtils = {
    areDataTypesCompatible: (
        col: SchemaDesigner.Column,
        refCol: SchemaDesigner.Column,
    ): ForeignKeyValidationResult => {
        if (col.dataType !== refCol.dataType) {
            return {
                isValid: false,
                errorMessage: locConstants.schemaDesigner.incompatibleDataTypes(
                    col.dataType,
                    col.name,
                    refCol.dataType,
                    refCol.name,
                ),
            };
        }

        if (
            columnUtils.isLengthBasedType(col.dataType) &&
            col.maxLength !== refCol.maxLength &&
            refCol.maxLength !== -1
        ) {
            return {
                isValid: false,
                errorMessage: locConstants.schemaDesigner.incompatibleLength(
                    col.name,
                    refCol.name,
                    col.maxLength,
                    refCol.maxLength,
                ),
            };
        }

        if (
            columnUtils.isPrecisionBasedType(col.dataType) &&
            (col.precision !== refCol.precision || col.scale !== refCol.scale)
        ) {
            return {
                isValid: false,
                errorMessage:
                    locConstants.schemaDesigner.incompatiblePrecisionOrScale(
                        col.name,
                        refCol.name,
                    ),
            };
        }

        return { isValid: true };
    },

    isCyclicForeignKey: (
        tables: SchemaDesigner.Table[],
        current: SchemaDesigner.Table | undefined,
        target: SchemaDesigner.Table | undefined,
        visited = new Set<string>(),
    ): boolean => {
        if (!current || !target) return false;
        if (visited.has(current.id)) return true;

        visited.add(current.id);
        for (const fk of current.foreignKeys) {
            const next = tables.find(
                (t) =>
                    t.name === fk.referencedTableName &&
                    t.schema === fk.referencedSchemaName,
            );
            if (!next) continue;
            if (
                next.id === target.id ||
                foreignKeyUtils.isCyclicForeignKey(
                    tables,
                    next,
                    target,
                    new Set(visited),
                )
            )
                return true;
        }
        return false;
    },

    isForeignKeyValid: (
        tables: SchemaDesigner.Table[],
        table: SchemaDesigner.Table,
        fk: SchemaDesigner.ForeignKey,
    ): ForeignKeyValidationResult => {
        if (!fk.name)
            return {
                isValid: false,
                errorMessage:
                    locConstants.schemaDesigner.foreignKeyNameEmptyError,
            };

        const refTable = tables.find(
            (t) =>
                t.name === fk.referencedTableName &&
                t.schema === fk.referencedSchemaName,
        );
        if (!refTable)
            return {
                isValid: false,
                errorMessage:
                    locConstants.schemaDesigner.referencedTableNotFound(
                        fk.referencedTableName,
                    ),
            };

        const uniqueCols = new Set(fk.columns);
        if (uniqueCols.size !== fk.columns.length) {
            return {
                isValid: false,
                errorMessage:
                    locConstants.schemaDesigner.duplicateForeignKeyColumns,
            };
        }

        for (let i = 0; i < fk.columns.length; i++) {
            const col = table.columns.find((c) => c.name === fk.columns[i]);
            const refCol = refTable.columns.find(
                (c) => c.name === fk.referencedColumns[i],
            );

            if (!col)
                return {
                    isValid: false,
                    errorMessage: locConstants.schemaDesigner.columnNotFound(
                        fk.columns[i],
                    ),
                };
            if (!refCol)
                return {
                    isValid: false,
                    errorMessage:
                        locConstants.schemaDesigner.referencedColumnNotFound(
                            fk.referencedColumns[i],
                        ),
                };

            const typeCheck = foreignKeyUtils.areDataTypesCompatible(
                col,
                refCol,
            );
            if (!typeCheck.isValid) return typeCheck;

            if (!refCol.isPrimaryKey && !refCol.isUnique) {
                return {
                    isValid: false,
                    errorMessage:
                        locConstants.schemaDesigner.referencedColumnNotPK(
                            refCol.name,
                        ),
                };
            }

            if (foreignKeyUtils.isCyclicForeignKey(tables, refTable, table)) {
                return {
                    isValid: false,
                    errorMessage:
                        locConstants.schemaDesigner.cyclicForeignKeyDetected(
                            table.name,
                            refTable.name,
                        ),
                };
            }
        }

        return { isValid: true };
    },

    extractForeignKeysFromEdges: (
        edges: Edge<SchemaDesigner.ForeignKey>[],
        sourceTableId: string,
        schema: SchemaDesigner.Schema,
    ): SchemaDesigner.ForeignKey[] => {
        const filteredEdges = edges.filter(
            (edge) => edge.source === sourceTableId,
        );
        const edgesMap = new Map<string, SchemaDesigner.ForeignKey>();

        filteredEdges.forEach((edge) => {
            const sourceTable = schema.tables.find((t) => t.id === edge.source);
            const targetTable = schema.tables.find((t) => t.id === edge.target);

            if (!sourceTable || !targetTable || !edge.data) {
                return;
            }

            const foreignKey: SchemaDesigner.ForeignKey = {
                id: edge.data.id,
                columns: [...edge.data.columns],
                name: edge.data.name,
                onDeleteAction: edge.data.onDeleteAction,
                onUpdateAction: edge.data.onUpdateAction,
                referencedColumns: [...edge.data.referencedColumns],
                referencedSchemaName: edge.data.referencedSchemaName,
                referencedTableName: edge.data.referencedTableName,
            };

            if (edgesMap.has(edge.data.id)) {
                // If the edge already exists, append columns and referencedColumns
                const existingForeignKey = edgesMap.get(edge.data.id);
                if (existingForeignKey) {
                    existingForeignKey.columns.push(...foreignKey.columns);
                    existingForeignKey.referencedColumns.push(
                        ...foreignKey.referencedColumns,
                    );
                }
            } else {
                edgesMap.set(edge.data.id, foreignKey);
            }
        });

        return Array.from(edgesMap.values());
    },

    /**
     * Extract column name from a handle ID
     */
    extractColumnNameFromHandle: (handleId: string): string => {
        return handleId.replace("left-", "").replace("right-", "");
    },

    /**
     * Creates a foreign key object from connection data
     */
    createForeignKeyFromConnection: (
        sourceNode: Node<SchemaDesigner.Table>,
        targetNode: Node<SchemaDesigner.Table>,
        sourceColumnName: string,
        targetColumnName: string,
        existingFkId?: string,
        existingFkName?: string,
    ): SchemaDesigner.ForeignKey => {
        return {
            id: existingFkId || uuidv4(),
            name:
                existingFkName ||
                `FK_${sourceNode.data.name}_${targetNode.data.name}`,
            columns: [sourceColumnName],
            referencedSchemaName: targetNode.data.schema,
            referencedTableName: targetNode.data.name,
            referencedColumns: [targetColumnName],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };
    },

    /**
     * Validates a connection between nodes
     */
    validateConnection: (
        connection: Connection | Edge<SchemaDesigner.ForeignKey>,
        nodes: Node<SchemaDesigner.Table>[],
        edges: Edge<SchemaDesigner.ForeignKey>[],
    ): ForeignKeyValidationResult => {
        const sourceTable = nodes.find(
            (node) => node.id === connection.source,
        ) as Node<SchemaDesigner.Table>;
        const targetTable = nodes.find(
            (node) => node.id === connection.target,
        ) as Node<SchemaDesigner.Table>;

        if (!sourceTable || !targetTable) {
            return {
                isValid: false,
                errorMessage: "Source or target table not found",
            };
        }

        const sourceColumnName = connection.sourceHandle
            ? foreignKeyUtils.extractColumnNameFromHandle(
                  connection.sourceHandle,
              )
            : "";
        const targetColumnName = connection.targetHandle
            ? foreignKeyUtils.extractColumnNameFromHandle(
                  connection.targetHandle,
              )
            : "";

        if (!sourceColumnName || !targetColumnName) {
            return {
                isValid: false,
                errorMessage: "Source or target column not found",
            };
        }

        // Create a foreign key for validation
        const foreignKey = foreignKeyUtils.createForeignKeyFromConnection(
            sourceTable,
            targetTable,
            sourceColumnName,
            targetColumnName,
        );

        // Validate the foreign key relationship
        return foreignKeyUtils.isForeignKeyValid(
            flowUtils.extractSchemaModel(nodes, edges).tables,
            sourceTable.data,
            foreignKey,
        );
    },
};

// Constants for layout and dimensions
export const LAYOUT_CONSTANTS = {
    NODE_WIDTH: 300,
    NODE_MARGIN: 50,
    BASE_NODE_HEIGHT: 70,
    COLUMN_HEIGHT: 30,
    LAYOUT_OPTIONS: {
        rankdir: "LR",
        marginx: 50,
        marginy: 50,
        nodesep: 50,
        ranksep: 50,
    },
};

// Flow layout utilities
export const flowUtils = {
    getTableWidth: (): number =>
        LAYOUT_CONSTANTS.NODE_WIDTH + LAYOUT_CONSTANTS.NODE_MARGIN,

    getTableHeight: (table: SchemaDesigner.Table): number =>
        LAYOUT_CONSTANTS.BASE_NODE_HEIGHT +
        table.columns.length * LAYOUT_CONSTANTS.COLUMN_HEIGHT,

    generateSchemaDesignerFlowComponents: (
        schema: SchemaDesigner.Schema,
    ): {
        nodes: Node<SchemaDesigner.Table>[];
        edges: Edge<SchemaDesigner.ForeignKey>[];
    } => {
        if (!schema) {
            return { nodes: [], edges: [] };
        }

        const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(
            () => ({}),
        );
        graph.setGraph(LAYOUT_CONSTANTS.LAYOUT_OPTIONS);

        const rawNodes = schema.tables.map((table) => ({
            id: table.id,
            type: "tableNode",
            data: { ...table },
        }));

        // Layout nodes and connect tables via foreign keys
        rawNodes.forEach((node) => {
            graph.setNode(node.id, {
                width: flowUtils.getTableWidth(),
                height: flowUtils.getTableHeight(node.data),
            });

            node.data.foreignKeys.forEach((fk) => {
                const referencedTable = schema.tables.find(
                    (t) =>
                        t.name === fk.referencedTableName &&
                        t.schema === fk.referencedSchemaName,
                );
                if (referencedTable) {
                    graph.setEdge(node.id, referencedTable.id);
                }
            });
        });

        dagre.layout(graph);

        const layoutedNodes = rawNodes.map((node) => {
            const dagreNode = graph.node(node.id);

            return {
                ...node,
                position: {
                    x: dagreNode.x - flowUtils.getTableWidth() / 2,
                    y: dagreNode.y - flowUtils.getTableHeight(node.data) / 2,
                },
            };
        });

        const edges: Edge<SchemaDesigner.ForeignKey>[] = [];

        for (const table of schema.tables) {
            for (const fk of table.foreignKeys) {
                const referencedTable = schema.tables.find(
                    (t) =>
                        t.name === fk.referencedTableName &&
                        t.schema === fk.referencedSchemaName,
                );

                if (!referencedTable) continue;

                fk.columns.forEach((col, idx) => {
                    const refCol = fk.referencedColumns[idx];

                    edges.push({
                        id: `${table.name}-${referencedTable.name}-${col}-${refCol}`,
                        source: table.id,
                        target: referencedTable.id,
                        sourceHandle: `right-${col}`,
                        targetHandle: `left-${refCol}`,
                        markerEnd: {
                            type: MarkerType.ArrowClosed,
                        },
                        data: {
                            name: fk.name,
                            id: fk.id,
                            columns: [col],
                            referencedSchemaName: fk.referencedSchemaName,
                            referencedTableName: fk.referencedTableName,
                            referencedColumns: [refCol],
                            onDeleteAction: fk.onDeleteAction,
                            onUpdateAction: fk.onUpdateAction,
                        },
                    });
                });
            }
        }

        return {
            nodes: layoutedNodes,
            edges,
        };
    },

    extractSchemaModel: (
        nodes: Node<SchemaDesigner.Table>[],
        edges: Edge<SchemaDesigner.ForeignKey>[],
    ): SchemaDesigner.Schema => {
        // Create a deep copy of the nodes to avoid mutating the original data
        const tables = nodes.map((node) => ({
            ...node.data,
            foreignKeys: [] as SchemaDesigner.ForeignKey[],
        }));

        // Process edges to create foreign keys
        edges.forEach((edge) => {
            const sourceNode = nodes.find((node) => node.id === edge.source);
            const targetNode = nodes.find((node) => node.id === edge.target);

            if (!sourceNode || !targetNode || !edge.data) {
                console.warn(
                    `Edge ${edge.id} references non-existent nodes or has no data`,
                );
                return;
            }

            const foreignKey: SchemaDesigner.ForeignKey = {
                id: edge.data.id,
                name: edge.data.name,
                columns: [...edge.data.columns],
                referencedSchemaName: edge.data.referencedSchemaName,
                referencedTableName: edge.data.referencedTableName,
                referencedColumns: [...edge.data.referencedColumns],
                onDeleteAction: edge.data.onDeleteAction,
                onUpdateAction: edge.data.onUpdateAction,
            };

            // Find the table node that corresponds to the source of the edge
            const sourceTable = tables.find((node) => node.id === edge.source);
            if (!sourceTable) {
                console.warn(`Source table ${edge.source} not found`);
                return;
            }

            // Find if the foreign key already exists in the source table
            const existingForeignKey = sourceTable.foreignKeys.find(
                (fk) => fk.id === foreignKey.id,
            );

            if (existingForeignKey) {
                // Update the existing foreign key
                existingForeignKey.columns.push(foreignKey.columns[0]);
                existingForeignKey.referencedColumns.push(
                    foreignKey.referencedColumns[0],
                );
            } else {
                // Add the new foreign key to the source table
                sourceTable.foreignKeys.push(foreignKey);
            }
        });
        return {
            tables: tables,
        };
    },
};

// SQL Script utilities
export const scriptUtils = {
    // TODO: Remove when publish script is implemented with DacFx
    addWarningToSQLScript: (script: string): string => {
        return (
            `-- **************************************************
-- WARNING: REVIEW BEFORE APPLYING CHANGES
-- **************************************************
-- You are about to modify the database schema.
-- Please carefully review the script before execution, as changes can:
-- - Impact existing data integrity and relationships
-- - Cause unintended data loss or corruption
-- - Affect system performance and application stability
-- RECOMMENDED ACTIONS:
-- - Backup your database before proceeding
-- - Test the script in a development environment
-- - Ensure all dependencies and constraints are considered
-- Proceed with caution. Once applied, changes may not be reversible.
-- **************************************************

` + script
        );
    },
};
