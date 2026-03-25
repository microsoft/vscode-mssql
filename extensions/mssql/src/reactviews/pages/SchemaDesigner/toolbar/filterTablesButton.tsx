/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Menu,
    MenuTrigger,
    MenuPopover,
    SearchBox,
    Button,
    Switch,
    Tooltip,
    makeStyles,
    Tree,
    TreeItem,
    TreeItemLayout,
} from "@fluentui/react-components";
import { useContext, useEffect, useRef, useState } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { locConstants } from "../../../common/locConstants";
import { Edge, Node, useReactFlow } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { DismissRegular } from "@fluentui/react-icons";
import {
    FilterFunnelIcon16Filled,
    FilterFunnelIcon16Regular,
} from "../../../common/icons/filterFunnel";
import { useIsToolbarCompact } from "./schemaDesignerToolbarContext";

const useStyles = makeStyles({
    container: {
        position: "relative",
        display: "inline-flex",
    },
    badge: {
        position: "absolute",
        right: "-5px",
        top: "0px",
        padding: "0 3px",
        borderRadius: "7px",
        border: "1px solid var(--vscode-panel-background)",
        boxSizing: "border-box",
        pointerEvents: "none",
    },
    treeDiv: {
        maxHeight: "300px",
        overflowY: "auto",
    },
});

