/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerConfig } from "azdataGraph/dist/src/ts/schemaDesigner/schemaDesignerInterfaces";
import * as schemaDesignerIcons from "./schemaDesignerIcons";
const connectorIcon = require("./icons/connector.svg");
import * as azdataGraph from "azdataGraph";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../common/locConstants";

/**
 * Get the schema designer colors from the current theme
 */
export function getSchemaDesignerColors(): azdataGraph.SchemaDesignerColors {
    const body = document.body;
    const computedStyle = getComputedStyle(body);
    return {
        cellHighlight: computedStyle.getPropertyValue("--vscode-focusBorder"),
        cellForeground: computedStyle.getPropertyValue(
            "--vscode-editor-foreground",
        ),
        cellBackground: computedStyle.getPropertyValue(
            "--vscode-editor-background",
        ),
        cellBorder: computedStyle.getPropertyValue("--vscode-badge-background"),
        cellColumnHover: computedStyle.getPropertyValue(
            "--vscode-inputOption-hoverBackground",
        ),
        cellDivider: computedStyle.getPropertyValue(
            "--vscode-badge-background",
        ),
        toolbarBackground: "#2c2c2c",
        toolbarForeground: "#ffffff",
        toolbarHoverBackground: "#383838",
        toolbarDividerBackground: "#444444",
        graphBackground: computedStyle.getPropertyValue(
            "--vscode-editor-background",
        ),
        graphGrid: computedStyle.getPropertyValue("--vscode-badge-background"),
        edge: computedStyle.getPropertyValue("--vscode-editor-foreground"),
        outlineHandleFill: computedStyle.getPropertyValue(
            "--vscode-focusBorder",
        ),
        outline: computedStyle.getPropertyValue("--vscode-focusBorder"),
        graphHandlePreview: computedStyle.getPropertyValue(
            "--vscode-editor-foreground",
        ),
    };
}

/**
 * Schema designer configuration
 */
export const config: SchemaDesignerConfig = {
    icons: {
        addTableIcon: schemaDesignerIcons.addTableIcon,
        undoIcon: schemaDesignerIcons.undoIcon,
        redoIcon: schemaDesignerIcons.redoIcon,
        zoomInIcon: schemaDesignerIcons.zoomInIcon,
        zoomOutIcon: schemaDesignerIcons.zoomOutIcon,
        zoomFitIcon: schemaDesignerIcons.zoomFitIcon,
        deleteIcon: schemaDesignerIcons.deleteIcon,
        entityIcon: schemaDesignerIcons.entityIcon,
        connectorIcon: connectorIcon,
        exportIcon: schemaDesignerIcons.exportIcon,
        autoArrangeCellsIcon: schemaDesignerIcons.autoarrangeIcon,
        editIcon: schemaDesignerIcons.editIcon,
        cancelIcon: schemaDesignerIcons.cancelIcon,
        primaryKeyIcon: schemaDesignerIcons.primaryKeyIcon,
        foreignKeyIcon: schemaDesignerIcons.foreignKeyIcon,
    },
    colors: getSchemaDesignerColors(),
    graphFontFamily: "",
    isEditable: true,
    editTable: function (
        _table: azdataGraph.Table,
        _cell: azdataGraph.mxCell,
        _x: number,
        _y: number,
        _scale: number,
        _model: azdataGraph.Schema,
    ): Promise<azdataGraph.Table> {
        throw new Error("Function not implemented.");
    },
    updateEditorPosition: function (
        _x: number,
        _y: number,
        _scale: number,
    ): void {},
    publish(_schema: azdataGraph.Schema): void {
        throw new Error("Function not implemented.");
    },
    showToolbar: false,
    isForeignKeyValid: function (
        _source: azdataGraph.mxCell,
        _target: azdataGraph.mxCell,
        _sourceColumn: number,
        _targetColumn: number,
    ): boolean {
        console.log(
            `isForeignKeyValid: ${_source.id} -> ${_target.id}, sourceColumn: ${_sourceColumn}, targetColumn: ${_targetColumn}`,
        );
        return true;
        // throw new Error("Function not implemented.");
    },
};

/**
 * Generate a new name for the column based on the existing columns
 * @param existingColumns The existing columns in the table
 * @returns The new column name
 */
export function getNextColumnName(
    existingColumns: SchemaDesigner.Column[],
): string {
    let index = 1;
    let columnName = `column_${index}`;
    while (existingColumns.some((column) => column.name === columnName)) {
        index++;
        columnName = `column_${index}`;
    }
    return columnName;
}

/**
 * Generate a new name for the foreign key based on the existing foreign keys
 * @param existingEdges The existing foreign keys in the table
 * @returns The new foreign key name
 */
export function getNextForeignKeyName(
    existingEdges: SchemaDesigner.ForeignKey[],
): string {
    let index = 1;
    let foreignKeyName = `FK_${index}`;
    while (existingEdges.some((edge) => edge.name === foreignKeyName)) {
        index++;
        foreignKeyName = `FK_${index}`;
    }
    return foreignKeyName;
}

