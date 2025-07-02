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
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import { Edge, Node, useReactFlow } from "@xyflow/react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesigner } from "../../../../shared/schemaDesigner";

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
        // Update the selected tables based on the current nodes
        const nodes = reactFlow.getNodes();
        const tableNames = nodes
            .filter((node) => node.hidden !== true)
            .map((node) => `${node.data.schema}.${node.data.name}`);
        if (nodes.length === tableNames.length) {
            setSelectedTables([]);
        } else {
            setSelectedTables(tableNames);
        }
        setFilterText("");
    }

    useEffect(() => {
        const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        const edges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
        if (selectedTables.length === 0) {
            nodes.forEach((node) => {
                reactFlow.updateNode(node.id, {
                    ...node,
                    hidden: false,
                });
            });
            edges.forEach((edge) => {
                reactFlow.updateEdge(edge.id, {
                    ...edge,
                    hidden: false,
                });
            });
        } else {
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
            edges.forEach((edge) => {
                const sourceNode = reactFlow.getNode(edge.source);
                const targetNode = reactFlow.getNode(edge.target);
                if (
                    sourceNode &&
                    targetNode &&
                    selectedTables.includes(`${sourceNode.data.schema}.${sourceNode.data.name}`) &&
                    selectedTables.includes(`${targetNode.data.schema}.${targetNode.data.name}`)
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
    }, [selectedTables]);

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
                        context.resetView();
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
                        onClick={async () => {
                            setSelectedTables([]);
                            context.resetView();
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
