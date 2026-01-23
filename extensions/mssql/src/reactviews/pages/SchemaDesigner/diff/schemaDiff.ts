/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PropertyChange, SchemaChange } from "./diffUtils";
import { locConstants } from "../../../common/locConstants";

const loc = locConstants.schemaDesigner.schemaDiff;

function formatValue(value: unknown): string {
    // Treat null/undefined equivalently without explicitly referencing null.
    if (value === undefined || (typeof value === "object" && !value)) {
        return loc.undefinedValue;
    }

    if (Array.isArray(value)) {
        return value.map((v) => String(v)).join(", ");
    }

    return String(value);
}

function describePropertyChanges(propertyChanges: PropertyChange[]): string {
    return propertyChanges
        .map((pc) =>
            loc.propertyChanged(pc.displayName, formatValue(pc.oldValue), formatValue(pc.newValue)),
        )
        .join(", ");
}

function describeQualifiedTable(schema: string, name: string): string {
    return `[${schema}].[${name}]`;
}

/**
 * Returns a human-readable description for a schema change.
 */
export function describeChange(change: SchemaChange): string {
    if (change.category === "table") {
        if (change.action === "add") {
            return loc.createdTable(describeQualifiedTable(change.tableSchema, change.tableName));
        }
        if (change.action === "delete") {
            return loc.deletedTable(describeQualifiedTable(change.tableSchema, change.tableName));
        }

        const props = change.propertyChanges ?? [];
        if (props.length > 0) {
            return loc.modifiedTableWithChanges(
                describeQualifiedTable(change.tableSchema, change.tableName),
                describePropertyChanges(props),
            );
        }

        return loc.modifiedTable(describeQualifiedTable(change.tableSchema, change.tableName));
    }

    if (change.category === "column") {
        const columnName = change.objectName ?? "";
        if (change.action === "add") {
            return loc.addedColumn(columnName);
        }
        if (change.action === "delete") {
            return loc.deletedColumn(columnName);
        }

        const props = change.propertyChanges ?? [];
        if (props.length > 0) {
            return loc.modifiedColumnWithChanges(columnName, describePropertyChanges(props));
        }

        return loc.modifiedColumn(columnName);
    }

    // foreignKey
    const fkName = change.objectName ?? "";
    if (change.action === "add") {
        return loc.addedForeignKey(fkName);
    }
    if (change.action === "delete") {
        return loc.deletedForeignKey(fkName);
    }

    const props = change.propertyChanges ?? [];
    if (props.length > 0) {
        return loc.modifiedForeignKeyWithChanges(fkName, describePropertyChanges(props));
    }

    return loc.modifiedForeignKey(fkName);
}
