/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
} from "@fluentui/react-components";
import {
    Dismiss12Regular,
    Search16Regular,
    CheckmarkCircle24Regular,
    Eye16Regular,
    ArrowUndo16Regular,
} from "@fluentui/react-icons";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import eventBus from "./schemaDesignerEvents";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { locConstants } from "../../common/locConstants";
import { SchemaChange, TableChangeGroup } from "./diff/diffUtils";
import { describeChange } from "./diff/schemaDiff";
import { PendingChangesIcon16 } from "../../common/icons/fluentIcons";

const DEFAULT_PANEL_SIZE = 25;
const MIN_PANEL_SIZE = 10;

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

export const SchemaDesignerChangesPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const panelRef = useRef<ImperativePanelHandle | undefined>(undefined);

    const [searchText, setSearchText] = useState("");
    const [openItems, setOpenItems] = useState<Set<TreeItemValue>>(new Set());

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

        if (!searchText.trim()) {
            return context.schemaChangesSummary.groups;
        }

        const lowerSearch = searchText.toLowerCase().trim();
        return context.schemaChangesSummary.groups
            .map((group) => {
                // Check if table name matches
                const tableMatches =
                    group.tableName.toLowerCase().includes(lowerSearch) ||
                    group.tableSchema.toLowerCase().includes(lowerSearch);

                // Filter changes that match
                const matchingChanges = group.changes.filter((change) => {
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
                    return false;
                });

                // Include group if table matches or has matching changes
                if (tableMatches) {
                    return group; // Return full group if table name matches
                } else if (matchingChanges.length > 0) {
                    return { ...group, changes: matchingChanges };
                }
                return undefined;
            })
            .filter((g): g is TableChangeGroup => g !== undefined);
    }, [context.schemaChangesSummary, searchText]);

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
            if (change.category === "foreignKey" && change.objectId) {
                eventBus.emit("revealForeignKeyEdges", change.objectId);
            } else {
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
            case "add":
                return classes.changeIconAdded;
            case "modify":
                return classes.changeIconModified;
            case "delete":
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
                        <Input
                            size="small"
                            placeholder={loc.searchPlaceholder}
                            value={searchText}
                            onChange={(_, data) => setSearchText(data.value)}
                            contentBefore={<Search16Regular />}
                            style={{ width: "100%" }}
                        />
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
                        <Text className={classes.emptyText}>{loc.noSearchResults}</Text>
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
                                                    {content}
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
                                                    {content}
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
