/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColumnInfo } from "../../../models/contracts/flatFile";

export interface DataTypeOption {
    name: string;
    displayName: string;
}

const dataTypeNames = [
    "bigint",
    "binary(50)",
    "bit",
    "char(10)",
    "date",
    "datetime",
    "datetime2(7)",
    "datetimeoffset(7)",
    "decimal(18, 10)",
    "float",
    "geography",
    "geometry",
    "hierarchyid",
    "int",
    "money",
    "nchar(10)",
    "ntext",
    "numeric(18, 0)",
    "nvarchar(50)",
    "nvarchar(4000)",
    "nvarchar(MAX)",
    "real",
    "smalldatetime",
    "smallint",
    "smallmoney",
    "sql_variant",
    "text",
    "time(7)",
    "timestamp",
    "tinyint",
    "uniqueidentifier",
    "varbinary(50)",
    "varbinary(MAX)",
    "varchar(50)",
    "varchar(8000)",
    "varchar(MAX)",
];

const dataTypeOptions = dataTypeNames.map((name) => ({ name, displayName: name }));
const variableCharacterTypePattern = /^(n?varchar)\((MAX|\d+)\)$/i;

interface VariableCharacterType {
    name: "nvarchar" | "varchar";
    maximumBoundedLength: number;
}

function parseVariableCharacterType(sqlType: string): VariableCharacterType | undefined {
    const match = variableCharacterTypePattern.exec(sqlType.trim());
    if (!match) {
        return undefined;
    }

    const name = match[1].toLowerCase() as VariableCharacterType["name"];

    return {
        name,
        maximumBoundedLength: name === "nvarchar" ? 4000 : 8000,
    };
}

/**
 * Retains types inferred by the service that are outside the standard list, such as
 * nvarchar(100), so the current selection remains available in the dropdown.
 */
export function getDataTypeOptions(column: ColumnInfo): DataTypeOption[] {
    if (dataTypeNames.includes(column.sqlType)) {
        return dataTypeOptions;
    }

    const type = parseVariableCharacterType(column.sqlType);
    const insertionPoint = type ? `${type.name}(${type.maximumBoundedLength})` : column.sqlType;
    const options = [...dataTypeOptions];
    const index = options.findIndex((option) => option.name === insertionPoint);
    const inferredType = { name: column.sqlType, displayName: column.sqlType };
    options.splice(index >= 0 ? index : options.length, 0, inferredType);
    return options;
}
