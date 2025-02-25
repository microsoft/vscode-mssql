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
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    PositioningImperativeRef,
} from "@fluentui/react-components";
import * as htmlToImage from "html-to-image";

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

    const [schemaDesigner, setSchemaDesigner] = useState<
        azdataGraph.SchemaDesigner | undefined
    >(undefined);

    const [exportAsMenuOpen, setExportAsMenuOpen] = useState(false);
    const exportPositioningRef = useRef<PositioningImperativeRef>(null);

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

            schemaDesignerConfig.publish = (_schema) => {
                setExportAsMenuOpen(true);
            };

            const graph = new azdataGraph.SchemaDesigner(
                div,
                schemaDesignerConfig,
            );

            div.addEventListener("scroll", (_evt) => {
                updateEditorPosition(
                    currentCell.x - div.scrollLeft,
                    currentCell.y - div.scrollTop,
                    currentCell.scale,
                );
            });
            graph.renderSchema(context!.schema, true);
            setSchemaDesigner(graph);

            const exportAsButton = document.querySelector(
                ".sd-toolbar-button[title='Export']",
            );
            if (exportAsButton) {
                if (exportPositioningRef.current) {
                    exportPositioningRef.current.setTarget(exportAsButton);
                }
            }
        }
        createGraph();
    }, [context.schema]);

    async function exportAs(format: "svg" | "png" | "jpg") {
        if (!schemaDesigner) {
            return;
        }
        const imageContent = await schemaDesigner.exportImage(format);
        if (imageContent && context) {
            context.saveAs(
                imageContent.fileContent,
                imageContent.format,
                imageContent.width,
                imageContent.height,
            );
            return;
        }
        // transperant background
        var background = "none";
        var scale = 1;
        var border = 1;

        if (!schemaDesigner) {
            return;
        }

        const mxGraphFactory = azdataGraph.mxGraphFactory;
        const graph = schemaDesigner.mxGraph;

        var imgExport = new mxGraphFactory.mxImageExport();
        var bounds = graph.getGraphBounds();
        var vs = graph.view.scale;

        // Prepares SVG document that holds the output
        var svgDoc = mxGraphFactory.mxUtils.createXmlDocument();
        var root =
            svgDoc.createElementNS !== null
                ? svgDoc.createElementNS(
                      mxGraphFactory.mxConstants.NS_SVG,
                      "svg",
                  )
                : svgDoc.createElement("svg");

        if (background !== null) {
            if (root.style !== null) {
                root.style.backgroundColor = background;
            } else {
                root.setAttribute("style", "background-color:" + background);
            }
        }

        if (svgDoc.createElementNS == null) {
            root.setAttribute("xmlns", mxGraphFactory.mxConstants.NS_SVG);
            root.setAttribute(
                "xmlns:xlink",
                mxGraphFactory.mxConstants.NS_XLINK,
            );
        } else {
            // KNOWN: Ignored in IE9-11, adds namespace for each image element instead. No workaround.
            root.setAttributeNS(
                "http://www.w3.org/2000/xmlns/",
                "xmlns:xlink",
                mxGraphFactory.mxConstants.NS_XLINK,
            );
        }

        root.setAttribute(
            "width",
            Math.ceil((bounds.width * scale) / vs) + 2 * border + "px",
        );
        root.setAttribute(
            "height",
            Math.ceil((bounds.height * scale) / vs) + 2 * border + "px",
        );
        root.setAttribute("version", "1.1");

        // Adds group for anti-aliasing via transform
        var group =
            svgDoc.createElementNS !== null
                ? svgDoc.createElementNS(mxGraphFactory.mxConstants.NS_SVG, "g")
                : svgDoc.createElement("g");
        group.setAttribute("transform", "translate(0.5,0.5)");
        root.appendChild(group);
        svgDoc.appendChild(root);

        // Renders graph. Offset will be multiplied with state's scale when painting state.
        var svgCanvas = new mxGraphFactory.mxSvgCanvas2D(group);
        svgCanvas.translate(
            Math.floor((border / scale - bounds.x) / vs),
            Math.floor((border / scale - bounds.y) / vs),
        );
        svgCanvas.scale(scale / vs);

        // Displayed if a viewer does not support foreignObjects (which is needed to HTML output)
        //svgCanvas.foAltText = "[Not supported by viewer]";
        imgExport.drawState(
            graph.getView().getState(graph.model.root),
            svgCanvas,
        );
        const outlineDiv = document.getElementsByClassName(
            "sd-outline",
        )[0] as HTMLElement;
        if (outlineDiv) {
            outlineDiv.style.display = "none";
        }
        if (!context) {
            return;
        }
        schemaDesigner.mxGraph.setSelectionCell(null as unknown as mxCell);
        schemaDesigner.mxGraph.connectionHandler.destroyIcons();
        if (format === "png") {
            htmlToImage
                .toPng(
                    document.getElementById("graphContainer") as HTMLElement,
                    {
                        width: bounds.width + 200,
                        height: bounds.height + 200,
                    },
                )
                .then((dataUrl) => {
                    context.saveAs("png", dataUrl, bounds.width, bounds.height);
                    if (outlineDiv) {
                        outlineDiv.style.display = "";
                    }
                })
                .catch((err) => {
                    console.error("oops, something went wrong!", err);
                });
        } else if (format === "jpg") {
            htmlToImage
                .toJpeg(
                    document.getElementById("graphContainer") as HTMLElement,
                    {
                        quality: 1,
                        width: bounds.width + 200,
                        height: bounds.height + 200,
                    },
                )
                .then((dataUrl) => {
                    context.saveAs("jpg", dataUrl, bounds.width, bounds.height);
                    if (outlineDiv) {
                        outlineDiv.style.display = "";
                    }
                })
                .catch((err) => {
                    console.error("oops, something went wrong!", err);
                });
        } else if (format === "svg") {
            const colors = getSchemaDesignerColors();
            root.style.backgroundColor = colors.graphBackground;
            context.saveAs("svg", root.outerHTML, bounds.width, bounds.height);
            if (outlineDiv) {
                outlineDiv.style.display = "";
            }
        }
    }

    return (
        <div
            style={{
                height: "100%",
                width: "100%",
                position: "relative",
            }}
        >
            <div id="graphContainer" ref={graphContainerRef}></div>
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
            <Menu
                open={exportAsMenuOpen}
                onOpenChange={(_e, data) => {
                    setExportAsMenuOpen(data.open);
                }}
                positioning={{ positioningRef: exportPositioningRef }}
            >
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            onClick={async (_e) => {
                                setTimeout(() => {
                                    void exportAs("svg");
                                }, 0);
                            }}
                        >
                            SVG
                        </MenuItem>
                        <MenuItem
                            onClick={(_e) => {
                                setTimeout(() => {
                                    void exportAs("png");
                                }, 0);
                            }}
                        >
                            PNG
                        </MenuItem>
                        <MenuItem
                            onClick={(_e) => {
                                setTimeout(() => {
                                    void exportAs("jpg");
                                }, 0);
                            }}
                        >
                            JPG
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};

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
