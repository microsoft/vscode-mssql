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
import { mxCell } from "mxgraph";
import { SchemaDesignerTableEditor } from "./schemaDesignerEntityEditor";
import { ITable } from "../../../sharedInterfaces/schemaDesigner";
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

// Set the global mxLoadResources to false to prevent mxgraph from loading resources
window["mxLoadResources"] = false;

export const SchemaDesigner = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const [displayEditor, setDisplayEditor] = useState(false);

    const [table, setTable] = useState<ITable | undefined>(undefined);

    const [schema, setSchema] = useState<azdataGraph.ISchema>(context.schema);

    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    const editorDivRef = useRef<HTMLDivElement | null>(null);

    const [isOpen, setIsOpen] = useState(false);

    const [schemaDesigner, setSchemaDesigner] = useState<
        azdataGraph.SchemaDesigner | undefined
    >(undefined);

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
        const editorDiv = editorDivRef.current;
        function updateEditorPosition(x: number, y: number, scale: number) {
            if (!editorDiv) {
                return;
            }
            editorDiv.style.transform = `scale(${scale})`;
            editorDiv.style.top = `${y}px`;
            editorDiv.style.left = `${x}px`;
        }
        function createGraph() {
            let currentCell = {
                x: 0,
                y: 0,
                scale: 1,
                height: 0,
                cell: undefined! as mxCell,
            };
            const div = graphContainerRef.current;
            if (!div) {
                return;
            }
            div.innerHTML = "";
            const schemaDesignerConfig = config;
            schemaDesignerConfig.editTable = async (
                table,
                cell,
                x,
                y,
                scale,
                model,
            ) => {
                setIsOpen(true);
                const cellPosition = calculateEditorPosition(
                    x,
                    y,
                    cell.geometry.height,
                    scale,
                    div.scrollHeight,
                );
                currentCell = {
                    x: cellPosition.x,
                    y: cellPosition.y,
                    scale: scale,
                    cell: cell,
                    height: cell.geometry.height,
                };

                setDisplayEditor(true);

                updateEditorPosition(
                    currentCell.x - div.scrollLeft,
                    currentCell.y - div.scrollTop,
                    scale,
                );

                setTable(table);
                setSchema(model);
            };

            schemaDesignerConfig.updateEditorPosition = (x, y, scale) => {
                const cellPosition = calculateEditorPosition(
                    x,
                    y,
                    currentCell.height,
                    scale,
                    div.scrollHeight,
                );
                currentCell.x = cellPosition.x;
                currentCell.y = cellPosition.y;
                currentCell.scale = scale;

                updateEditorPosition(
                    x - div.scrollLeft,
                    y - div.scrollTop,
                    graph.mxGraph.view.scale,
                );
            };

            const graph = new azdataGraph.SchemaDesigner(
                div,
                schemaDesignerConfig,
            );

            context?.setSchemaDesigner(graph);

            div.addEventListener("scroll", (_evt) => {
                updateEditorPosition(
                    currentCell.x - div.scrollLeft,
                    currentCell.y - div.scrollTop,
                    currentCell.scale,
                );
            });
            graph.renderSchema(context!.schema, true);
            setSchemaDesigner(graph);
        }
        createGraph();
    }, [context.schema]);

    return (
        <>
            <OverlayDrawer
                position={"end"}
                open={isOpen}
                onOpenChange={(_, { open }) => setIsOpen(open)}
                style={{ width: `600px` }}
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label="Close"
                                icon={<FluentIcons.Dismiss24Regular />}
                                onClick={() => setIsOpen(false)}
                            />
                        }
                    >
                        Drawer
                    </DrawerHeaderTitle>
                </DrawerHeader>

                <DrawerBody>
                    <SchemaDesignerTableEditor
                        table={table!}
                        schema={schema}
                        schemaDesigner={schemaDesigner}
                        onClose={() => {
                            setDisplayEditor(false);
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
                <div
                    className="sd-editor"
                    ref={editorDivRef}
                    style={{
                        display: displayEditor ? "block" : "none",
                    }}
                >
                    <SchemaDesignerTableEditor
                        table={table!}
                        schema={schema}
                        schemaDesigner={schemaDesigner}
                        onClose={() => {
                            setDisplayEditor(false);
                            if (schemaDesigner) {
                                setSchema(schemaDesigner.schema);
                            }
                        }}
                    />
                </div>
            </div>
        </>
    );
};

/**
 *
 * @param cellX
 * @param cellY
 * @param cellHeight
 * @param mxGraphScale
 * @param mxGraphDivScrollHeight
 * @returns
 */
function calculateEditorPosition(
    cellX: number,
    cellY: number,
    cellHeight: number,
    mxGraphScale: number,
    mxGraphDivScrollHeight: number,
) {
    const EDITOR_HEIGHT = 400;
    const x = cellX - 3 * mxGraphScale; // Make sure the editor doesn't go off the left side of the cell
    const y = cellY + ((cellHeight - EDITOR_HEIGHT) * mxGraphScale) / 2; // Center the editor vertically in the cell
    const minY = 10 * mxGraphScale; // Make sure the editor doesn't go off the top of the graph div
    const maxY = mxGraphDivScrollHeight - (EDITOR_HEIGHT + 20) * mxGraphScale; // Make sure the editor doesn't go off the bottom of the graph div
    return {
        x: x,
        y: Math.min(Math.max(y, minY), maxY),
    };
}
