/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerConfig } from "azdataGraph/dist/src/ts/schemaDesigner/schemaDesignerInterfaces";
import * as schemaDesignerIcons from "./schemaDesignerIcons";
const connectorIcon = require("./icons/connector.svg");
import * as azdataGraph from "azdataGraph";

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
    ): void {
        throw new Error("Function not implemented.");
    },
    publish(_schema: azdataGraph.Schema): void {
        throw new Error("Function not implemented.");
    },
    showToolbar: false,
};