/**
 * Get all tables in the schema except the current one
 * @param schema
 * @param currentTable
 * @returns
 */
export function getAllTables(
    schema: SchemaDesigner.Schema,
    currentTable: SchemaDesigner.Table,
): SchemaDesigner.Table[] {
    return schema.tables
        .filter(
            (entity) =>
                entity.schema !== currentTable.schema ||
                entity.name !== currentTable.name,
        )
        .sort();
}

/**
 * Get display name for the table
 * @param schema schema
 * @param displayName display name
 * @returns table
 */
export function getTableFromDisplayName(
    schema: SchemaDesigner.Schema,
    displayName: string,
): SchemaDesigner.Table {
    return schema.tables.find(
        (entity) => `${entity.schema}.${entity.name}` === displayName,
    )!;
}

export function isForeignKeyValid(
    tables: SchemaDesigner.Table[],
    table: SchemaDesigner.Table,
    foreignKey: SchemaDesigner.ForeignKey,
): ForeignKeyValidationResult {
    // Check if the name is not empty
    if (foreignKey.name === "") {
        return {
            errorMessage: locConstants.schemaDesigner.foreignKeyNameEmptyError,
            isValid: false,
        };
    }

    const referencedTable = tables.find(
        (t) =>
            t.name === foreignKey.referencedTableName &&
            t.schema === foreignKey.referencedSchemaName,
    );
    // Check if the foreign table exists
    if (!referencedTable) {
        return {
            errorMessage: locConstants.schemaDesigner.referencedTableNotFound(
                foreignKey.referencedTableName,
            ),
            isValid: false,
        };
    }

    // Check if the foreign key columns are not repeated in the same table
    const columnNames = foreignKey.columns;
    const uniqueColumnNames = new Set(columnNames);
    if (uniqueColumnNames.size !== columnNames.length) {
        return {
            errorMessage:
                locConstants.schemaDesigner.duplicateForeignKeyColumns,
            isValid: false,
        };
    }

    for (let i = 0; i < foreignKey.columns.length; i++) {
        const columnName = foreignKey.columns[i];

        // Check if the column exists in the table
        const column = table.columns.find((c) => c.name === columnName);
        if (!column) {
            return {
                errorMessage:
                    locConstants.schemaDesigner.columnNotFound(columnName),
                isValid: false,
            };
        }
        const referencedColumnName = foreignKey.referencedColumns[i];
        const referencedColumn = referencedTable.columns.find(
            (c) => c.name === referencedColumnName,
        );

        // Check if the referenced column exists
        if (!referencedColumn) {
            return {
                errorMessage:
                    locConstants.schemaDesigner.referencedColumnNotFound(
                        referencedColumnName,
                    ),
                isValid: false,
            };
        }

        // Check if the data types are compatible
        const datatypeCompatibility = areDataTypesCompatible(
            column,
            referencedColumn,
        );
        if (!datatypeCompatibility.isValid) {
            return {
                errorMessage: datatypeCompatibility.errorMessage,
                isValid: false,
            };
        }

        // // Referenced column must be a primary key or unique
        if (!referencedColumn.isPrimaryKey && !referencedColumn.isUnique) {
            console.log(
                `Referenced column ${referencedColumnName} is not a primary key or unique`,
            );
            return {
                errorMessage:
                    locConstants.schemaDesigner.referencedColumnNotUnique(
                        referencedColumnName,
                    ),
                isValid: false,
            };
        }

        // Check for cyclic foreign key references
        if (isCyclicForeignKey(tables, referencedTable, table)) {
            return {
                errorMessage:
                    locConstants.schemaDesigner.cyclicForeignKeyDetected(
                        table.name,
                        referencedTable.name,
                    ),
                isValid: false,
            };
        }
    }

    return {
        isValid: true,
    };
}

export function areDataTypesCompatible(
    column: SchemaDesigner.Column,
    referencedColumn: SchemaDesigner.Column,
): ForeignKeyValidationResult {
    if (column.dataType !== referencedColumn.dataType) {
        return {
            errorMessage: locConstants.schemaDesigner.incompatibleDataTypes(
                column.dataType,
                column.name,
                referencedColumn.dataType,
                referencedColumn.name,
            ),
            isValid: false,
        };
    }

    if (
        isLengthBasedType(column.dataType) &&
        column.maxLength !== referencedColumn.maxLength &&
        referencedColumn.maxLength !== -1
    ) {
        return {
            errorMessage: locConstants.schemaDesigner.incompatibleLength(
                column.name,
                referencedColumn.name,
                column.maxLength,
                referencedColumn.maxLength,
            ),
            isValid: false,
        };
    }

    if (
        (isPrecisionBasedType(column.dataType) &&
            column.precision !== referencedColumn.precision) ||
        column.scale !== referencedColumn.scale
    ) {
        return {
            errorMessage:
                locConstants.schemaDesigner.incompatiblePrecisionOrScale(
                    column.name,
                    referencedColumn.name,
                ),
            isValid: false,
        };
    }

    return {
        isValid: true,
    };
}

