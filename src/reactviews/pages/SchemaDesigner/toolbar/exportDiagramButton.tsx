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

export function ExportDiagramButton() {
    const { getNodes } = useReactFlow();
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
                break;
        }
        context.setRenderOnlyVisibleTables(true); // Reset to default state after export
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
