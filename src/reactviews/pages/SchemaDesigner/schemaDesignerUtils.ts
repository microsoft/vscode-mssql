/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerConfig } from "azdataGraph/dist/src/ts/schemaDesigner/schemaDesignerInterfaces";
import * as schemaDesignerIcons from "./schemaDesignerIcons";
const connectorIcon = require("./icons/connector.svg");
import * as azdataGraph from "azdataGraph";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";

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
