/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const NUMERIC_SQL_TYPES = new Set([
    "tinyint",
    "smallint",
    "int",
    "bigint",
    "decimal",
    "numeric",
    "float",
    "real",
    "money",
    "smallmoney",
]);

/**
 * CSS class applied to result grid cells whose column holds a numeric SQL type.
 */
export const NUMERIC_CELL_CSS_CLASS = "numeric-cell";

/**
 * Determines if a SQL data type name (e.g. "int", "decimal(18, 2)") is a numeric type
 * @param dataTypeName - SQL data type name reported for the column
 * @returns true if the type is numeric, false otherwise
 */
export function isNumericSqlType(dataTypeName: string | undefined): boolean {
    const baseType = dataTypeName?.trim().toLowerCase().split("(")[0].trim();
    return !!baseType && NUMERIC_SQL_TYPES.has(baseType);
}
