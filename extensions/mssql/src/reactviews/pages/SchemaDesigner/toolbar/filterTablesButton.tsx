/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuTrigger,
    MenuPopover,
    SearchBox,
    Button,
    Switch,
    makeStyles,
    TreeItemLayout,
    HeadlessFlatTreeItemProps,
    useHeadlessFlatTree_unstable,
    Text,
    FlatTree,
    FlatTreeItem,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import { Edge, Node, useReactFlow } from "@xyflow/react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const useStyles = makeStyles({
    menu: {
        width: "250px",
        padding: "10px",
    },
    searchBox: {
        marginBottom: "10px",
        width: "100%",
    },
    list: {
        maxHeight: "150px",
        overflowY: "auto",
        padding: "5px",
    },
    highlightedText: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
        color: "var(--vscode-editor-background)",
        padding: "0 2px",
        borderRadius: "3px",
    },
    schemaItem: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "5px",
    },
    tableItem: {
        padding: "5px",
        marginLeft: "30px",
    },
    chevronButton: {
        padding: 0,
        height: "auto",
        minWidth: "auto",
        border: "none",
        backgroundColor: "transparent",
        boxShadow: "none",
    },
    clearAll: {
        display: "flex",
        flexDirection: "row",
        gap: "5px",
        justifyContent: "flex-end",
        padding: "5px",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
    },
    showTableRelationships: {
        display: "flex",
        flexDirection: "row",
        gap: "5px",
        alignItems: "center",
        paddingTop: "5px",
    },
});

export function FilterTablesButton() {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const reactFlow = useReactFlow();
    if (!context) {
        return undefined;
    }

    const [filterText, setFilterText] = useState("");

    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
    const [showTableRelationships, setShowTableRelationships] = useState(false);

    type CustomTreeItem = HeadlessFlatTreeItemProps & { content: string };

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
                        <span key={index} className={classes.highlightedText}>
                            {part}
                        </span>
                    ) : (
                        <span key={index}>{part}</span>
                    );
                })}
            </>
        );
    };

    function renderTreeItems() {
        const nodes = reactFlow.getNodes();
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

        console.log(JSON.stringify(schemaTables, null, 2));

        const items: CustomTreeItem[] = [];
        const defaultOpenSchemas: string[] = [];

        Object.keys(schemaTables)
            .sort()
            .forEach((schema) => {
                const tableInSchemaIncludesFilter =
                    filterText &&
                    schemaTables[schema].some((table) =>
                        table.toLowerCase().includes(filterText.toLowerCase()),
                    );

                // Only show schema if its name or children match filter
                if (
                    !filterText ||
                    schema.toLowerCase().includes(filterText.toLowerCase()) ||
                    tableInSchemaIncludesFilter
                ) {
                    items.push({ value: schema, content: schema });
                    defaultOpenSchemas.push(schema);
                }

                schemaTables[schema].forEach((table) => {
                    // Only show table if its name matches filter
                    if (!filterText || table.toLowerCase().includes(filterText.toLowerCase())) {
                        items.push({
                            value: `${schema}.${table}`,
                            parentValue: schema,
                            content: table, // add highlight text here
                        });
                    }
                });
            });

        const flatTree = useHeadlessFlatTree_unstable(items, {
            defaultOpenItems: defaultOpenSchemas,
            selectionMode: "multiselect",
        });

        return flatTree;
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
                className={classes.menu}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setIsFilterMenuOpen(false);
                    }
                }}>
                <SearchBox
                    size="small"
                    placeholder={locConstants.schemaDesigner.searchTables}
                    value={filterText}
                    onChange={(_e, data) => {
                        setFilterText(data.value);
                    }}
                    onAbort={() => {
                        setFilterText("");
                    }}
                />
                {(() => {
                    const flatTree = renderTreeItems();
                    return (
                        <FlatTree
                            {...flatTree.getTreeProps()}
                            checkedItems={selectedItems}
                            onCheckedChange={(_e, data) => {
                                const { value, checked } = data;
                                const itemValue = value.toString();

                                const isSelection = checked;
                                const changedItem = itemValue;

                                const tableNames = reactFlow
                                    .getNodes()
                                    .map((node) => `${node.data.schema}.${node.data.name}`);

                                let updatedSelectedItems = [...selectedItems];

                                if (isSelection) {
                                    updatedSelectedItems.push(changedItem);
                                } else {
                                    updatedSelectedItems = updatedSelectedItems.filter(
                                        (item) => item !== changedItem,
                                    );
                                }

                                // Schema is toggled
                                if (!changedItem.includes(".")) {
                                    if (isSelection) {
                                        // Add all tables under schema
                                        const schemaTables = tableNames.filter((t) =>
                                            t.startsWith(`${changedItem}.`),
                                        );
                                        updatedSelectedItems = Array.from(
                                            new Set([...updatedSelectedItems, ...schemaTables]),
                                        );
                                    } else {
                                        // Remove schema + all tables
                                        updatedSelectedItems = updatedSelectedItems.filter(
                                            (t) =>
                                                !t.startsWith(`${changedItem}.`) &&
                                                t !== changedItem,
                                        );
                                    }
                                }

                                // Table is toggled
                                else {
                                    const schema = changedItem.split(".")[0];

                                    if (isSelection) {
                                        // If ALL tables in schema are selected → automatically select schema
                                        const allTablesInSchema = tableNames.filter((t) =>
                                            t.startsWith(`${schema}.`),
                                        );
                                        const selectedTables = updatedSelectedItems.filter((t) =>
                                            t.startsWith(`${schema}.`),
                                        );

                                        if (allTablesInSchema.length === selectedTables.length) {
                                            if (!updatedSelectedItems.includes(schema)) {
                                                updatedSelectedItems.push(schema);
                                            }
                                        }
                                    } else {
                                        // If table is deselected, remove schema selection
                                        updatedSelectedItems = updatedSelectedItems.filter(
                                            (item) => item !== schema,
                                        );
                                    }
                                }

                                setSelectedItems(updatedSelectedItems);

                                if (context) {
                                    context.resetView();
                                }
                            }}>
                            {Array.from(flatTree.items(), (flatTreeItem) => {
                                const { content, ...treeItemProps } =
                                    flatTreeItem.getTreeItemProps();
                                return (
                                    <FlatTreeItem {...treeItemProps} key={flatTreeItem.value}>
                                        <TreeItemLayout>
                                            <Text>{highlightText(content, filterText)}</Text>
                                        </TreeItemLayout>
                                    </FlatTreeItem>
                                );
                            })}
                        </FlatTree>
                    );
                })()}
                <div className={classes.clearAll}>
                    <Button
                        size="small"
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
                <div className={classes.showTableRelationships}>
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
