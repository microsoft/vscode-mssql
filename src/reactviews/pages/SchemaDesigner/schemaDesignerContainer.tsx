/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, useState } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import * as azdataGraph from "azdataGraph";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";
import { config, getSchemaDesignerColors } from "./schemaDesignerConfig";
import { SchemaDesignerTableEditor } from "./schemaDesignerEntityEditor";
import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerToolbar } from "./toolbar/schemaDesignerToolbar";
import { SchemaDiagramZoomControls } from "./schemaDiagramZoomControls";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";

// Set the global mxLoadResources to false to prevent mxgraph from loading resources
window["mxLoadResources"] = false;

export const SchemaDesignerPage = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }
    const [selectedTable, setSelectedTable] = useState<
        SchemaDesigner.Table | undefined
    >(undefined);
    const [schema, setSchema] = useState<SchemaDesigner.Schema>(context.schema);
    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
    const [schemaDesigner, setSchemaDesigner] = useState<
        azdataGraph.SchemaDesigner | undefined
    >(undefined);

    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        context.extensionRpc.subscribe(
            "schemaDesigner",
            "onDidChangeTheme",
            (_params) => {
                if (schemaDesigner) {
                    schemaDesigner.applyColors(getSchemaDesignerColors());
                }
            },
        );
    }, [schemaDesigner]);

    useEffect(() => {
        console.log(
            "SchemaDesignerContainer useEffect",
            context?.state?.schema,
        );
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
                setIsEditDrawerOpen(true);
                setSelectedTable(table);
                setSchema(model);
            };
            console.log("Creating graph");
            const graph = new azdataGraph.SchemaDesigner(
                div,
                schemaDesignerConfig,
            );

            context?.setSchemaDesigner(graph);
            graph.renderSchema(context!.state!.schema, true);
            setSchemaDesigner(graph);
        }
        createGraph();
    }, [context.state.schema]);

    return (
        <>
            <OverlayDrawer
                position={"end"}
                open={isEditDrawerOpen}
                onOpenChange={(_, { open }) => setIsEditDrawerOpen(open)}
                style={{ width: `600px` }}
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label="Close"
                                icon={<FluentIcons.Dismiss24Regular />}
                                onClick={() => setIsEditDrawerOpen(false)}
                            />
                        }
                    >
                        Drawer
                    </DrawerHeaderTitle>
                </DrawerHeader>

                <DrawerBody>
                    <SchemaDesignerTableEditor
                        table={selectedTable!}
                        schema={schema}
                        schemaDesigner={schemaDesigner}
                        onClose={() => {
                            setIsEditDrawerOpen(false);
                            if (schemaDesigner) {
                                setSchema(schemaDesigner.schema);
                            }
                        }}
                    />
                </DrawerBody>
            </OverlayDrawer>
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <SchemaDesignerToolbar />
                <div id="graphContainer" ref={graphContainerRef}></div>
                <SchemaDiagramZoomControls />
            </div>
        </>
    );
};
