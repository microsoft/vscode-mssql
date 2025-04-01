/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    ToolbarButton,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import * as htmlToImage from "html-to-image";
import { getNodesBounds, useReactFlow } from "@xyflow/react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";

export function ExportDiagramButton() {
    const { getNodes } = useReactFlow();
    const context = useContext(SchemaDesignerContext);

    async function exportAs(format: "svg" | "png" | "jpeg") {
        const reactFlowContainer = document.querySelector(".react-flow__viewport") as HTMLElement;
        const computedStyle = getComputedStyle(reactFlowContainer);
        const graphBackgroundColor = computedStyle.getPropertyValue("--vscode-editor-background");

        const nodesBounds = getNodesBounds(getNodes());

        const width = nodesBounds.width + 20;
        const height = nodesBounds.height + 20;

        switch (format) {
            case "png":
                void htmlToImage
                    .toPng(reactFlowContainer, {
                        width: width,
                        height: height,
                        backgroundColor: graphBackgroundColor,
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
    }
    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <ToolbarButton
                    icon={<FluentIcons.ArrowExportUp16Filled />}
                    title={locConstants.schemaDesigner.export}
                    appearance="subtle">
                    {locConstants.schemaDesigner.export}
                </ToolbarButton>
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
