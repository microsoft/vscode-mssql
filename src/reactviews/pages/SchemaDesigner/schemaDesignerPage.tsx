/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import * as azdataGraph from "azdataGraph";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";
import { config, getSchemaDesignerColors } from "./schemaDesignerUtils";
import { SchemaDesignerToolbar } from "./toolbar/schemaDesignerToolbar";
import { SchemaDiagramZoomControls } from "./schemaDiagramZoomControls";
import { SchemaDesignerEditorDrawer } from "./editor/schemaDesignerEditorDrawer";
import { SchemaDesignerCodeDrawer } from "./schemaDesignerCodeDrawer";

// Set the global mxLoadResources to false to prevent mxgraph from loading resources
window["mxLoadResources"] = false;

export const SchemaDesignerPage = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        context.extensionRpc.subscribe(
            "schemaDesigner",
            "onDidChangeTheme",
            (_params) => {
                if (context.schemaDesigner) {
                    context.schemaDesigner.applyColors(
                        getSchemaDesignerColors(),
                    );
                }
            },
        );
    }, [context.schemaDesigner]);

    useEffect(() => {
        function createGraph() {
            const div = graphContainerRef.current;
            if (!div) {
                return;
            }
            div.innerHTML = "";
            const schemaDesignerConfig = config;
            schemaDesignerConfig.editTable = async (
                table,
                _cell,
                _x,
                _y,
                _scale,
                model,
            ) => {
                context.setIsEditDrawerOpen(true);
                context.setSelectedTable(table);
                context.setSchema(model);
            };
            const graph = new azdataGraph.SchemaDesigner(
                div,
                schemaDesignerConfig,
            );

            context?.setSchemaDesigner(graph);
            graph.renderSchema(context!.state!.schema, true);
            context.setSchemaDesigner(graph);
        }
        createGraph();
    }, [context.state.schema]);

    return (
        <>
            <SchemaDesignerEditorDrawer />
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                }}
            >
                <div
                    style={{
                        maxHeight: "100%",
                        minHeight: "60%",
                        flex: 1,
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        position: "relative",
                    }}
                >
                    <SchemaDesignerToolbar />
                    <div id="graphContainer" ref={graphContainerRef}></div>
                    <SchemaDiagramZoomControls />
                </div>
                <SchemaDesignerCodeDrawer />
            </div>
        </>
    );
};
