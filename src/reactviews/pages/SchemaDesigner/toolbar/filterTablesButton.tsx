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

    const [selectedTables, setSelectedTables] = useState<string[]>([]);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
    const [showTableRelationships, setShowTableRelationships] = useState(false);

    function loadTables() {
        // When loading tables (e.g., when filter button is clicked), we should maintain
        // the current explicitly selected tables, not include related tables as selected
        const nodes = reactFlow.getNodes();
        const allVisible = nodes.filter((node) => node.hidden !== true).length;

        if (allVisible === nodes.length) {
            // All tables are visible, clear the selection
            setSelectedTables([]);
        }
        // If some tables are filtered and relationships toggle is on,
        // preserve the current selectedTables state (don't modify it)
        // Only when all tables are visible should we clear the selection

        setFilterText("");
    }

    function getRelatedTables(selectedTables: string[]): string[] {
        if (!showTableRelationships || selectedTables.length === 0) {
            return [];
        }

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

        if (selectedTables.length === 0) {
            nodes.forEach((node) => {
                reactFlow.updateNode(node.id, {
                    ...node,
                    hidden: false,
                    style: { ...node.style, opacity: 1 },
                });
            });
            edges.forEach((edge) => {
                reactFlow.updateEdge(edge.id, {
                    ...edge,
                    hidden: false,
                });
            });
        } else {
            const relatedTables = getRelatedTables(selectedTables);
            const tablesToShow = [...selectedTables, ...relatedTables];

            nodes.forEach((node) => {
                const tableName = `${node.data.schema}.${node.data.name}`;
                if (tablesToShow.includes(tableName)) {
                    const isSelectedTable = selectedTables.includes(tableName);
                    const isRelatedTable = relatedTables.includes(tableName);

                    // Apply reduced opacity to related tables that are not explicitly selected
                    const opacity = isSelectedTable || !isRelatedTable ? 1 : 0.6;

                    reactFlow.updateNode(node.id, {
                        ...node,
                        hidden: false,
                        style: { ...node.style, opacity },
                    });
                } else {
                    reactFlow.updateNode(node.id, {
                        ...node,
                        hidden: true,
                        style: { ...node.style, opacity: 1 },
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
    }, [selectedTables, showTableRelationships]);

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
                    selectedItems={selectedTables}
                    onSelectionChange={(_e, data) => {
                        setSelectedTables(data.selectedItems as string[]);
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
                        alignItems: "center",
                        padding: "5px",
                        borderTop: "1px solid var(--vscode-editorWidget-border)",
                        borderBottom: "1px solid var(--vscode-editorWidget-border)",
                    }}>
                    <Switch
                        checked={showTableRelationships}
                        label={locConstants.schemaDesigner.showTableRelationships}
                        onChange={() => setShowTableRelationships(!showTableRelationships)}
                    />
                </div>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "5px",
                        justifyContent: "flex-end",
                        paddingTop: "5px",
                    }}>
                    <Button
                        size="small"
                        style={{}}
                        onClick={async () => {
                            setSelectedTables([]);
                            if (context) {
                                context.resetView();
                            }
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
