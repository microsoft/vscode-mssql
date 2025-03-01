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

export function ExportDiagramButton() {
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
                    Export
                </MenuButton>
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <MenuItem>SVG</MenuItem>
                    <MenuItem>PNG</MenuItem>
                    <MenuItem>JPG</MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
