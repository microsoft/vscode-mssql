/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuTrigger,
    MenuButton,
    MenuPopover,
    SearchBox,
    Text,
} from "@fluentui/react-components";
import { List, ListItem } from "@fluentui/react-list-preview";
import * as FluentIcons from "@fluentui/react-icons";

export function FilterTablesButton() {
    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <MenuButton
                    icon={<FluentIcons.Filter16Filled />}
                    size="small"
                    style={{
                        minWidth: "85px",
                    }}
                >
                    Filter
                </MenuButton>
            </MenuTrigger>

            <MenuPopover>
                <SearchBox
                    size="small"
                    placeholder="Search"
                    style={{
                        marginBottom: "10px",
                    }}
                ></SearchBox>
                <List
                    selectionMode="multiselect"
                    style={{
                        maxHeight: "150px",
                        overflowY: "auto",
                    }}
                >
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                    <ListItem>
                        <Text
                            style={{
                                lineHeight: "30px",
                            }}
                        >
                            Table 1
                        </Text>
                    </ListItem>
                </List>
            </MenuPopover>
        </Menu>
    );
}
