/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerConfig } from "azdataGraph/dist/src/ts/schemaDesigner/schemaDesignerInterfaces";
import * as schemaDesignerIcons from "./schemaDesignerIcons";
const connectorIcon = require("./icons/connector.svg");
import * as azdataGraph from "azdataGraph";
import {
    ISchema,
    IEntity,
    IRelationship,
} from "../../../sharedInterfaces/schemaDesigner";

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
    colors: {
        cellHighlight: "#00FF00",
        cellForeground: "var(--vscode-editor-foreground)",
        cellBackground: "var(--vscode-editor-background)",
        cellBorder: "var(--vscode-badge-background)",
        cellColumnHover: "var(--vscode-inputOption-hoverBackground)",
        cellDivider: "var(--vscode-badge-background)",
        toolbarBackground: "#2c2c2c",
        toolbarForeground: "#ffffff",
        toolbarHoverBackground: "#383838",
        toolbarDividerBackground: "#444444",
        graphBackground: "var(--vscode-editor-background)",
        graphGrid: "var(--vscode-badge-background)",
        edge: "var(--vscode-editor-foreground)",
        outlineHandleFill: "#00FF00",
        outline: "#00FF00",
        graphHandlePreview: "var(--vscode-editor-foreground)",
    },
    graphFontFamily: "",
    isEditable: true,
    editEntity: function (
        _cell: azdataGraph.mxCell,
        _x: number,
        _y: number,
        _scale: number,
        _incomingEdges: azdataGraph.mxCell[],
        _outgoingEdges: azdataGraph.mxCell[],
        _model: ISchema,
    ): Promise<{
        editedEntity: IEntity;
        editedOutgoingEdges: IRelationship[];
    }> {
        throw new Error("Function not implemented.");
    },
    editRelationship: function (
        _cell: azdataGraph.mxCell,
        _x: number,
        _y: number,
        _scale: number,
    ): IRelationship {
        throw new Error("Function not implemented.");
    },
    updateEditorPosition: function (
        _x: number,
        _y: number,
        _scale: number,
    ): void {
        throw new Error("Function not implemented.");
    },
};
