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

const addTableIcon = require("./icons/addTable.svg");
const undoIcon = require("./icons/undo.svg");
const redoIcon = require("./icons/redo.svg");
const zoomInIcon = require("./icons/zoomIn.svg");
const zoomOutIcon = require("./icons/zoomOut.svg");
const deleteIcon = require("./icons/delete.svg");
const entityIcon = require("./icons/table.svg");
const connectorIcon = require("./icons/connector.svg");
const exportIcon = require("./icons/export.svg");
const autoarrangeIcon = require("./icons/arrange.svg");
const customDataTypeIcon = require("./icons/datatype_custom.svg");
const intDataTypeIcon = require("./icons/datatype_int.svg");
const bitDataTypeIcon = require("./icons/datatype_bit.svg");
const datetimeDataTypeIcon = require("./icons/datatype_datetime.svg");
const decimalDataTypeIcon = require("./icons/datatype_decimal.svg");
const geographyDataTypeIcon = require("./icons/datatype_geography.svg");
const moneyDataTypeIcon = require("./icons/datatype_money.svg");
const textDataTypeIcon = require("./icons/datatype_text.svg");
const varbinaryDataTypeIcon = require("./icons/datatype_varbinary.svg");
const zoomToFitIcon = require("./icons/zoomFit.svg");

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
                colors: {
                    cellHighlight: "#388a34",
                    cellForeground: "var(--vscode-editor-foreground)",
                    cellBackground: "var(--vscode-editorInfo-foreground)",
                    cellBorder: "var(--vscode-badge-background)",
                    toolbarBackground: "var(--vscode-editor-foreground)",
                    toolbarForeground: "",
                    toolbarHoverBackground: "",
                    toolbarDividerBackground: "#444444",
                    graphBackground: "var(--vscode-editor-background)",
                    graphGrid: "var(--vscode-badge-background)",
                    edge: "var(--vscode-editor-foreground)",
                    outlineCellBackground: "",
                    outlineBorder: "",
                    outlineSize: "",
                    outlineSizerRectangle: "var(--vscode-focusBorder)",
                    cellColumnHover: "var(--vscode-toolbar-hoverBackground)",
                },
                icons: {
                    addTableIcon: addTableIcon,
                    undoIcon: undoIcon,
                    redoIcon: redoIcon,
                    zoomInIcon: zoomInIcon,
                    zoomOutIcon: zoomOutIcon,
                    deleteIcon: deleteIcon,
                    entityIcon: entityIcon,
                    zoomFitIcon: zoomToFitIcon,
                    dataTypeIcons: {
                        int: intDataTypeIcon,
                        nvarchar: textDataTypeIcon,
                        datetime: datetimeDataTypeIcon,
                        datetime2: datetimeDataTypeIcon,
                        bit: bitDataTypeIcon,
                        geography: geographyDataTypeIcon,
                        bigint: intDataTypeIcon,
                        varbinary: varbinaryDataTypeIcon,
                        decimal: decimalDataTypeIcon,
                        date: datetimeDataTypeIcon,
                        money: moneyDataTypeIcon,
                    },
                    connectorIcon: connectorIcon,
                    exportIcon: exportIcon,
                    autoarrangeIcon: autoarrangeIcon,
                    customDataTypeIcon: customDataTypeIcon,
                },
                graphFontFamily: "var(--vscode-font-family)",
                isEditable: true,
            });
            graph._graph.getStylesheet().getDefaultVertexStyle()["fillColor"] =
                "#add6ff";
            graph.renderModel(context!.schema, true);
        }
        createGraph();
    }, [context.schema]);

    return <div id="graphContainer"></div>;
};
