/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Input,
    makeStyles,
    mergeClasses,
    Text,
    FlatTree,
    TreeItem,
    TreeItemLayout,
    TreeItemValue,
    useHeadlessFlatTree_unstable,
    HeadlessFlatTreeItemProps,
    Toolbar,
    ToolbarButton,
    Tooltip,
    CounterBadge,
    Dropdown,
    Option,
    Popover,
    PopoverTrigger,
    PopoverSurface,
    Field,
} from "@fluentui/react-components";
import {
    Dismiss12Regular,
    Search16Regular,
    CheckmarkCircle24Regular,
    Eye16Regular,
    ArrowUndo16Regular,
    Filter16Regular,
} from "@fluentui/react-icons";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import eventBus from "./schemaDesignerEvents";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { locConstants } from "../../common/locConstants";
import { ChangeAction, ChangeCategory, SchemaChange, TableChangeGroup } from "./diff/diffUtils";
import { describeChange } from "./diff/schemaDiff";
import { PendingChangesIcon16 } from "../../common/icons/fluentIcons";

const DEFAULT_PANEL_SIZE = 25;
const MIN_PANEL_SIZE = 10;
const ALL_FILTER = "all" as const;

interface FlatTreeItem extends HeadlessFlatTreeItemProps {
    nodeType: "table" | "change";
    tableGroup?: TableChangeGroup;
    change?: SchemaChange;
    tableId: string;
    content: string;
}

const useStyles = makeStyles({
    container: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
        minHeight: 0,
        overflow: "hidden",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        flexShrink: 0,
    },
    searchContainer: {
        padding: "8px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        flexShrink: 0,
    },
    searchRow: {
        display: "flex",
        gap: "4px",
        alignItems: "center",
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
    },
    filterButton: {
        flexShrink: 0,
    },
    filterButtonActive: {
        color: "var(--vscode-textLink-foreground)",
    },
    filterPopover: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "4px",
        minWidth: "200px",
    },
    filterDropdown: {
        width: "100%",
    },
    treeContainer: {
        flex: 1,
        overflow: "auto",
        minHeight: 0,
    },
    empty: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        opacity: 0.7,
        padding: "20px",
    },
    emptyIcon: {
        fontSize: "32px",
        color: "var(--vscode-descriptionForeground)",
    },
    emptyText: {
        color: "var(--vscode-descriptionForeground)",
        textAlign: "center",
    },
    treeItemLayout: {
        fontSize: "12px",
        minWidth: 0,
        "& > .fui-TreeItemLayout__main": {
            minWidth: 0,
            overflow: "hidden",
        },
    },
    tableIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    tableIconAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    tableIconDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    tableIconModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    tableName: {
        flex: 1,
        minWidth: 0,
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "12px",
    },
    tableNameAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    tableNameDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    tableNameModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    changeIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    changeIconAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    changeIconModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    changeIconDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    changeDescription: {
        flex: 1,
        minWidth: 0,
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "12px",
    },
    actionToolbar: {
        flexShrink: 0,
    },
    searchHighlight: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
    },
    treeItem: {
        "& .fui-TreeItemLayout__actions": {
            opacity: 0,
            transition: "opacity 0.15s ease-in-out",
        },
        "&:hover .fui-TreeItemLayout__actions": {
            opacity: 1,
        },
        "&:focus-within .fui-TreeItemLayout__actions": {
            opacity: 1,
        },
    },
});

const highlightMatches = (
    text: string,
    searchText: string,
    highlightClass: string,
): React.ReactNode => {
    if (!searchText.trim()) {
        return text;
    }

    const lowerText = text.toLowerCase();
    const lowerSearch = searchText.toLowerCase().trim();
    const index = lowerText.indexOf(lowerSearch);

    if (index === -1) {
        return text;
    }

    const before = text.slice(0, index);
    const match = text.slice(index, index + searchText.trim().length);
    const after = text.slice(index + searchText.trim().length);

    return (
        <>
            {before}
            <span className={highlightClass}>{match}</span>
            {highlightMatches(after, searchText, highlightClass)}
        </>
    );
};

