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
    Button,
} from "@fluentui/react-components";
import { List, ListItem } from "@fluentui/react-list-preview";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";

export function FilterTablesButton() {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const [tableNames, setTableNames] = useState<string[]>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);
    const [filteredTableNames, setFilteredTableNames] = useState<string[]>([]);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

    function loadTables() {
        const schemaDesigner = context?.schemaDesigner;
        if (schemaDesigner) {
            const schema = schemaDesigner.schema;
            if (schema) {
                const tableNames = schema.tables.map(
                    (table) => `${table.schema}.${table.name}`,
                );
                // bring selected tables to the top
                tableNames.sort((a, b) => {
                    const aSelected = selectedTables.includes(a);
                    const bSelected = selectedTables.includes(b);
                    if (aSelected && !bSelected) {
                        return -1;
                    }
                    if (!aSelected && bSelected) {
                        return 1;
                    }
                    return a.localeCompare(b);
                });
                setTableNames(tableNames);
                setFilteredTableNames(tableNames);
            }
        }
    }

    useEffect(() => {}, []);

    return (
        <Menu open={isFilterMenuOpen}>
            <MenuTrigger disableButtonEnhancement>
                <MenuButton
                    icon={<FluentIcons.Filter16Filled />}
                    size="small"
                    style={{
                        minWidth: "85px",
                    }}
                    onClick={() => {
                        loadTables();
                        setIsFilterMenuOpen(!isFilterMenuOpen);
                    }}
                    appearance="subtle"
                >
                    {locConstants.schemaDesigner.filter}
                </MenuButton>
            </MenuTrigger>

            <MenuPopover>
                <SearchBox
                    size="small"
                    placeholder="Search"
                    style={{
                        marginBottom: "10px",
                        width: "100%",
                    }}
                    onChange={(_e, data) => {
                        const searchText = data.value;
                        if (searchText.length === 0) {
                            setFilteredTableNames(tableNames);
                            return;
                        }
                        const filteredNames = tableNames.filter((name) =>
                            name
                                .toLowerCase()
                                .includes(searchText.toLowerCase()),
                        );
                        setFilteredTableNames(filteredNames);
                    }}
                    onAbort={() => {
                        setFilteredTableNames(tableNames);
                        setSelectedTables([]);
                    }}
                ></SearchBox>
                <List
                    selectionMode="multiselect"
                    style={{
                        maxHeight: "150px",
                        overflowY: "auto",
                    }}
                    selectedItems={selectedTables}
                    onSelectionChange={(_e, data) => {
                        setSelectedTables(data.selectedItems as string[]);
                    }}
                >
                    {filteredTableNames.map((tableName) => (
                        <ListItem value={tableName} key={tableName}>
                            <Text
                                style={{
                                    lineHeight: "30px",
                                }}
                            >
                                {tableName}
                            </Text>
                        </ListItem>
                    ))}
                </List>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "5px",
                    }}
                >
                    <Button
                        size="small"
                        style={{
                            flex: "1",
                        }}
                        appearance="primary"
                        onClick={() => {
                            if (context.schemaDesigner) {
                                const selectedTableIds =
                                    context.schemaDesigner.schema.tables
                                        .filter((table) => {
                                            const tableName = `${table.schema}.${table.name}`;
                                            return selectedTables.includes(
                                                tableName,
                                            );
                                        })
                                        .map((table) => table.id);
                                context.schemaDesigner.filterCells(
                                    selectedTableIds,
                                );
                            }
                            setIsFilterMenuOpen(false);
                        }}
                    >
                        {locConstants.schemaDesigner.applyFilter}
                    </Button>
                    <Button
                        size="small"
                        style={{
                            flex: "1",
                        }}
                        onClick={() => {
                            setSelectedTables([]);
                            if (context.schemaDesigner) {
                                context.schemaDesigner.filterCells([]);
                            }
                        }}
                    >
                        {locConstants.schemaDesigner.clearFilter}
                    </Button>
                </div>
            </MenuPopover>
        </Menu>
    );
}
