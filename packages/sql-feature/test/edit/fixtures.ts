/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ColumnMetadata,
    IndexMetadata,
    TableMetadata,
} from "../../src/edit/metadata/tableMetadata";

export function column(
    name: string,
    typeName: string,
    overrides: Partial<ColumnMetadata> = {},
): ColumnMetadata {
    const isComputed = overrides.isComputed ?? false;
    const isIdentity = overrides.isIdentity ?? false;
    const isServerAssigned =
        overrides.isServerAssigned ?? (typeName === "rowversion" || typeName === "timestamp");
    return {
        name,
        ordinal: overrides.ordinal ?? 1,
        typeName,
        isNullable: overrides.isNullable ?? true,
        isIdentity,
        isComputed,
        isServerAssigned,
        hasDefault: overrides.hasDefault ?? false,
        isWritable: overrides.isWritable ?? (!isComputed && !isIdentity && !isServerAssigned),
        ...(overrides.maxLength !== undefined ? { maxLength: overrides.maxLength } : {}),
        ...(overrides.precision !== undefined ? { precision: overrides.precision } : {}),
        ...(overrides.scale !== undefined ? { scale: overrides.scale } : {}),
    };
}

export function index(
    name: string,
    columns: string[],
    overrides: Partial<IndexMetadata> = {},
): IndexMetadata {
    return {
        name,
        columns,
        isPrimaryKey: overrides.isPrimaryKey ?? false,
        isUnique: overrides.isUnique ?? true,
        isNullable: overrides.isNullable ?? false,
    };
}

export function table(overrides: Partial<TableMetadata> = {}): TableMetadata {
    const columns = overrides.columns ?? [
        column("Id", "int", { isIdentity: true, isNullable: false, ordinal: 1 }),
        column("Name", "nvarchar", { maxLength: 100, ordinal: 2 }),
        column("Total", "int", { ordinal: 3 }),
    ];
    return {
        schema: overrides.schema ?? "dbo",
        name: overrides.name ?? "Orders",
        objectType: overrides.objectType ?? "table",
        columns,
        indexes: overrides.indexes ?? [index("PK_Orders", ["Id"], { isPrimaryKey: true })],
        isMemoryOptimized: overrides.isMemoryOptimized ?? false,
        isUpdatable: overrides.isUpdatable ?? true,
        ...(overrides.rowVersionColumn ? { rowVersionColumn: overrides.rowVersionColumn } : {}),
    };
}