export function isLengthBasedType(dataType: string): boolean {
    return (
        dataType === "char" ||
        dataType === "varchar" ||
        dataType === "nchar" ||
        dataType === "nvarchar" ||
        dataType === "binary" ||
        dataType === "varbinary"
    );
}

export function isPrecisionBasedType(dataType: string): boolean {
    return (
        dataType === "decimal" ||
        dataType === "numeric" ||
        dataType === "float" ||
        dataType === "real"
    );
}

export function isCyclicForeignKey(
    tables: SchemaDesigner.Table[],
    currentTable: SchemaDesigner.Table | undefined,
    referencedTable: SchemaDesigner.Table | undefined,
    visited: Set<string> = new Set(),
): boolean {
    if (!currentTable || !referencedTable) {
        return false;
    }

    if (visited.has(currentTable.id)) {
        return true; // Cycle detected
    }

    visited.add(currentTable.id);

    for (const foreignKey of currentTable.foreignKeys) {
        const currentReferencedTable = tables.find(
            (t) =>
                t.name === foreignKey.referencedTableName &&
                t.schema === foreignKey.referencedSchemaName,
        );

        if (!currentReferencedTable) {
            continue; // Skip if the referenced table is not found
        }

        if (currentReferencedTable.id === referencedTable.id) {
            return true; // Cycle detected
        }

        if (
            isCyclicForeignKey(
                tables,
                currentReferencedTable,
                referencedTable,
                new Set(visited),
            )
        ) {
            return true;
        }
    }

    return false;
}

export interface ForeignKeyValidationResult {
    isValid: boolean;
    errorMessage?: string;
}

// TODO: Remove when publish script is implemented with DacFx
export function addWarningToSQLScript(script: string): string {
    const warning =
        `-- **************************************************\n` +
        `-- WARNING: REVIEW BEFORE APPLYING CHANGES\n` +
        `-- **************************************************\n` +
        `-- You are about to modify the database schema.\n` +
        `-- Please carefully review the script before execution, as changes can:\n` +
        `--\n` +
        `-- - Impact existing data integrity and relationships\n` +
        `-- - Cause unintended data loss or corruption\n` +
        `-- - Affect system performance and application stability\n` +
        `--\n` +
        `-- RECOMMENDED ACTIONS:\n` +
        `-- - Backup your database before proceeding\n` +
        `-- - Test the script in a development environment\n` +
        `-- - Ensure all dependencies and constraints are considered\n` +
        `--\n` +
        `-- Proceed with caution. Once applied, changes may not be reversible.\n` +
        `-- **************************************************\n\n`;

    return warning + script;
}

/**
 * Fill in default values for the column properties based on the data type
 * @param column The column to fill defaults for
 * @returns The column with default values filled in
 */
export function fillColumnDefaults(
    column: SchemaDesigner.Column,
): SchemaDesigner.Column {
    if (isLengthBasedType(column.dataType)) {
        column.maxLength = getDefaultLength(column.dataType);
    } else {
        column.maxLength = 0;
    }
    if (isPrecisionBasedType(column.dataType)) {
        column.precision = getDefaultPrecision(column.dataType);
        column.scale = getDefaultScale(column.dataType);
    } else {
        column.precision = 0;
        column.scale = 0;
    }
    return column;
}

/**
 * Get the default length for a given data type
 * @param dataType The data type
 * @returns The default length
 */
export function getDefaultLength(dataType: string): number {
    switch (dataType) {
        case "char":
        case "nchar":
        case "binary":
            return 1;
        case "varchar":
        case "nvarchar":
        case "varbinary":
            return 50;
        default:
            return 0; // Default length not applicable
    }
}

/**
 * Get the default precision for a given data type
 * @param dataType The data type
 * @returns The default precision
 */
export function getDefaultPrecision(dataType: string): number {
    switch (dataType) {
        case "decimal":
        case "numeric":
            return 18;
        case "float":
            return 53;
        case "real":
            return 24;
        default:
            return 0; // Default precision not applicable
    }
}

/**
 * Get the default scale for a given data type
 * @param dataType The data type
 * @returns The default scale
 */
export function getDefaultScale(dataType: string): number {
    switch (dataType) {
        case "decimal":
        case "numeric":
            return 2;
        default:
            return 0; // Default scale not applicable
    }
}

export function tableNameValidationError(
    schema: SchemaDesigner.Schema,
    table: SchemaDesigner.Table,
): string | undefined {
    const existingTable = schema.tables.find(
        (t) =>
            t.name.toLocaleLowerCase() === table.name.toLocaleLowerCase() &&
            t.schema.toLocaleLowerCase() === table.schema.toLocaleLowerCase() &&
            t.id !== table.id,
    );
    if (existingTable) {
        return locConstants.schemaDesigner.tableNameRepeatedError(table.name);
    }
    if (table.name === "") {
        return locConstants.schemaDesigner.tableNameEmptyError;
    }
    return undefined;
}
