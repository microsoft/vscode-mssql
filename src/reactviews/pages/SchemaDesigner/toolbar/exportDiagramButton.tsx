/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";

export function ExportDiagramButton() {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }
    async function exportAs(format: "svg" | "png" | "jpeg") {
        if (!context?.schemaDesigner) {
            return;
        }
        const imageContent = await context.schemaDesigner.exportImage(format);
        console.log(imageContent);
        if (imageContent && context) {
            context.saveAsFile({
                format,
                fileContents: imageContent.fileContent,
                width: imageContent.width,
                height: imageContent.height,
            });
            return;
        }
    }
    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <MenuButton
                    icon={<FluentIcons.ArrowExportUp16Filled />}
                    size="small"
                    style={{
                        minWidth: "95px",
                    }}
                >
                    {locConstants.schemaDesigner.export}
                </MenuButton>
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <MenuItem onClick={() => exportAs("svg")}>SVG</MenuItem>
                    <MenuItem onClick={() => exportAs("png")}>PNG</MenuItem>
                    <MenuItem onClick={() => exportAs("jpeg")}>JPEG</MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