export const SchemaDesignerChangesPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const panelRef = useRef<ImperativePanelHandle | undefined>(undefined);

    const [searchText, setSearchText] = useState("");
    const [openItems, setOpenItems] = useState<Set<TreeItemValue>>(new Set());
    const [actionFilter, setActionFilter] = useState<typeof ALL_FILTER | ChangeAction>(ALL_FILTER);
    const [categoryFilter, setCategoryFilter] = useState<typeof ALL_FILTER | ChangeCategory>(
        ALL_FILTER,
    );

    const loc = locConstants.schemaDesigner.changesPanel;

    useEffect(() => {
        // Ensure panel starts collapsed
        panelRef.current?.collapse();

        const toggle = () => {
            if (!panelRef.current) {
                return;
            }

            if (panelRef.current.isCollapsed()) {
                panelRef.current.expand(DEFAULT_PANEL_SIZE);
            } else {
                panelRef.current.collapse();
            }
        };

        eventBus.on("toggleChangesPanel", toggle);
        return () => {
            eventBus.off("toggleChangesPanel", toggle);
        };
    }, []);

    const filteredGroups = useMemo(() => {
        if (!context.schemaChangesSummary?.groups) {
            return [];
        }

        const lowerSearch = searchText.toLowerCase().trim();
        const hasSearchText = lowerSearch.length > 0;
        const hasActionFilter = actionFilter !== ALL_FILTER;
        const hasCategoryFilter = categoryFilter !== ALL_FILTER;

        // If no filters active, return all groups
        if (!hasSearchText && !hasActionFilter && !hasCategoryFilter) {
            return context.schemaChangesSummary.groups;
        }

        return context.schemaChangesSummary.groups
            .map((group) => {
                // Check if table name matches search
                const tableMatchesSearch =
                    !hasSearchText ||
                    group.tableName.toLowerCase().includes(lowerSearch) ||
                    group.tableSchema.toLowerCase().includes(lowerSearch);

                // Filter changes based on all criteria
                const matchingChanges = group.changes.filter((change) => {
                    // Apply action filter
                    if (hasActionFilter && change.action !== actionFilter) {
                        return false;
                    }

                    // Apply category filter
                    if (hasCategoryFilter && change.category !== categoryFilter) {
                        return false;
                    }

                    // Apply search filter
                    if (hasSearchText) {
                        if (change.objectName?.toLowerCase().includes(lowerSearch)) {
                            return true;
                        }
                        const description = describeChange(change);
                        if (description.toLowerCase().includes(lowerSearch)) {
                            return true;
                        }
                        if (change.propertyChanges) {
                            for (const pc of change.propertyChanges) {
                                if (pc.displayName.toLowerCase().includes(lowerSearch)) {
                                    return true;
                                }
                                if (String(pc.oldValue).toLowerCase().includes(lowerSearch)) {
                                    return true;
                                }
                                if (String(pc.newValue).toLowerCase().includes(lowerSearch)) {
                                    return true;
                                }
                            }
                        }
                        // If search text is provided but nothing matches in this change
                        return false;
                    }

                    // No search filter, but action/category filters passed
                    return true;
                });

                // Include group if table matches search (return filtered changes) or has matching changes
                if (tableMatchesSearch && !hasActionFilter && !hasCategoryFilter && hasSearchText) {
                    // Return full group if only searching and table name matches
                    return group;
                } else if (matchingChanges.length > 0) {
                    return { ...group, changes: matchingChanges };
                }
                return undefined;
            })
            .filter((g): g is TableChangeGroup => g !== undefined);
    }, [context.schemaChangesSummary, searchText, actionFilter, categoryFilter]);

    // Build flat tree items for the headless flat tree
    const flatTreeItems = useMemo((): FlatTreeItem[] => {
        const items: FlatTreeItem[] = [];
        for (const group of filteredGroups) {
            const qualifiedName = `[${group.tableSchema}].[${group.tableName}]`;
            items.push({
                value: `table-${group.tableId}`,
                nodeType: "table",
                tableGroup: group,
                tableId: group.tableId,
                content: qualifiedName,
            });
            for (const change of group.changes) {
                items.push({
                    value: `change-${change.id}`,
                    parentValue: `table-${group.tableId}`,
                    nodeType: "change",
                    change,
                    tableId: group.tableId,
                    content: describeChange(change),
                });
            }
        }
        return items;
    }, [filteredGroups]);

    // Expand all table nodes when data changes
    useEffect(() => {
        const tableValues = flatTreeItems
            .filter((item) => item.nodeType === "table")
            .map((item) => item.value);
        setOpenItems(new Set(tableValues));
    }, [flatTreeItems]);

    const flatTree = useHeadlessFlatTree_unstable(flatTreeItems, {
        openItems,
        onOpenChange: (_event, data) => {
            setOpenItems(data.openItems);
        },
    });

    const handleReveal = useCallback(
        (change: SchemaChange) => {
            // Clear all previous selections first
            context.updateSelectedNodes([]);
            eventBus.emit("clearEdgeSelection");

            if (change.category === ChangeCategory.ForeignKey && change.objectId) {
                // Reveal FK edges (no table selection)
                eventBus.emit("revealForeignKeyEdges", change.objectId);
            } else {
                // Select the table and center on it
                context.updateSelectedNodes([change.tableId]);
                context.setCenter(change.tableId, true);
            }
        },
        [context],
    );

    const handleRevert = useCallback(
        (change: SchemaChange) => {
            context.revertChange(change);
        },
        [context],
    );

    const getCanRevert = useCallback(
        (change: SchemaChange) => {
            return context.canRevertChange(change);
        },
        [context],
    );

    const hasNoChanges = context.structuredSchemaChanges.length === 0;
    const hasActiveFilters = actionFilter !== ALL_FILTER || categoryFilter !== ALL_FILTER;
    const hasActiveFiltersOrSearch =
        searchText.trim() !== "" || actionFilter !== ALL_FILTER || categoryFilter !== ALL_FILTER;
    const hasNoResults = filteredGroups.length === 0 && !hasNoChanges;

    const getTableIconClass = (group: TableChangeGroup) => {
        if (group.isNew) {
            return classes.tableIconAdded;
        }
        if (group.isDeleted) {
            return classes.tableIconDeleted;
        }
        return classes.tableIconModified;
    };

    const getTableNameClass = (group: TableChangeGroup) => {
        if (group.isNew) {
            return classes.tableNameAdded;
        }
        if (group.isDeleted) {
            return classes.tableNameDeleted;
        }
        return classes.tableNameModified;
    };

    const getChangeIconClass = (change: SchemaChange) => {
        switch (change.action) {
            case ChangeAction.Add:
                return classes.changeIconAdded;
            case ChangeAction.Modify:
                return classes.changeIconModified;
            case ChangeAction.Delete:
                return classes.changeIconDeleted;
        }
    };

    const renderChangeActions = (change: SchemaChange) => {
        const revertInfo = getCanRevert(change);
        return (
            <Toolbar size="small" className={mergeClasses(classes.actionToolbar, "actionToolbar")}>
                <Tooltip content={loc.revealTooltip} relationship="label">
                    <ToolbarButton
                        aria-label={loc.reveal}
                        icon={<Eye16Regular />}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleReveal(change);
                        }}
                    />
                </Tooltip>
                <Tooltip
                    content={revertInfo.canRevert ? loc.revertTooltip : (revertInfo.reason ?? "")}
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.revert}
                        icon={<ArrowUndo16Regular />}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleRevert(change);
                        }}
                        disabled={!revertInfo.canRevert}
                    />
                </Tooltip>
            </Toolbar>
        );
    };

    return (
        <Panel
            collapsible
            defaultSize={DEFAULT_PANEL_SIZE}
            minSize={MIN_PANEL_SIZE}
            ref={(ref) => {
                panelRef.current = ref ?? undefined;
            }}>
            <div className={classes.container}>
                <div className={classes.header}>
                    <Text weight="semibold">
                        {locConstants.schemaDesigner.changesPanelTitle(context.schemaChangesCount)}
                    </Text>
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Dismiss12Regular />}
                        title={locConstants.schemaDesigner.close}
                        aria-label={locConstants.schemaDesigner.close}
                        onClick={() => panelRef.current?.collapse()}
                    />
                </div>

                {!hasNoChanges && (
                    <div className={classes.searchContainer}>
                        <div className={classes.searchRow}>
                            <Input
                                size="small"
                                placeholder={loc.searchPlaceholder}
                                value={searchText}
                                onChange={(_, data) => setSearchText(data.value)}
                                contentBefore={<Search16Regular />}
                                className={classes.searchInput}
                            />
                            <Popover withArrow positioning="below-end">
                                <PopoverTrigger disableButtonEnhancement>
                                    <Tooltip content={loc.filterTooltip} relationship="label">
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Filter16Regular />}
                                            className={mergeClasses(
                                                classes.filterButton,
                                                hasActiveFilters && classes.filterButtonActive,
                                            )}
                                            aria-label={loc.filterTooltip}
                                        />
                                    </Tooltip>
                                </PopoverTrigger>
                                <PopoverSurface>
                                    <div className={classes.filterPopover}>
                                        <Field label={loc.actionFilterLabel} size="small">
                                            <Dropdown
                                                size="small"
                                                className={classes.filterDropdown}
                                                value={
                                                    actionFilter === ALL_FILTER
                                                        ? loc.filterAll
                                                        : actionFilter === ChangeAction.Add
                                                          ? loc.filterAdded
                                                          : actionFilter === ChangeAction.Modify
                                                            ? loc.filterModified
                                                            : loc.filterDeleted
                                                }
                                                selectedOptions={[actionFilter]}
                                                onOptionSelect={(_, data) =>
                                                    setActionFilter(
                                                        data.optionValue as
                                                            | typeof ALL_FILTER
                                                            | ChangeAction,
                                                    )
                                                }>
                                                <Option value={ALL_FILTER}>{loc.filterAll}</Option>
                                                <Option value={ChangeAction.Add}>
                                                    {loc.filterAdded}
                                                </Option>
                                                <Option value={ChangeAction.Modify}>
                                                    {loc.filterModified}
                                                </Option>
                                                <Option value={ChangeAction.Delete}>
                                                    {loc.filterDeleted}
                                                </Option>
                                            </Dropdown>
                                        </Field>
                                        <Field label={loc.categoryFilterLabel} size="small">
                                            <Dropdown
                                                size="small"
                                                className={classes.filterDropdown}
                                                value={
                                                    categoryFilter === ALL_FILTER
                                                        ? loc.filterAll
                                                        : categoryFilter === ChangeCategory.Table
                                                          ? loc.tableCategory
                                                          : categoryFilter === ChangeCategory.Column
                                                            ? loc.columnCategory
                                                            : loc.foreignKeyCategory
                                                }
                                                selectedOptions={[categoryFilter]}
                                                onOptionSelect={(_, data) =>
                                                    setCategoryFilter(
                                                        data.optionValue as
                                                            | typeof ALL_FILTER
                                                            | ChangeCategory,
                                                    )
                                                }>
                                                <Option value={ALL_FILTER}>{loc.filterAll}</Option>
                                                <Option value={ChangeCategory.Table}>
                                                    {loc.tableCategory}
                                                </Option>
                                                <Option value={ChangeCategory.Column}>
                                                    {loc.columnCategory}
                                                </Option>
                                                <Option value={ChangeCategory.ForeignKey}>
                                                    {loc.foreignKeyCategory}
                                                </Option>
                                            </Dropdown>
                                        </Field>
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            disabled={!hasActiveFilters}
                                            onClick={() => {
                                                setActionFilter(ALL_FILTER);
                                                setCategoryFilter(ALL_FILTER);
                                            }}>
                                            {loc.clearFilters}
                                        </Button>
                                    </div>
                                </PopoverSurface>
                            </Popover>
                        </div>
                    </div>
                )}

                {hasNoChanges ? (
                    <div className={classes.empty}>
                        <CheckmarkCircle24Regular className={classes.emptyIcon} />
                        <Text className={classes.emptyText}>
                            {locConstants.schemaDesigner.noChangesYet}
                        </Text>
                    </div>
                ) : hasNoResults ? (
                    <div className={classes.empty}>
                        <Search16Regular className={classes.emptyIcon} />
                        <Text className={classes.emptyText}>
                            {hasActiveFiltersOrSearch
                                ? loc.noSearchResults
                                : locConstants.schemaDesigner.noChangesYet}
                        </Text>
                    </div>
                ) : (
                    <div className={classes.treeContainer}>
                        <FlatTree
                            {...flatTree.getTreeProps()}
                            aria-label={locConstants.schemaDesigner.changesPanelTitle(
                                context.schemaChangesCount,
                            )}>
                            {Array.from(flatTree.items(), (flatTreeItem) => {
                                const { content, ...treeItemProps } =
                                    flatTreeItem.getTreeItemProps();
                                const item = flatTreeItems.find(
                                    (i) => i.value === flatTreeItem.value,
                                );

                                if (!item) {
                                    return undefined;
                                }

                                if (item.nodeType === "table" && item.tableGroup) {
                                    const group = item.tableGroup;
                                    return (
                                        <TreeItem
                                            key={flatTreeItem.value}
                                            {...treeItemProps}
                                            className={classes.treeItem}>
                                            <TreeItemLayout
                                                className={classes.treeItemLayout}
                                                iconBefore={
                                                    <span
                                                        className={mergeClasses(
                                                            classes.tableIcon,
                                                            getTableIconClass(group),
                                                        )}>
                                                        <PendingChangesIcon16 />
                                                    </span>
                                                }
                                                aside={
                                                    <CounterBadge
                                                        count={group.changes.length}
                                                        size="small"
                                                        appearance="filled"
                                                        color="informative"
                                                    />
                                                }>
                                                <span
                                                    className={mergeClasses(
                                                        classes.tableName,
                                                        getTableNameClass(group),
                                                    )}
                                                    title={content as string}>
                                                    {highlightMatches(
                                                        content as string,
                                                        searchText,
                                                        classes.searchHighlight,
                                                    )}
                                                </span>
                                            </TreeItemLayout>
                                        </TreeItem>
                                    );
                                } else if (item.nodeType === "change" && item.change) {
                                    const change = item.change;
                                    return (
                                        <TreeItem
                                            key={flatTreeItem.value}
                                            {...treeItemProps}
                                            className={classes.treeItem}>
                                            <TreeItemLayout
                                                className={classes.treeItemLayout}
                                                iconBefore={
                                                    <span
                                                        className={mergeClasses(
                                                            classes.changeIcon,
                                                            getChangeIconClass(change),
                                                        )}>
                                                        <PendingChangesIcon16 />
                                                    </span>
                                                }
                                                actions={renderChangeActions(change)}>
                                                <span
                                                    className={classes.changeDescription}
                                                    title={content as string}>
                                                    {highlightMatches(
                                                        content as string,
                                                        searchText,
                                                        classes.searchHighlight,
                                                    )}
                                                </span>
                                            </TreeItemLayout>
                                        </TreeItem>
                                    );
                                }
                                return undefined;
                            })}
                        </FlatTree>
                    </div>
                )}
            </div>
        </Panel>
    );
};
