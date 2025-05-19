/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuTrigger,
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
import { Edge, Node, useReactFlow } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { flowUtils } from "../schemaDesignerUtils";

export function FilterTablesButton() {
    const context = useContext(SchemaDesignerContext);
    const reactFlow = useReactFlow();
    if (!context) {
        return undefined;
    }

    const [tableNames, setTableNames] = useState<string[]>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);
    const [filteredTableNames, setFilteredTableNames] = useState<string[]>([]);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

    function loadTables() {
        const schema = flowUtils.extractSchemaModel(
            reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
        );

        if (!schema) {
            return;
        }
        const tableNames = schema.tables.map((table) => `${table.schema}.${table.name}`);
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

    useEffect(() => {
        const nodes = reactFlow.getNodes();
        if (selectedTables.length === 0) {
            nodes.forEach((node) => {
                reactFlow.updateNode(node.id, {
                    ...node,
                    hidden: false,
                });
            });
            return;
        }
        nodes.forEach((node) => {
            const tableName = `${node.data.schema}.${node.data.name}`;
            if (selectedTables.includes(tableName)) {
                reactFlow.updateNode(node.id, {
                    ...node,
                    hidden: false,
                });
            } else {
                reactFlow.updateNode(node.id, {
                    ...node,
                    hidden: true,
                });
            }
        });
    }, [selectedTables]);

    return (
        <Menu open={isFilterMenuOpen} onOpenChange={(_, data) => setIsFilterMenuOpen(data.open)}>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    icon={<FluentIcons.Filter16Regular />}
                    onClick={() => {
                        loadTables();
                        setIsFilterMenuOpen(!isFilterMenuOpen);
                    }}
                    appearance="subtle">
                    {locConstants.schemaDesigner.filter}
                </Button>
            </MenuTrigger>

            <MenuPopover
                style={{
                    width: "250px",
                    padding: "10px",
                }}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setIsFilterMenuOpen(false);
                    }
                }}>
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
                            name.toLowerCase().includes(searchText.toLowerCase()),
                        );
                        setFilteredTableNames(filteredNames);
                    }}
                    onAbort={() => {
                        setFilteredTableNames(tableNames);
                        setSelectedTables([]);
                    }}></SearchBox>
                <List
                    selectionMode="multiselect"
                    style={{
                        maxHeight: "150px",
                        overflowY: "auto",
                        padding: "5px",
                    }}
                    selectedItems={selectedTables}
                    onSelectionChange={(_e, data) => {
                        setSelectedTables(data.selectedItems as string[]);
                    }}>
                    {filteredTableNames.map((tableName) => (
                        <ListItem value={tableName} key={tableName}>
                            <Text
                                style={{
                                    lineHeight: "30px",
                                }}>
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
                        justifyContent: "flex-end",
                    }}>
                    <Button
                        size="small"
                        style={{}}
                        onClick={() => {
                            setSelectedTables([]);
                        }}
                        appearance="subtle"
                        icon={<FluentIcons.DismissRegular />}>
                        {locConstants.schemaDesigner.clearFilter}
                    </Button>
                </div>
            </MenuPopover>
        </Menu>
    );
}
