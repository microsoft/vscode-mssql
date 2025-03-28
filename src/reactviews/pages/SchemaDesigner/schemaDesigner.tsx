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
import * as schemaDesignerIcons from "./schemaDesignerIcons";

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
                    dataTypeIcons: {
                        int: schemaDesignerIcons.intIcon,
                        tinyint: schemaDesignerIcons.intIcon,
                        smallint: schemaDesignerIcons.intIcon,
                        bigint: schemaDesignerIcons.intIcon,
                        numeric: schemaDesignerIcons.decimalIcon,
                        decimal: schemaDesignerIcons.decimalIcon,
                        money: schemaDesignerIcons.moneyIcon,
                        smallmoney: schemaDesignerIcons.moneyIcon,
                        bit: schemaDesignerIcons.bitIcon,
                        float: schemaDesignerIcons.decimalIcon,
                        real: schemaDesignerIcons.decimalIcon,
                        char: schemaDesignerIcons.textIcon,
                        varchar: schemaDesignerIcons.textIcon,
                        text: schemaDesignerIcons.textIcon,
                        nchar: schemaDesignerIcons.textIcon,
                        nvarchar: schemaDesignerIcons.textIcon,
                        ntext: schemaDesignerIcons.textIcon,
                        binary: schemaDesignerIcons.varbinaryIcon,
                        varbinary: schemaDesignerIcons.varbinaryIcon,
                        image: schemaDesignerIcons.varbinaryIcon,
                        geography: schemaDesignerIcons.geographyIcon,
                        datetime: schemaDesignerIcons.dateTimeIcon,
                        datetime2: schemaDesignerIcons.dateTimeIcon,
                        date: schemaDesignerIcons.dateTimeIcon,
                        time: schemaDesignerIcons.dateTimeIcon,
                        datetimeoffset: schemaDesignerIcons.dateTimeIcon,
                        smalldatetime: schemaDesignerIcons.dateTimeIcon,
                    },
                    customDataTypeIcon: schemaDesignerIcons.customDataTypeIcon,
                    connectorIcon: connectorIcon,
                    exportIcon: schemaDesignerIcons.exportIcon,
                    autoarrangeIcon: schemaDesignerIcons.autoarrangeIcon,
                },
                graphFontFamily: "var(--vscode-editor-font-family)",
                isEditable: false,
            });
            graph.renderModel(context!.schema, true);
        }
        createGraph();
    }, [context.schema]);

    return <div id="graphContainer"></div>;
};
