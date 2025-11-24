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
    ListItem,
    List,
    Switch,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import { Edge, Node, useReactFlow } from "@xyflow/react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export function FilterTablesButton() {
    const context = useContext(SchemaDesignerContext);
    const reactFlow = useReactFlow();
    if (!context) {
        return undefined;
    }

    const [filterText, setFilterText] = useState("");

    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
    const [showTableRelationships, setShowTableRelationships] = useState(false);

    function loadTables() {
        // When loading tables (e.g., when filter button is clicked), we should maintain
        // the current explicitly selected tables, not include related tables as selected
        const nodes = reactFlow.getNodes();
        const allVisible = nodes.filter((node) => node.hidden !== true).length;

        if (allVisible === nodes.length) {
            // All tables are visible, clear the selection
            setSelectedItems([]);
        } else {
            const visibleTables = nodes
                .filter((node) => !node.hidden && node.data.dimmed !== true)
                .map((node) => `${node.data.schema}.${node.data.name}`);
            setSelectedItems(visibleTables);
        }
        setFilterText("");
    }

    function getRelatedTables(selectedItems: string[]): string[] {
        if (!showTableRelationships || selectedItems.length === 0) {
            return [];
        }
        const selectedTables = selectedItems.filter((item) => item.includes("."));

        const edges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
        const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        const relatedTables = new Set<string>();

        edges.forEach((edge) => {
            const sourceNode = nodes.find((node) => node.id === edge.source);
            const targetNode = nodes.find((node) => node.id === edge.target);

            if (sourceNode && targetNode) {
                const sourceTableName = `${sourceNode.data.schema}.${sourceNode.data.name}`;
                const targetTableName = `${targetNode.data.schema}.${targetNode.data.name}`;

                // If source table is selected, add target table to related tables
                if (selectedTables.includes(sourceTableName)) {
                    relatedTables.add(targetTableName);
                }
                // If target table is selected, add source table to related tables
                if (selectedTables.includes(targetTableName)) {
                    relatedTables.add(sourceTableName);
                }
            }
        });

        return Array.from(relatedTables);
    }

    useEffect(() => {
        const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        const edges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];

        if (selectedItems.length === 0) {
            nodes.forEach((node) => {
                reactFlow.updateNode(node.id, {
                    ...node,
                    hidden: false,
                    style: { ...node.style, opacity: 1 },
                    data: {
                        ...node.data,
                        dimmed: false,
                    },
                });
            });
            edges.forEach((edge) => {
                reactFlow.updateEdge(edge.id, {
                    ...edge,
                    hidden: false,
                });
            });
        } else {
            const selectedTables = selectedItems.filter((item) => item.includes("."));
            const relatedTables = getRelatedTables(selectedTables);
            const tablesToShow = [...selectedTables, ...relatedTables];

            nodes.forEach((node) => {
                const tableName = `${node.data.schema}.${node.data.name}`;
                if (tablesToShow.includes(tableName)) {
                    const isSelectedTable = selectedTables.includes(tableName);
                    const isRelatedTable = relatedTables.includes(tableName);

                    const dimmed = !isSelectedTable && isRelatedTable;

                    reactFlow.updateNode(node.id, {
                        ...node,
                        hidden: false,
                        data: {
                            ...node.data,
                            dimmed,
                        },
                    });
                } else {
                    reactFlow.updateNode(node.id, {
                        ...node,
                        hidden: true,
                        data: { ...node.data, dimmed: false },
                    });
                }
            });

            edges.forEach((edge) => {
                const sourceNode = reactFlow.getNode(edge.source);
                const targetNode = reactFlow.getNode(edge.target);
                if (
                    sourceNode &&
                    targetNode &&
                    tablesToShow.includes(`${sourceNode.data.schema}.${sourceNode.data.name}`) &&
                    tablesToShow.includes(`${targetNode.data.schema}.${targetNode.data.name}`)
                ) {
                    reactFlow.updateEdge(edge.id, {
                        ...edge,
                        hidden: false,
                    });
                } else {
                    reactFlow.updateEdge(edge.id, {
                        ...edge,
                        hidden: true,
                    });
                }
            });
        }
    }, [selectedItems, showTableRelationships]);

    useEffect(() => {
        eventBus.on("getScript", () =>
            requestAnimationFrame(() => {
                loadTables();
            }),
        );
    }, []);

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
        // make a data structure that for each schema has a list of tables in sorted order
        const schemaTables = nodes.reduce(
            (acc, node) => {
                const schema = `${node.data.schema}`;
                const table = `${node.data.name}`;

                if (!acc[schema]) acc[schema] = [];

                acc[schema].push(table);
                return acc;
            },
            {} as Record<string, string[]>,
        );

        // sort tables inside each schema
        Object.keys(schemaTables).forEach((schema) => {
            schemaTables[schema].sort();
        });

        const items: JSX.Element[] = [];

        Object.keys(schemaTables)
            .sort()
            .forEach((schema) => {
                // Render schema as a top-level item
                const schemaItem = (
                    <ListItem
                        style={{
                            fontWeight: 600,
                            padding: "2px",
                            lineHeight: "30px",
                        }}
                        value={schema}
                        key={schema}>
                        <Text>{schema}</Text>
                    </ListItem>
                );

                // Filter: schemas only shown if filter matches OR filter is empty
                if (!filterText || schema.toLowerCase().includes(filterText.toLowerCase())) {
                    items.push(schemaItem);
                }

                // Render each table under the schema (indented)
                schemaTables[schema].forEach((table) => {
                    const fullName = `${schema}.${table}`;

                    const matchesFilter =
                        !filterText || table.toLowerCase().includes(filterText.toLowerCase());

                    if (!matchesFilter) return;

                    items.push(
                        <ListItem
                            style={{
                                lineHeight: "30px",
                                padding: "2px",
                                paddingLeft: "20px", // <-- INDENT CHILD TABLES
                                overflow: "hidden",
                            }}
                            value={fullName}
                            key={fullName}>
                            <Text
                                title={table}
                                style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}>
                                {highlightText(table, filterText)}
                            </Text>
                        </ListItem>,
                    );
                });
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
                    {locConstants.schemaDesigner.filter(selectedItems.length)}
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
                    placeholder={locConstants.schemaDesigner.searchTables}
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
                    selectedItems={selectedItems}
                    onSelectionChange={(_e, data) => {
                        const isSelection = data.selectedItems.length > selectedItems.length;
                        const currentSelectedItems = data.selectedItems.map(String);
                        const changedItem = [
                            ...currentSelectedItems.filter((item) => !selectedItems.includes(item)),
                            ...selectedItems.filter((item) => !currentSelectedItems.includes(item)),
                        ][0];

                        const tableNames = reactFlow
                            .getNodes()
                            .map((node) => `${node.data.schema}.${node.data.name}`);
                        // If the changed item is a schema, select/deselect all its tables
                        let updatedSelectedItems = currentSelectedItems;
                        if (!changedItem.includes(".")) {
                            if (isSelection) {
                                // Selecting a schema: add all its tables
                                updatedSelectedItems = [
                                    ...tableNames.filter((tableName) =>
                                        tableName.startsWith(`${changedItem}.`),
                                    ),
                                    ...updatedSelectedItems,
                                ];
                            } else {
                                // Deselecting a schema: remove all its tables
                                updatedSelectedItems = currentSelectedItems.filter(
                                    (tableName) => !tableName.startsWith(`${changedItem}.`),
                                );
                            }
                        } else {
                            const schema = changedItem.split(".")[0];

                            if (isSelection) {
                                // if all tables in the schema are selected, add the overall schema
                                const allTablesInSchema = tableNames.filter((tableName) =>
                                    tableName.startsWith(`${schema}.`),
                                );
                                console.log("All tables in schema:", allTablesInSchema);
                                const currentSelectedTablesInSchema = updatedSelectedItems.filter(
                                    (item) => item.startsWith(`${schema}.`),
                                );
                                console.log(
                                    "Current selected tables in schema:",
                                    currentSelectedTablesInSchema,
                                );
                                if (
                                    allTablesInSchema.length ===
                                    currentSelectedTablesInSchema.length
                                ) {
                                    updatedSelectedItems.push(schema);
                                }
                            } else {
                                // remove schema from current selected items
                                updatedSelectedItems = currentSelectedItems.filter(
                                    (item) => item !== schema,
                                );
                            }
                        }
                        console.log(
                            "Updated selected items before setting state:",
                            updatedSelectedItems,
                        );
                        setSelectedItems(updatedSelectedItems);
                        if (context) {
                            context.resetView();
                        }
                    }}>
                    {renderListItems()}
                </List>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "5px",
                        justifyContent: "flex-end",
                        padding: "5px",
                        borderTop: "1px solid var(--vscode-editorWidget-border)",
                        borderBottom: "1px solid var(--vscode-editorWidget-border)",
                    }}>
                    <Button
                        size="small"
                        style={{}}
                        onClick={async () => {
                            setSelectedItems([]);
                            if (context) {
                                context.resetView();
                            }
                        }}
                        appearance="subtle"
                        icon={<FluentIcons.DismissRegular />}>
                        {locConstants.schemaDesigner.clearFilter}
                    </Button>
                </div>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "5px",
                        alignItems: "center",
                        paddingTop: "5px",
                    }}>
                    <Switch
                        checked={showTableRelationships}
                        label={locConstants.schemaDesigner.showTableRelationships}
                        onChange={() => setShowTableRelationships(!showTableRelationships)}
                    />
                </div>
            </MenuPopover>
        </Menu>
    );
}
