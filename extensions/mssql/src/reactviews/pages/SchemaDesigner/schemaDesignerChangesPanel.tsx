/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    makeStyles,
    TreeItemValue,
    useHeadlessFlatTree_unstable,
} from "@fluentui/react-components";
import { Checkmark24Regular, Search16Regular } from "@fluentui/react-icons";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import eventBus from "./schemaDesignerEvents";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { locConstants } from "../../common/locConstants";
import { ChangeAction, ChangeCategory, SchemaChange, TableChangeGroup } from "./diff/diffUtils";
import { describeChange } from "./diff/schemaDiff";
import { SchemaDesignerChangesEmptyState } from "./schemaDesignerChangesEmptyState";
import { SchemaDesignerChangesHeader } from "./schemaDesignerChangesHeader";
import { SchemaDesignerChangesFilters } from "./schemaDesignerChangesFilters";
import { SchemaDesignerChangesTree, FlatTreeItem } from "./schemaDesignerChangesTree";

const DEFAULT_PANEL_SIZE = 25;
const MIN_PANEL_SIZE = 10;

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
});

export const SchemaDesignerChangesPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const panelRef = useRef<ImperativePanelHandle | undefined>(undefined);
    const { setIsChangesPanelVisible } = context;

    const [searchText, setSearchText] = useState("");
    const [openItems, setOpenItems] = useState<Set<TreeItemValue>>(new Set());
    const [actionFilters, setActionFilters] = useState<ChangeAction[]>([]);
    const [categoryFilters, setCategoryFilters] = useState<ChangeCategory[]>([]);

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
        const hasActionFilter = actionFilters.length > 0;
        const hasCategoryFilter = categoryFilters.length > 0;

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
                    if (hasActionFilter && !actionFilters.includes(change.action)) {
                        return false;
                    }

                    // Apply category filter
                    if (hasCategoryFilter && !categoryFilters.includes(change.category)) {
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
    }, [context.schemaChangesSummary, searchText, actionFilters, categoryFilters]);

    const getChangeDescription = useCallback((change: SchemaChange) => {
        if (change.action === ChangeAction.Modify) {
            switch (change.category) {
                case ChangeCategory.Table:
                    return locConstants.schemaDesigner.schemaDiff.modifiedTable(
                        `[${change.tableSchema}].[${change.tableName}]`,
                    );
                case ChangeCategory.Column:
                    return locConstants.schemaDesigner.schemaDiff.modifiedColumn(
                        change.objectName ?? "",
                    );
                case ChangeCategory.ForeignKey:
                    return locConstants.schemaDesigner.schemaDiff.modifiedForeignKey(
                        change.objectName ?? "",
                    );
            }
        }

        return describeChange(change);
    }, []);

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
                    content: getChangeDescription(change),
                });
            }
        }
        return items;
    }, [filteredGroups, getChangeDescription]);

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
    const hasActiveFilters = actionFilters.length > 0 || categoryFilters.length > 0;
    const hasActiveFiltersOrSearch =
        searchText.trim() !== "" || actionFilters.length > 0 || categoryFilters.length > 0;
    const hasNoResults = filteredGroups.length === 0 && !hasNoChanges;

    const toggleActionFilter = useCallback((action: ChangeAction) => {
        setActionFilters((prev) =>
            prev.includes(action) ? prev.filter((value) => value !== action) : [...prev, action],
        );
    }, []);

    const toggleCategoryFilter = useCallback((category: ChangeCategory) => {
        setCategoryFilters((prev) =>
            prev.includes(category)
                ? prev.filter((value) => value !== category)
                : [...prev, category],
        );
    }, []);

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
                <SchemaDesignerChangesHeader
                    title={locConstants.schemaDesigner.changesPanelTitle(
                        context.schemaChangesCount,
                    )}
                    onClose={() => {
                        panelRef.current?.collapse();
                        setIsChangesPanelVisible(false);
                    }}
                />

                {!hasNoChanges && (
                    <SchemaDesignerChangesFilters
                        searchText={searchText}
                        onSearchTextChange={setSearchText}
                        selectedActions={actionFilters}
                        onToggleAction={toggleActionFilter}
                        selectedCategories={categoryFilters}
                        onToggleCategory={toggleCategoryFilter}
                        hasActiveFilters={hasActiveFilters}
                        onClearFilters={() => {
                            setActionFilters([]);
                            setCategoryFilters([]);
                        }}
                    />
                )}

                {hasNoChanges ? (
                    <SchemaDesignerChangesEmptyState
                        icon={<Checkmark24Regular />}
                        title={locConstants.schemaDesigner.noChangesYet}
                        subtitle={locConstants.schemaDesigner.noChangesYetSubtitle}
                    />
                ) : hasNoResults ? (
                    <SchemaDesignerChangesEmptyState
                        icon={<Search16Regular />}
                        title={
                            hasActiveFiltersOrSearch
                                ? loc.noSearchResults
                                : locConstants.schemaDesigner.noChangesYet
                        }
                    />
                ) : (
                    <SchemaDesignerChangesTree
                        flatTree={flatTree}
                        flatTreeItems={flatTreeItems}
                        searchText={searchText}
                        ariaLabel={locConstants.schemaDesigner.changesPanelTitle(
                            context.schemaChangesCount,
                        )}
                        loc={loc}
                        onReveal={handleReveal}
                        onRevert={handleRevert}
                        getCanRevert={getCanRevert}
                    />
                )}
            </div>
        </Panel>
    );
};
