/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import * as azdataGraph from "azdataGraph";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";
import * as schemaDesignerIcons from "./schemaDesignerIcons";
import {
    IEntity,
    IRelationship,
} from "../../../sharedInterfaces/schemaDesigner";

const connectorIcon = require("./icons/connector.svg");

export const SchemaDesigner = () => {
    const context = useContext(SchemaDesignerContext);
    window["mxLoadResources"] = false;
    if (!context) {
        return undefined;
    }

    const [editor_pos, setEditorPos] = useState({
        x: 0,
        y: 0,
        scale: 1,
    });

    const [displayEditor, setDisplayEditor] = useState(false);

    const [entity, setEntity] = useState<IEntity | undefined>(undefined);
    const [originalPos, setOriginalPos] = useState({
        x: 0,
        y: 0,
    });

    useEffect(() => {
        function createGraph() {
            const div = document.getElementById("graphContainer");
            if (!div) {
                return;
            }
            div.innerHTML = "";
            div.addEventListener("scroll", (evt) => {
                setEditorPos({
                    x: originalPos.x - div.scrollLeft,
                    y: originalPos.y - div.scrollTop,
                    scale: editor_pos.scale,
                });
                console.log(
                    "OriginalPos",
                    originalPos,
                    "editorPos",
                    originalPos.x - div.scrollLeft,
                    originalPos.y - div.scrollTop,
                );
            });
            const graph = new azdataGraph.SchemaDesigner(div, {
                colors: {
                    cellHighlight: "#00FF00",
                    cellForeground: "var(--vscode-editor-foreground)",
                    cellBackground: "var(--vscode-editor-background)",
                    cellBorder: "var(--vscode-badge-background)",
                    cellColumnHover:
                        "var(--vscode-inputOption-hoverBackground)",
                    cellDivider: "var(--vscode-badge-background)",
                    toolbarBackground: "#2c2c2c",
                    toolbarForeground: "#ffffff",
                    toolbarHoverBackground: "#383838",
                    toolbarDividerBackground: "#444444",
                    graphBackground: "var(--vscode-editor-background)",
                    graphGrid: "var(--vscode-badge-background)",
                    edge: "var(--vscode-editor-foreground)",
                    outlineCellBackground: "#00FF00",
                    outlineBorder: "#00FF00",
                    outlineSize: "#00FF00",
                    outlineSizerRectangle: "#00FF00",
                },
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
                graphFontFamily: "var(--vscode-editor-font-family)",
                isEditable: true,
                editEntity: (
                    cell,
                    x,
                    y,
                    scale,
                    _incomingEdges,
                    outgoingEdges,
                    _model,
                ) => {
                    console.log("cell.geometry", cell.geometry);
                    setEditorPos({
                        x: cell.geometry.x * scale - div.scrollLeft,
                        y: cell.geometry.y * scale - div.scrollTop,
                        scale: scale,
                    });
                    setOriginalPos({
                        x: cell.geometry.x * scale,
                        y: cell.geometry.y * scale,
                    });
                    console.log(
                        "originalPos",
                        cell.geometry.x * scale,
                        cell.geometry.y * scale,
                        "editorPos",
                        cell.geometry.x * scale - div.scrollLeft,
                        cell.geometry.y * scale - div.scrollTop,
                    );
                    setDisplayEditor(true);
                    setEntity(cell.value as IEntity);
                    return {
                        editedEntity: cell.value as IEntity,
                        editedOutgoingEdges: outgoingEdges.map(
                            (edge) => edge.value as IRelationship,
                        ),
                    };
                },
                editRelationship: (cell, _x, _y, _scale) => {
                    return cell.value as IRelationship;
                },
                updateEditorPosition: (x, y, scale) => {
                    // setDisplayEditor(true);
                    // setEditorPos({
                    //     x: x,
                    //     y: y,
                    //     scale: scale,
                    // });
                },
            });
            graph.renderModel(context!.schema, true);
        }
        createGraph();
    }, [context.schema]);

    return (
        <div
            style={{
                height: "100%",
                width: "100%",
                position: "relative",
            }}
        >
            <div id="graphContainer"></div>
            <div
                id="editor"
                style={{
                    width: "400px",
                    height: "400px",
                    position: "absolute",
                    top: editor_pos.y,
                    left: editor_pos.x,
                    transform: `scale(${editor_pos.scale})`,
                    display: displayEditor ? "block" : "none",
                    backgroundColor: "white",
                    zIndex: 1000,
                }}
            >
                {entity ? entity.name : ""}
            </div>
        </div>
    );
};
