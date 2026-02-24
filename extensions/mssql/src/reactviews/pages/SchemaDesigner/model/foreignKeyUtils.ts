/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Connection, Edge, Node } from "@xyflow/react";
import { v4 as uuidv4 } from "uuid";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import { buildSchemaFromFlowState } from "./schemaFromFlowState";
import { columnUtils } from "./columnUtils";

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

        if (columnUtils.isLengthBasedType(col.dataType) && col.maxLength !== refCol.maxLength) {
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
                errorMessage: locConstants.schemaDesigner.incompatiblePrecisionOrScale(
                    col.name,
                    refCol.name,
                ),
            };
        }

        if (columnUtils.isTimeBasedWithScale(col.dataType) && col.scale !== refCol.scale) {
            return {
                isValid: false,
                errorMessage: locConstants.schemaDesigner.incompatibleScale(col.name, refCol.name),
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
        if (!current || !target) {
            return false;
        }

        if (current.id === target.id && visited.size === 0) {
            return false;
        }

        if (visited.has(current.id)) {
            return true;
        }

        visited.add(current.id);
        for (const fk of current.foreignKeys) {
            const next = tables.find((t) => t.id === fk.referencedTableId);
            if (!next) {
                continue;
            }

            if (
                next.id === target.id ||
                foreignKeyUtils.isCyclicForeignKey(tables, next, target, new Set(visited))
            ) {
                return true;
            }
        }
        return false;
    },

    isForeignKeyValid: (
        tables: SchemaDesigner.Table[],
        table: SchemaDesigner.Table,
        fk: SchemaDesigner.ForeignKey,
    ): ForeignKeyValidationResult => {
        const refTable = tables.find((t) => t.id === fk.referencedTableId);
        if (!refTable) {
            return {
                isValid: false,
                errorMessage: locConstants.schemaDesigner.referencedTableNotFound(
                    fk.referencedTableId,
                ),
            };
        }

        const existingFks = table.foreignKeys.filter((f) => f.id !== fk.id);

        const columnsSet = new Set<string>();
        for (const existingFk of existingFks) {
            for (const columnId of existingFk.columnIds) {
                columnsSet.add(columnId);
            }
        }

        for (const columnId of fk.columnIds) {
            if (columnsSet.has(columnId)) {
                return {
                    isValid: false,
                    errorMessage: locConstants.schemaDesigner.duplicateForeignKeyColumns(columnId),
                };
            }
            columnsSet.add(columnId);
        }

        for (let index = 0; index < fk.columnIds.length; index++) {
            const sourceColumnId = fk.columnIds[index];
            const referencedColumnId = fk.referencedColumnIds[index];

            const col = table.columns.find((c) => c.id === sourceColumnId);
            const refCol = refTable.columns.find((c) => c.id === referencedColumnId);

            if (!col) {
                return {
                    isValid: false,
                    errorMessage: locConstants.schemaDesigner.columnNotFound(sourceColumnId),
                };
            }
            if (!refCol) {
                return {
                    isValid: false,
                    errorMessage:
                        locConstants.schemaDesigner.referencedColumnNotFound(referencedColumnId),
                };
            }

            const typeCheck = foreignKeyUtils.areDataTypesCompatible(col, refCol);
            if (!typeCheck.isValid) {
                return typeCheck;
            }

            if (!refCol.isPrimaryKey) {
                return {
                    isValid: false,
                    errorMessage: locConstants.schemaDesigner.referencedColumnNotPK(refCol.name),
                };
            }

            if (
                col.isIdentity &&
                (fk.onUpdateAction !== SchemaDesigner.OnAction.NO_ACTION ||
                    fk.onDeleteAction !== SchemaDesigner.OnAction.NO_ACTION)
            ) {
                return {
                    isValid: false,
                    errorMessage: locConstants.schemaDesigner.identityColumnFKConstraint(col.name),
                };
            }
        }

        return { isValid: true };
    },

    getForeignKeyWarnings: (
        tables: SchemaDesigner.Table[],
        table: SchemaDesigner.Table,
        fk: SchemaDesigner.ForeignKey,
    ): ForeignKeyValidationResult => {
        let hasWarnings = false;
        const warningMessages: string[] = [];

        const refTable = tables.find((t) => t.id === fk.referencedTableId);

        if (!refTable) {
            return {
                isValid: false,
                errorMessage: locConstants.schemaDesigner.referencedTableNotFound(
                    fk.referencedTableId,
                ),
            };
        }

        if (!fk.name) {
            hasWarnings = true;
            warningMessages.push(locConstants.schemaDesigner.foreignKeyNameEmptyWarning);
        }

        if (foreignKeyUtils.isCyclicForeignKey(tables, refTable, table)) {
            hasWarnings = true;
            warningMessages.push(
                locConstants.schemaDesigner.cyclicForeignKeyDetected(table.name, refTable.name),
            );
        }

        return {
            isValid: !hasWarnings,
            errorMessage: hasWarnings ? warningMessages.join(", ") : undefined,
        };
    },

    extractColumnIdFromHandle: (handleId: string): string => {
        return handleId.replace("left-", "").replace("right-", "");
    },

    createForeignKeyFromConnection: (
        sourceNode: Node<SchemaDesigner.Table>,
        targetNode: Node<SchemaDesigner.Table>,
        sourceColumnId: string,
        targetColumnId: string,
        existingFkId?: string,
        existingFkName?: string,
    ): SchemaDesigner.ForeignKey => {
        return {
            id: existingFkId || uuidv4(),
            name: existingFkName || `FK_${sourceNode.data.name}_${targetNode.data.name}`,
            columnIds: [sourceColumnId],
            referencedTableId: targetNode.data.id,
            referencedColumnIds: [targetColumnId],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };
    },

    validateConnection: (
        connection: Connection | Edge<SchemaDesigner.ForeignKey>,
        nodes: Node<SchemaDesigner.Table>[],
        edges: Edge<SchemaDesigner.ForeignKey>[],
    ): ForeignKeyValidationResult => {
        const sourceTable = nodes.find((node) => node.id === connection.source);
        const targetTable = nodes.find((node) => node.id === connection.target);

        if (!sourceTable || !targetTable) {
            return {
                isValid: false,
                errorMessage: "Source or target table not found",
            };
        }

        const sourceColumnId = connection.sourceHandle
            ? foreignKeyUtils.extractColumnIdFromHandle(connection.sourceHandle)
            : "";
        const targetColumnId = connection.targetHandle
            ? foreignKeyUtils.extractColumnIdFromHandle(connection.targetHandle)
            : "";

        if (!sourceColumnId || !targetColumnId) {
            return {
                isValid: false,
                errorMessage: "Source or target column not found",
            };
        }

        const sourceColumn = sourceTable.data.columns.find((c) => c.id === sourceColumnId);
        const targetColumn = targetTable.data.columns.find((c) => c.id === targetColumnId);

        if (!sourceColumn || !targetColumn) {
            return {
                isValid: false,
                errorMessage: "Source or target column not found",
            };
        }

        const foreignKey = foreignKeyUtils.createForeignKeyFromConnection(
            sourceTable,
            targetTable,
            sourceColumn.id,
            targetColumn.id,
        );

        return foreignKeyUtils.isForeignKeyValid(
            buildSchemaFromFlowState(nodes, edges).tables,
            sourceTable.data,
            foreignKey,
        );
    },

    getOnActionOptions: (): {
        label: string;
        value: SchemaDesigner.OnAction;
    }[] => {
        return [
            {
                label: locConstants.schemaDesigner.cascade,
                value: SchemaDesigner.OnAction.CASCADE,
            },
            {
                label: locConstants.schemaDesigner.noAction,
                value: SchemaDesigner.OnAction.NO_ACTION,
            },
            {
                label: locConstants.schemaDesigner.setNull,
                value: SchemaDesigner.OnAction.SET_NULL,
            },
            {
                label: locConstants.schemaDesigner.setDefault,
                value: SchemaDesigner.OnAction.SET_DEFAULT,
            },
        ];
    },

    convertStringToOnAction: (action: string): SchemaDesigner.OnAction => {
        switch (action) {
            case locConstants.schemaDesigner.cascade:
                return SchemaDesigner.OnAction.CASCADE;
            case locConstants.schemaDesigner.noAction:
                return SchemaDesigner.OnAction.NO_ACTION;
            case locConstants.schemaDesigner.setNull:
                return SchemaDesigner.OnAction.SET_NULL;
            case locConstants.schemaDesigner.setDefault:
                return SchemaDesigner.OnAction.SET_DEFAULT;
            default:
                return SchemaDesigner.OnAction.NO_ACTION;
        }
    },

    convertOnActionToString: (action: SchemaDesigner.OnAction): string => {
        switch (action) {
            case SchemaDesigner.OnAction.CASCADE:
                return locConstants.schemaDesigner.cascade;
            case SchemaDesigner.OnAction.NO_ACTION:
                return locConstants.schemaDesigner.noAction;
            case SchemaDesigner.OnAction.SET_NULL:
                return locConstants.schemaDesigner.setNull;
            case SchemaDesigner.OnAction.SET_DEFAULT:
                return locConstants.schemaDesigner.setDefault;
            default:
                return locConstants.schemaDesigner.noAction;
        }
    },
};
