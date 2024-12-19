/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import * as azdataGraph from "azdataGraph";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";

export const SchemaDesigner = () => {
    const context = useContext(SchemaDesignerContext);
    window["mxLoadResources"] = false;
    if (!context) {
        return undefined;
    }

    useEffect(() => {
        function createGraph() {
            const div = document.getElementById("graphContainer");
            if (!div) {
                return;
            }
            div.innerHTML = "";
            const graph = new azdataGraph.SchemaDesigner(div, {
                graphFontFamily: "var(--vscode-font-family)",
                cellFillColor: "var(--vscode-editor-background)",
                cellHighlightColor: "var(--vscode-editor-background)",
                edgeStrokeColor: "var(--vscode-editor-foreground)",
                outlineColor: "var(--vscode-editor-foreground)",
                toolbarBackgroundColor: "var(--vscode-editor-background)",
                addTableIcon: "../resources/light/addTable.svg",
                undoIcon: "../resources/light/undo.svg",
                redoIcon: "../resources/light/redo.svg",
                zoomInIcon: "../resources/light/zoomIn.svg",
                zoomOutIcon: "../resources/light/zoomOut.svg",
                deleteIcon: "../resources/light/delete.svg",
                entityIcon: "../resources/light/entity.svg",
                dataTypeIcons: {
                    int: "../resources/light/int.svg",
                    nvarchar: "../resources/light/nvarchar.svg",
                    datetime: "../resources/light/datetime.svg",
                    bit: "../resources/light/bit.svg",
                    decimal: "../resources/light/decimal.svg",
                },
                connectorIcon: "../resources/light/connector.svg",
                validColor: "var(--vscode-inputValidation-infoBorder)",
                invalidColor: "var(--vscode-inputValidation-errorBorder)",
                exportIcon: "../resources/light/export.svg",
                autoarrangeIcon: "../resources/light/autoarrange.svg",
            });
            graph.renderModel(context!.schema, true);
        }
        createGraph();
    }, [context.schema]);

    return <div id="graphContainer"></div>;
};
