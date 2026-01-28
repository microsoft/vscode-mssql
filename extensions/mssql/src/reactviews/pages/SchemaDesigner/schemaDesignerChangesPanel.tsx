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
import * as FluentIcons from "@fluentui/react-icons";

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
        "& .fui-TreeItemLayout": {
            minWidth: 0,
        },
        "& .fui-TreeItemLayout__main": {
            minWidth: 0,
            overflow: "hidden",
        },
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
    tableIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    changeIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    actionBadge: {
        fontSize: "11px",
        fontWeight: 600,
        marginLeft: "4px",
        flexShrink: 0,
    },
    actionBadgeAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    actionBadgeModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    actionBadgeDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    changeSummary: {
        display: "flex",
        gap: "6px",
        fontSize: "11px",
        fontWeight: 600,
    },
    ellipsisText: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        flex: 1,
    },
    searchHighlight: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
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
    const { setIsChangesPanelVisible } = context;

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
        setIsChangesPanelVisible(false);

        const toggle = () => {
            if (!panelRef.current) {
                return;
            }

            if (panelRef.current.isCollapsed()) {
                panelRef.current.expand(DEFAULT_PANEL_SIZE);
                setIsChangesPanelVisible(true);
            } else {
                panelRef.current.collapse();
                setIsChangesPanelVisible(false);
            }
        };

        eventBus.on("toggleChangesPanel", toggle);
        return () => {
            eventBus.off("toggleChangesPanel", toggle);
            setIsChangesPanelVisible(false);
        };
    }, [setIsChangesPanelVisible]);

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

    const renderChangeIcon = (change: SchemaChange) => {
        switch (change.category) {
            case ChangeCategory.Table:
                return <FluentIcons.Table20Regular />;
            case ChangeCategory.Column:
                return <FluentIcons.Column20Regular />;
            case ChangeCategory.ForeignKey:
                return <FluentIcons.Key20Regular />;
        }
    };

    const getActionBadge = (change: SchemaChange) => {
        switch (change.action) {
            case ChangeAction.Add:
                return { letter: "A", className: classes.actionBadgeAdded };
            case ChangeAction.Modify:
                return { letter: "M", className: classes.actionBadgeModified };
            case ChangeAction.Delete:
                return { letter: "D", className: classes.actionBadgeDeleted };
        }
    };

    const renderChangeSummary = (group: TableChangeGroup) => {
        const counts = { add: 0, modify: 0, delete: 0 };
        for (const change of group.changes) {
            if (change.action === ChangeAction.Add) counts.add++;
            else if (change.action === ChangeAction.Modify) counts.modify++;
            else if (change.action === ChangeAction.Delete) counts.delete++;
        }
        return (
            <span className={classes.changeSummary}>
                {counts.add > 0 && <span className={classes.actionBadgeAdded}>{counts.add} A</span>}
                {counts.modify > 0 && (
                    <span className={classes.actionBadgeModified}>{counts.modify} M</span>
                )}
                {counts.delete > 0 && (
                    <span className={classes.actionBadgeDeleted}>{counts.delete} D</span>
                )}
            </span>
        );
    };

    const renderChangeActions = (change: SchemaChange) => {
        const revertInfo = getCanRevert(change);
        return (
            <Toolbar size="small">
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
            onResize={(size) => {
                setIsChangesPanelVisible(size > 0);
            }}
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
                        onClick={() => {
                            panelRef.current?.collapse();
                            setIsChangesPanelVisible(false);
                        }}
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
                                        <TreeItem key={flatTreeItem.value} {...treeItemProps}>
                                            <TreeItemLayout
                                                iconBefore={
                                                    <span className={classes.tableIcon}>
                                                        <FluentIcons.Table20Regular />
                                                    </span>
                                                }
                                                aside={renderChangeSummary(group)}>
                                                <Tooltip
                                                    content={content as string}
                                                    relationship="label"
                                                    positioning="above">
                                                    <span className={classes.ellipsisText}>
                                                        {highlightMatches(
                                                            content as string,
                                                            searchText,
                                                            classes.searchHighlight,
                                                        )}
                                                    </span>
                                                </Tooltip>
                                            </TreeItemLayout>
                                        </TreeItem>
                                    );
                                } else if (item.nodeType === "change" && item.change) {
                                    const change = item.change;
                                    return (
                                        <TreeItem key={flatTreeItem.value} {...treeItemProps}>
                                            <TreeItemLayout
                                                iconBefore={
                                                    <span
                                                        className={mergeClasses(
                                                            classes.changeIcon,
                                                            getActionBadge(change).className,
                                                        )}>
                                                        {renderChangeIcon(change)}
                                                    </span>
                                                }
                                                aside={
                                                    <span
                                                        className={mergeClasses(
                                                            classes.actionBadge,
                                                            getActionBadge(change).className,
                                                        )}>
                                                        {getActionBadge(change).letter}
                                                    </span>
                                                }
                                                actions={renderChangeActions(change)}>
                                                <Tooltip
                                                    content={content as string}
                                                    relationship="label"
                                                    positioning="above">
                                                    <span className={classes.ellipsisText}>
                                                        {highlightMatches(
                                                            content as string,
                                                            searchText,
                                                            classes.searchHighlight,
                                                        )}
                                                    </span>
                                                </Tooltip>
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
