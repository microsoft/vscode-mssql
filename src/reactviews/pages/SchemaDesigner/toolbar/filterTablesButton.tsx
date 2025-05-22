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

    const [filterText, setFilterText] = useState("");

    const [selectedTables, setSelectedTables] = useState<string[]>([]);
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

    // Function to highlight text based on search
    const highlightText = (text: string, searchText: string) => {
        if (!searchText || searchText.trim() === "") {
            return <span>{text}</span>;
        }

        // Case insensitive search
        const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        const parts = text.split(regex);

        return (
            <>
                {parts.map((part, index) => {
                    // Check if this part matches the search text (case insensitive)
                    const isMatch = part.toLowerCase() === searchText.toLowerCase();
                    return isMatch ? (
                        <span
                            key={index}
                            style={{
                                backgroundColor: "var(--vscode-editor-findMatchBackground)",
                                color: "var(--vscode-editor-background)",
                                padding: "0 2px",
                                borderRadius: "3px",
                            }}>
                            {part}
                        </span>
                    ) : (
                        <span key={index}>{part}</span>
                    );
                })}
            </>
        );
    };

    function renderListItems() {
        const nodes = reactFlow.getNodes();
        const tableNames = nodes.map((node) => `${node.data.schema}.${node.data.name}`);
        tableNames.sort();

        const items: JSX.Element[] = [];
        tableNames.forEach((tableName) => {
            const tableItem = (
                <ListItem
                    style={{
                        lineHeight: "30px",
                        alignItems: "center",
                        padding: "2px",
                    }}
                    value={tableName}
                    key={tableName}>
                    <Text>{highlightText(tableName, filterText)}</Text>
                </ListItem>
            );
            if (!filterText) {
                items.push(tableItem);
            } else if (tableName.toLowerCase().includes(filterText.toLowerCase())) {
                items.push(tableItem);
            }
        });
        return items;
    }

    return (
        <Menu open={isFilterMenuOpen} onOpenChange={(_, data) => setIsFilterMenuOpen(data.open)}>
            <MenuTrigger>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<FluentIcons.Filter16Regular />}
                    onClick={() => {
                        loadTables();
                        setIsFilterMenuOpen(!isFilterMenuOpen);
                    }}>
                    {locConstants.schemaDesigner.filter(selectedTables.length)}
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
                    value={filterText}
                    onChange={(_e, data) => {
                        setFilterText(data.value);
                    }}
                    onAbort={() => {
                        setFilterText("");
                    }}
                />
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
                    {renderListItems()}
                </List>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "5px",
                        justifyContent: "flex-end",
                        borderTop: "1px solid var(--vscode-editorWidget-border)",
                        paddingTop: "5px",
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
