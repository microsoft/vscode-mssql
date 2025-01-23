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
import {
    addTableIcon,
    autoarrangeIcon,
    bitIcon,
    customDataTypeIcon,
    dateTimeIcon,
    decimalIcon,
    deleteIcon,
    entityIcon,
    exportIcon,
    geographyIcon,
    intIcon,
    moneyIcon,
    redoIcon,
    textIcon,
    undoIcon,
    varbinaryIcon,
    zoomFitIcon,
    zoomInIcon,
    zoomOutIcon,
} from "./schemaDesignerIcons";

const connectorIcon = require("./icons/connector.svg");

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
                    cellHighlight: "",
                    cellForeground: "",
                    cellBackground: "",
                    cellBorder: "",
                    cellColumnHover: "",
                    cellDivider: "",
                    toolbarBackground: "",
                    toolbarForeground: "",
                    toolbarHoverBackground: "",
                    toolbarDividerBackground: "",
                    graphBackground: "",
                    graphGrid: "",
                    edge: "",
                    outlineCellBackground: "",
                    outlineBorder: "",
                    outlineSize: "",
                    outlineSizerRectangle: "",
                },
                icons: {
                    addTableIcon: addTableIcon,
                    undoIcon: undoIcon,
                    redoIcon: redoIcon,
                    zoomInIcon: zoomInIcon,
                    zoomOutIcon: zoomOutIcon,
                    zoomFitIcon: zoomFitIcon,
                    deleteIcon: deleteIcon,
                    entityIcon: entityIcon,
                    dataTypeIcons: {
                        int: intIcon,
                        tinyint: intIcon,
                        smallint: intIcon,
                        bigint: intIcon,
                        numeric: decimalIcon,
                        decimal: decimalIcon,
                        money: moneyIcon,
                        smallmoney: moneyIcon,
                        bit: bitIcon,
                        float: decimalIcon,
                        real: decimalIcon,
                        char: textIcon,
                        varchar: textIcon,
                        text: textIcon,
                        nchar: textIcon,
                        nvarchar: textIcon,
                        ntext: textIcon,
                        binary: varbinaryIcon,
                        varbinary: varbinaryIcon,
                        image: varbinaryIcon,
                        geography: geographyIcon,
                        datetime: dateTimeIcon,
                        datetime2: dateTimeIcon,
                        date: dateTimeIcon,
                        time: dateTimeIcon,
                        datetimeoffset: dateTimeIcon,
                        smalldatetime: dateTimeIcon,
                    },
                    customDataTypeIcon: customDataTypeIcon,
                    connectorIcon: connectorIcon,
                    exportIcon: exportIcon,
                    autoarrangeIcon: autoarrangeIcon,
                },
                graphFontFamily: "var(--vscode-font-family)",
                isEditable: false,
            });
            graph._graph.getStylesheet().getDefaultVertexStyle()["fillColor"] =
                "#add6ff";
            graph.renderModel(context!.schema, true);
        }
        createGraph();
    }, [context.schema]);

    return <div id="graphContainer"></div>;
};
