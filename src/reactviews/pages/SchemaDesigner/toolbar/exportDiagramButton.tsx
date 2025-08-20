/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import * as htmlToImage from "html-to-image";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";
import { generateSvgFromReactFlow, createSvgDataUrl } from "../utils/svgExporter";

export function ExportDiagramButton() {
    const { getNodes, getEdges } = useReactFlow();
    const context = useContext(SchemaDesignerContext);

    async function exportAs(format: "svg" | "png" | "jpeg") {
        const reactFlowContainer = document.querySelector(".react-flow__viewport") as HTMLElement;
        const computedStyle = getComputedStyle(reactFlowContainer);
        const graphBackgroundColor = computedStyle.getPropertyValue("--vscode-editor-background");
        if (!context) {
            return;
        }

        // Ensure all nodes are visible before exporting
        context.setRenderOnlyVisibleTables(false);
        context.setIsExporting(true);
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for the nodes to be rendered

        const nodesBounds = getNodesBounds(getNodes().filter((node) => !node.hidden));
        const viewport = getViewportForBounds(
            nodesBounds,
            nodesBounds.width,
            nodesBounds.height,
            0.5,
            2,
            50,
        );

        const width = nodesBounds.width + 100;
        const height = nodesBounds.height + 100;

        switch (format) {
            case "png":
                void htmlToImage
                    .toPng(reactFlowContainer, {
                        width: width,
                        height: height,
                        backgroundColor: graphBackgroundColor,
                        style: {
                            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                            width: `${width}px`,
                            height: `${height}px`,
                        },
                    })
                    .then((dataUrl) => {
                        context.saveAsFile({
                            format,
                            fileContents: dataUrl,
                            width,
                            height,
                        });
                    });
                break;
            case "jpeg":
                void htmlToImage
                    .toJpeg(reactFlowContainer, {
                        width: width,
                        height: height,
                        backgroundColor: graphBackgroundColor,
                        style: {
                            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                            width: `${width}px`,
                            height: `${height}px`,
                        },
                    })
                    .then((dataUrl) => {
                        context.saveAsFile({
                            format,
                            fileContents: dataUrl,
                            width,
                            height,
                        });
                    });
                break;
            case "svg":
                // Use custom SVG generator for clean, editable SVG output
                const nodes = getNodes().filter((node) => !node.hidden);
                const edges = getEdges();
                const nodesBounds = getNodesBounds(nodes);

                try {
                    // Run SVG generation asynchronously to prevent UI blocking
                    setTimeout(() => {
                        try {
                            const svgContent = generateSvgFromReactFlow(
                                nodes as any, // Type assertion needed for React Flow generic
                                edges,
                                {
                                    width: nodesBounds.width + 100,
                                    height: nodesBounds.height + 100,
                                    backgroundColor: graphBackgroundColor,
                                },
                            );

                            const dataUrl = createSvgDataUrl(svgContent);

                            context.saveAsFile({
                                format,
                                fileContents: dataUrl,
                                width: nodesBounds.width + 100,
                                height: nodesBounds.height + 100,
                            });
                        } catch (error) {
                            console.error("Failed to generate SVG:", error);
                            // Fallback to html-to-image if custom export fails
                            void htmlToImage
                                .toSvg(reactFlowContainer, {
                                    width: width,
                                    height: height,
                                    backgroundColor: graphBackgroundColor,
                                    style: {
                                        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                                        width: `${width}px`,
                                        height: `${height}px`,
                                    },
                                })
                                .then((dataUrl) => {
                                    context.saveAsFile({
                                        format,
                                        fileContents: dataUrl,
                                        width,
                                        height,
                                    });
                                });
                        }
                    }, 10); // Small delay to allow UI to update
                } catch (error) {
                    console.error("Failed to initiate SVG export:", error);
                }
                break;
        }
        context.setRenderOnlyVisibleTables(true); // Reset to default state after export
        context.setIsExporting(false);
    }
    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<FluentIcons.ArrowExportUp16Regular />}
                    title={locConstants.schemaDesigner.export}>
                    {locConstants.schemaDesigner.export}
                </Button>
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <MenuItem onClick={() => exportAs("svg")}>
                        {locConstants.schemaDesigner.svg}
                    </MenuItem>
                    <MenuItem onClick={() => exportAs("png")}>
                        {locConstants.schemaDesigner.png}
                    </MenuItem>
                    <MenuItem onClick={() => exportAs("jpeg")}>
                        {locConstants.schemaDesigner.jpeg}
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
