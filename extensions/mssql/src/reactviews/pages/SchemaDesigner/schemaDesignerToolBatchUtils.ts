/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback } from "react";
import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { v4 as uuidv4 } from "uuid";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../common/locConstants";
import { columnUtils, flowUtils, foreignKeyUtils, tableUtils } from "./schemaDesignerUtils";

export const TOOL_AUTO_ARRANGE_TABLE_THRESHOLD = 5;
export const TOOL_AUTO_ARRANGE_FOREIGN_KEY_THRESHOLD = 3;

export const waitForNextFrame = (): Promise<void> =>
    new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });

export const shouldAutoArrangeForToolBatch = (params: {
    preTableCount: number;
    postTableCount: number;
    preForeignKeyCount: number;
    postForeignKeyCount: number;
}): boolean => {
    const { preTableCount, postTableCount, preForeignKeyCount, postForeignKeyCount } = params;

    const tablesAdded = Math.max(0, postTableCount - preTableCount);
    const foreignKeysAdded = Math.max(0, postForeignKeyCount - preForeignKeyCount);

    return (
        tablesAdded >= TOOL_AUTO_ARRANGE_TABLE_THRESHOLD ||
        foreignKeysAdded >= TOOL_AUTO_ARRANGE_FOREIGN_KEY_THRESHOLD
    );
};

export const normalizeColumn = (column: SchemaDesigner.Column): SchemaDesigner.Column => {
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

export const normalizeTable = (table: SchemaDesigner.Table): SchemaDesigner.Table | undefined => {
    if (!table || !Array.isArray(table.columns)) {
        return undefined;
    }

    const normalizedColumns = table.columns.map((column) => normalizeColumn(column));

    const normalizedForeignKeys = Array.isArray(table.foreignKeys)
        ? table.foreignKeys.map((fk) => ({
              ...fk,
              id: fk.id || uuidv4(),
              columns: Array.isArray(fk.columns) ? fk.columns : [],
              referencedColumns: Array.isArray(fk.referencedColumns) ? fk.referencedColumns : [],
          }))
        : [];

    return {
        ...table,
        id: table.id || uuidv4(),
        columns: normalizedColumns,
        foreignKeys: normalizedForeignKeys,
    };
};

export const validateTable = (
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
            return foreignKeyErrors.errorMessage ?? locConstants.schemaDesigner.invalidForeignKey;
        }
    }

    return undefined;
};

export function useMaybeAutoArrangeForToolBatch(params: {
    reactFlow: ReactFlowInstance<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>;
    resetView: () => void;
    onPushUndoState: () => void;
}) {
    const { reactFlow, resetView, onPushUndoState } = params;

    return useCallback(
        async (
            preTableCount: number,
            postTableCount: number,
            preForeignKeyCount: number,
            postForeignKeyCount: number,
        ) => {
            if (
                !shouldAutoArrangeForToolBatch({
                    preTableCount,
                    postTableCount,
                    preForeignKeyCount,
                    postForeignKeyCount,
                })
            ) {
                return;
            }

            const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
            const edges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
            const generateComponenets = flowUtils.generatePositions(nodes, edges);
            reactFlow.setNodes(generateComponenets.nodes);
            reactFlow.setEdges(generateComponenets.edges);
            resetView();

            await waitForNextFrame();
            onPushUndoState();
        },
        [reactFlow, resetView, onPushUndoState],
    );
}
