/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Input,
    Label,
    Menu,
    MenuButton,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Tooltip,
} from "@fluentui/react-components";
import { FilterRegular, Search20Regular } from "@fluentui/react-icons";

const FabricWorkspaceFilter = () => {
    return (
        <>
            <Input
                placeholder="Filter by keyword"
                contentAfter={<Search20Regular aria-label="Filter by keyword" />}
            />
            <Label>Filter</Label>
            <Menu>
                <MenuTrigger>
                    <Tooltip content="Filter by type" relationship="label">
                        <MenuButton icon={<FilterRegular />} />
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItemRadio name="sqlType" value="SQL Analytics Endpoint">
                            SQL Analytics Endpoint
                        </MenuItemRadio>
                        <MenuItemRadio name="sqlType" value="SQL Database">
                            SQL Database
                        </MenuItemRadio>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

export default FabricWorkspaceFilter;