export function FilterTablesButton() {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const reactFlow = useReactFlow();
    const isCompact = useIsToolbarCompact();
    const initialFilterTables = useSchemaDesignerSelector((s) => s?.initialFilterTables);
    if (!context) {
        return undefined;
    }

    const [filterText, setFilterText] = useState("");

    const [selectedTables, setSelectedTables] = useState<string[]>([]);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
    const [showTableRelationships, setShowTableRelationships] = useState(false);
    const [openItems, setOpenItems] = useState<string[] | undefined>(undefined);
    const [checkedItems, setCheckedItems] = useState<string[]>([]);
    const filterLabel = locConstants.schemaDesigner.filter(selectedTables.length);
    const initialFilterConsumedRef = useRef(false);
    const initialFilterJustAppliedRef = useRef(false);

    useEffect(() => {
        const nodes = reactFlow.getNodes();
        if (!openItems && nodes.length > 0) {
            const schemas = Array.from(new Set(nodes.map((node) => `${node.data.schema}`)));
            setOpenItems(schemas);
        }
    }, [reactFlow.getNodes()]);

    function loadTables() {
        // When an initial filter from the extension host is pending (e.g., navigating
        // from Table Explorer), skip normal table loading so we don't clear the filter
        // that will be applied by the initialFilterTables effect.
        if (
            initialFilterTables &&
            initialFilterTables.length > 0 &&
            !initialFilterConsumedRef.current
        ) {
            setFilterText("");
            return;
        }

        // When the initial filter was just applied in the same animation frame,
        // skip normal loading to prevent clearing the filter before React
        // re-renders and applies the node visibility changes.
        if (initialFilterJustAppliedRef.current) {
            initialFilterJustAppliedRef.current = false;
            setFilterText("");
            return;
        }

        // When loading tables (e.g., when filter button is clicked), we should maintain
        // the current explicitly selected tables, not include related tables as selected
        const nodes = reactFlow.getNodes();
        const allVisible = nodes.filter((node) => node.hidden !== true).length;

        if (allVisible === nodes.length) {
            // All tables are visible, clear the selection
            setSelectedTables([]);
        } else {
            const visibleTables = nodes
                .filter((node) => !node.hidden && node.data.dimmed !== true)
                .map((node) => `${node.data.schema}.${node.data.name}`);
            setSelectedTables(visibleTables);
        }
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

    const handleCheckedChange = (
        checkedValue: string,
        checked: boolean,
        schemas: string[],
        tablesBySchema: Record<string, string[]>,
    ) => {
        const isSchema = schemas.includes(checkedValue);
        let updatedCheckedItems = [...checkedItems];
        let updatedSelectedTables = [...selectedTables];

        if (checked) {
            updatedCheckedItems.push(checkedValue);
            if (isSchema) {
                // if it's a schema, add all tables under that schema to selected tables
                const tablesToAdd = tablesBySchema[checkedValue].map(
                    (table) => `${checkedValue}.${table}`,
                );
                for (const table of tablesToAdd) {
                    if (!updatedSelectedTables.includes(table)) {
                        updatedSelectedTables.push(table);
                    }
                    if (!updatedCheckedItems.includes(table)) {
                        updatedCheckedItems.push(table);
                    }
                }
            } else {
                // if it's a table, just add that table to selected tables
                if (!updatedSelectedTables.includes(checkedValue)) {
                    updatedSelectedTables.push(checkedValue);
                }
                const tableSchema = checkedValue.split(".")[0];
                // if all the tables under the same schema are checked, also check the schema
                const allTablesChecked = tablesBySchema[tableSchema].every((table) =>
                    updatedCheckedItems.includes(`${tableSchema}.${table}`),
                );
                if (allTablesChecked) {
                    updatedCheckedItems.push(tableSchema);
                }
            }
        } else {
            updatedCheckedItems = updatedCheckedItems.filter((item) => item !== checkedValue);
            if (isSchema) {
                // if it's a schema, remove all tables under that schema from selected tables
                const tablesToRemove = tablesBySchema[checkedValue].map(
                    (table) => `${checkedValue}.${table}`,
                );
                updatedSelectedTables = updatedSelectedTables.filter(
                    (table) => !tablesToRemove.includes(table),
                );
                updatedCheckedItems = updatedCheckedItems.filter(
                    (item) => item !== checkedValue && !tablesToRemove.includes(item),
                );
            } else {
                // if it's a table, just remove that table from selected tables
                updatedSelectedTables = updatedSelectedTables.filter(
                    (table) => table !== checkedValue,
                );
                const tableSchema = checkedValue.split(".")[0];
                // if the table's schema is checked, remove that
                updatedCheckedItems = updatedCheckedItems.filter((item) => item !== tableSchema);
            }
        }
        setCheckedItems(updatedCheckedItems);
        setSelectedTables(updatedSelectedTables);
        context.resetView();
    };

    function renderTree(): JSX.Element {
        const nodes = reactFlow.getNodes();
        const lowerFilterText = filterText.toLowerCase();
        const tablesBySchema = nodes.reduce(
            (acc, node) => {
                const schema = `${node.data.schema}`;
                const table = `${node.data.name}`;

                const schemaMatches = schema.toLowerCase().includes(lowerFilterText);
                const tableMatches = table.toLowerCase().includes(lowerFilterText);

                if (!filterText || schemaMatches || tableMatches) {
                    // No filter or matches: include everything
                    if (!acc[schema]) acc[schema] = [];
                    acc[schema].push(table);
                }
                return acc;
            },
            {} as Record<string, string[]>,
        );

        const schemas = Object.keys(tablesBySchema);

        // sort tables inside each schema
        schemas.forEach((schema) => {
            tablesBySchema[schema].sort();
        });

        return (
            <Tree
                className={classes.treeDiv}
                openItems={openItems}
                checkedItems={checkedItems}
                selectionMode="multiselect"
                onCheckedChange={(_event, data) => {
                    handleCheckedChange(
                        data.value.toString(),
                        data.checked as boolean,
                        schemas,
                        tablesBySchema,
                    );
                }}>
                {Object.entries(tablesBySchema).map(([schema, tables]) => (
                    <TreeItem
                        key={schema}
                        value={schema}
                        itemType="branch"
                        onOpenChange={(_event, data) => {
                            const isOpening = data.open;
                            if (isOpening) {
                                setOpenItems([...(openItems ?? []), data.value.toString()]);
                            } else {
                                setOpenItems(
                                    openItems?.filter((item) => item !== data.value.toString()) ??
                                        [],
                                );
                            }
                        }}>
                        <TreeItemLayout>{highlightText(schema, filterText)}</TreeItemLayout>
                        <Tree>
                            {tables.map((table) => (
                                <TreeItem
                                    key={`${schema}.${table}`}
                                    value={`${schema}.${table}`}
                                    itemType="leaf">
                                    <TreeItemLayout>
                                        {highlightText(table, filterText)}
                                    </TreeItemLayout>
                                </TreeItem>
                            ))}
                        </Tree>
                    </TreeItem>
                ))}
            </Tree>
        );
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
    }, [selectedTables, showTableRelationships]);

    useEffect(() => {
        const rafId = requestAnimationFrame(() => {
            loadTables();
        });

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [context.schemaRevision]);

    // Apply initial filter tables from extension host (e.g., when navigating from Table Explorer).
    // Uses requestAnimationFrame polling because when isInitialized becomes true, the nodes
    // may not yet be set on the ReactFlow instance (they're set by the caller after init).
    // The initialFilterConsumedRef prevents loadTables() from clearing the filter before
    // this effect has a chance to apply it.
    useEffect(() => {
        if (!initialFilterTables || initialFilterTables.length === 0 || !context.isInitialized) {
            return;
        }

        // Reset consumed flag so loadTables() defers to this effect
        initialFilterConsumedRef.current = false;

        let cancelled = false;
        let retries = 0;
        const MAX_RETRIES = 300;
        const applyFilter = () => {
            if (cancelled) {
                return;
            }
            const nodes = reactFlow.getNodes();
            if (nodes.length > 0) {
                initialFilterConsumedRef.current = true;
                initialFilterJustAppliedRef.current = true;
                setSelectedTables([...initialFilterTables]);
                setShowTableRelationships(true);
                context.resetView();
            } else if (retries < MAX_RETRIES) {
                retries++;
                requestAnimationFrame(applyFilter);
            } else {
                // Max retries reached; mark filter as consumed so loadTables() can proceed
                initialFilterConsumedRef.current = true;
            }
        };
        requestAnimationFrame(applyFilter);

        return () => {
            cancelled = true;
        };
    }, [initialFilterTables, context.isInitialized]);

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

    return (
        <Menu open={isFilterMenuOpen} onOpenChange={(_, data) => setIsFilterMenuOpen(data.open)}>
            <MenuTrigger>
                <span className={classes.container}>
                    <Tooltip content={filterLabel} relationship="label">
                        <Button
                            appearance="subtle"
                            size="small"
                            aria-label={filterLabel}
                            icon={
                                selectedTables.length > 0 ? (
                                    <FilterFunnelIcon16Filled />
                                ) : (
                                    <FilterFunnelIcon16Regular />
                                )
                            }
                            onClick={() => {
                                loadTables();
                                setIsFilterMenuOpen(!isFilterMenuOpen);
                            }}>
                            {!isCompact && locConstants.schemaDesigner.filter(0)}
                        </Button>
                    </Tooltip>
                    {selectedTables.length > 0 && (
                        <Badge size="small" className={classes.badge}>
                            {selectedTables.length}
                        </Badge>
                    )}
                </span>
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
                {renderTree()}
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
                            setSelectedTables([]);
                            if (context) {
                                context.resetView();
                            }
                        }}
                        appearance="subtle"
                        icon={<DismissRegular />}>
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
