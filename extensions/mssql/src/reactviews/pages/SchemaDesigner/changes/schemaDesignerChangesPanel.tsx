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
import eventBus, { SchemaDesignerChangesPanelTab } from "../schemaDesignerEvents";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import { ChangeAction, ChangeCategory, SchemaChange, TableChangeGroup } from "../diff/diffUtils";
import { describeChange } from "../diff/schemaDiff";
import { SchemaDesignerChangesEmptyState } from "./schemaDesignerChangesEmptyState";
import { SchemaDesignerChangesFilters } from "./schemaDesignerChangesFilters";
import { SchemaDesignerChangesTree, FlatTreeItem } from "./schemaDesignerChangesTree";
import { getVisiblePendingAiItems, toPendingAiSchemaChange } from "../aiLedger/ledgerUtils";
import { buildPendingAiFlatTreeItems } from "./pendingAiFlatTreeBuilder";

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

interface SchemaDesignerChangesPanelProps {
    tab: SchemaDesignerChangesPanelTab;
}

export const SchemaDesignerChangesPanel = ({ tab }: SchemaDesignerChangesPanelProps) => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();

    const [searchText, setSearchText] = useState("");
    const [baselineOpenItems, setBaselineOpenItems] = useState<Set<TreeItemValue>>(new Set());
    const [actionFilters, setActionFilters] = useState<ChangeAction[]>([]);
    const [categoryFilters, setCategoryFilters] = useState<ChangeCategory[]>([]);
    const [pendingAiSearchText, setPendingAiSearchText] = useState("");
    const [pendingAiActionFilters, setPendingAiActionFilters] = useState<ChangeAction[]>([]);
    const [pendingAiCategoryFilters, setPendingAiCategoryFilters] = useState<ChangeCategory[]>([]);
    const [isApplyingAiAction, setIsApplyingAiAction] = useState(false);
    const [activePendingAiChangeId, setActivePendingAiChangeId] = useState<string | undefined>(
        undefined,
    );
    const scrollToActiveVersionRef = useRef(0);

    const loc = locConstants.schemaDesigner.changesPanel;
    const pendingAiTabLabel = locConstants.schemaDesigner.pendingAiTabLabel;
    const pendingAiEmptyTitle = locConstants.schemaDesigner.pendingAiEmptyTitle;
    const pendingAiEmptySubtitle = locConstants.schemaDesigner.pendingAiEmptySubtitle;

    const baselineFilteredGroups = useMemo(() => {
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

    const pendingAiItems = useMemo(
        () => getVisiblePendingAiItems(context.aiLedger),
        [context.aiLedger],
    );
    const pendingAiChangeEntries = useMemo(
        () => pendingAiItems.map((item) => ({ item, change: toPendingAiSchemaChange(item) })),
        [pendingAiItems],
    );

    const pendingAiFilteredEntries = useMemo(() => {
        const lowerSearch = pendingAiSearchText.toLowerCase().trim();
        const hasSearchText = lowerSearch.length > 0;
        const hasActionFilter = pendingAiActionFilters.length > 0;
        const hasCategoryFilter = pendingAiCategoryFilters.length > 0;

        if (!hasSearchText && !hasActionFilter && !hasCategoryFilter) {
            return pendingAiChangeEntries;
        }

        return pendingAiChangeEntries.filter(({ change }) => {
            if (hasActionFilter && !pendingAiActionFilters.includes(change.action)) {
                return false;
            }

            if (hasCategoryFilter && !pendingAiCategoryFilters.includes(change.category)) {
                return false;
            }

            if (!hasSearchText) {
                return true;
            }

            if (change.objectName?.toLowerCase().includes(lowerSearch)) {
                return true;
            }

            if (change.tableName.toLowerCase().includes(lowerSearch)) {
                return true;
            }

            if (change.tableSchema.toLowerCase().includes(lowerSearch)) {
                return true;
            }

            const description = getChangeDescription(change);
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
    }, [
        getChangeDescription,
        pendingAiActionFilters,
        pendingAiCategoryFilters,
        pendingAiChangeEntries,
        pendingAiSearchText,
    ]);

    const pendingAiFilteredChanges = useMemo(
        () => pendingAiFilteredEntries.map((entry) => entry.change),
        [pendingAiFilteredEntries],
    );

    const toFlatTreeItems = useCallback(
        (groups: TableChangeGroup[], prefix: "baseline" | "ai"): FlatTreeItem[] => {
            const items: FlatTreeItem[] = [];
            for (const group of groups) {
                const qualifiedName = `[${group.tableSchema}].[${group.tableName}]`;
                items.push({
                    value: `${prefix}-table-${group.tableId}`,
                    nodeType: "table",
                    tableGroup: group,
                    tableId: group.tableId,
                    content: qualifiedName,
                });
                for (const change of group.changes) {
                    items.push({
                        value: `${prefix}-change-${change.id}`,
                        parentValue: `${prefix}-table-${group.tableId}`,
                        nodeType: "change",
                        change,
                        tableId: group.tableId,
                        content: getChangeDescription(change),
                    });
                }
            }
            return items;
        },
        [getChangeDescription],
    );

    const baselineFlatTreeItems = useMemo(
        () => toFlatTreeItems(baselineFilteredGroups, "baseline"),
        [baselineFilteredGroups, toFlatTreeItems],
    );

    const pendingAiFlatTreeItems = useMemo(
        () => buildPendingAiFlatTreeItems(pendingAiFilteredEntries, getChangeDescription),
        [getChangeDescription, pendingAiFilteredEntries],
    );

    useEffect(() => {
        const tableValues = baselineFlatTreeItems
            .filter((item) => item.nodeType === "table")
            .map((item) => item.value);
        setBaselineOpenItems(new Set(tableValues));
    }, [baselineFlatTreeItems]);

    const baselineFlatTree = useHeadlessFlatTree_unstable(baselineFlatTreeItems, {
        openItems: baselineOpenItems,
        onOpenChange: (_event, data) => {
            setBaselineOpenItems(data.openItems);
        },
    });

    const pendingAiFlatTree = useHeadlessFlatTree_unstable(pendingAiFlatTreeItems, {
        defaultOpenItems: new Set(
            pendingAiFlatTreeItems
                .filter((item) => item.nodeType === "table")
                .map((item) => item.value),
        ),
    });

    useEffect(() => {
        const handleActivePendingAiChangeUpdated = (changeId: string | undefined) => {
            setActivePendingAiChangeId(changeId);
            // Programmatic navigation — request scroll-into-view.
            scrollToActiveVersionRef.current += 1;
        };
        eventBus.on("activePendingAiChangeUpdated", handleActivePendingAiChangeUpdated);
        return () => {
            eventBus.off("activePendingAiChangeUpdated", handleActivePendingAiChangeUpdated);
        };
    }, []);

    useEffect(() => {
        if (pendingAiFilteredChanges.length === 0) {
            setActivePendingAiChangeId(undefined);
            return;
        }

        if (
            !activePendingAiChangeId ||
            !pendingAiFilteredChanges.some((change) => change.id === activePendingAiChangeId)
        ) {
            setActivePendingAiChangeId(pendingAiFilteredChanges[0].id);
        }
    }, [activePendingAiChangeId, pendingAiFilteredChanges]);

    const handleReveal = useCallback(
        (change: SchemaChange) => {
            if (tab === "pendingAi") {
                setActivePendingAiChangeId(change.id);
                eventBus.emit("setActivePendingAiChange", change.id);
            }
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
        [context, tab],
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

    const handleKeepAiChange = useCallback(
        (change: SchemaChange) => {
            context.keepAiLedgerChange(change);
        },
        [context],
    );

    const handleUndoAiChange = useCallback(
        async (change: SchemaChange) => {
            if (isApplyingAiAction) {
                return;
            }
            setIsApplyingAiAction(true);
            try {
                await context.undoAiLedgerChange(change);
            } finally {
                setIsApplyingAiAction(false);
            }
        },
        [context, isApplyingAiAction],
    );

    const getCanKeepAiChange = useCallback(
        (_change: SchemaChange) => ({
            canKeep: !isApplyingAiAction,
        }),
        [isApplyingAiAction],
    );

    const getCanUndoAiChange = useCallback(
        (change: SchemaChange) => {
            if (isApplyingAiAction) {
                return {
                    canRevert: false,
                    reason: locConstants.schemaDesigner.cannotUndoAiChange,
                };
            }
            return context.canUndoAiLedgerChange(change);
        },
        [context, isApplyingAiAction],
    );

    const hasNoChanges = context.structuredSchemaChanges.length === 0;
    const hasActiveFilters = actionFilters.length > 0 || categoryFilters.length > 0;
    const hasActiveFiltersOrSearch =
        searchText.trim() !== "" || actionFilters.length > 0 || categoryFilters.length > 0;
    const hasNoResults = baselineFilteredGroups.length === 0 && !hasNoChanges;
    const hasPendingAiChanges = pendingAiItems.length > 0;
    const hasPendingAiFilters =
        pendingAiActionFilters.length > 0 || pendingAiCategoryFilters.length > 0;
    const hasPendingAiFiltersOrSearch =
        pendingAiSearchText.trim() !== "" ||
        pendingAiActionFilters.length > 0 ||
        pendingAiCategoryFilters.length > 0;
    const hasNoPendingAiResults = pendingAiFilteredChanges.length === 0 && hasPendingAiChanges;

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
    const togglePendingAiActionFilter = useCallback((action: ChangeAction) => {
        setPendingAiActionFilters((prev) =>
            prev.includes(action) ? prev.filter((value) => value !== action) : [...prev, action],
        );
    }, []);

    const togglePendingAiCategoryFilter = useCallback((category: ChangeCategory) => {
        setPendingAiCategoryFilters((prev) =>
            prev.includes(category)
                ? prev.filter((value) => value !== category)
                : [...prev, category],
        );
    }, []);

    return (
        <div className={classes.container}>
            {tab === "baseline" ? (
                <>
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
                            flatTree={baselineFlatTree}
                            flatTreeItems={baselineFlatTreeItems}
                            searchText={searchText}
                            ariaLabel={locConstants.schemaDesigner.changesPanelTitle(
                                context.schemaChangesCount,
                            )}
                            loc={loc}
                            onReveal={handleReveal}
                            onRevert={handleRevert}
                            getCanRevert={getCanRevert}
                            isPendingAiTab={false}
                        />
                    )}
                </>
            ) : (
                <>
                    {hasPendingAiChanges && (
                        <SchemaDesignerChangesFilters
                            searchText={pendingAiSearchText}
                            onSearchTextChange={setPendingAiSearchText}
                            selectedActions={pendingAiActionFilters}
                            onToggleAction={togglePendingAiActionFilter}
                            selectedCategories={pendingAiCategoryFilters}
                            onToggleCategory={togglePendingAiCategoryFilter}
                            hasActiveFilters={hasPendingAiFilters}
                            onClearFilters={() => {
                                setPendingAiActionFilters([]);
                                setPendingAiCategoryFilters([]);
                            }}
                        />
                    )}

                    {!hasPendingAiChanges ? (
                        <SchemaDesignerChangesEmptyState
                            icon={<Checkmark24Regular />}
                            title={pendingAiEmptyTitle}
                            subtitle={pendingAiEmptySubtitle}
                        />
                    ) : hasNoPendingAiResults ? (
                        <SchemaDesignerChangesEmptyState
                            icon={<Search16Regular />}
                            title={
                                hasPendingAiFiltersOrSearch
                                    ? loc.noSearchResults
                                    : pendingAiEmptyTitle
                            }
                        />
                    ) : (
                        <SchemaDesignerChangesTree
                            flatTree={pendingAiFlatTree}
                            flatTreeItems={pendingAiFlatTreeItems}
                            searchText={pendingAiSearchText}
                            ariaLabel={pendingAiTabLabel}
                            activeChangeId={activePendingAiChangeId}
                            scrollToActiveVersion={scrollToActiveVersionRef.current}
                            isPendingAiTab={true}
                            loc={{
                                ...loc,
                                keep: locConstants.schemaDesigner.keep,
                                keepTooltip: locConstants.schemaDesigner.keepAiChangeTooltip,
                                revert: locConstants.schemaDesigner.undo,
                                revertTooltip: locConstants.schemaDesigner.undoAiChangeTooltip,
                            }}
                            onReveal={handleReveal}
                            onKeep={handleKeepAiChange}
                            getCanKeep={getCanKeepAiChange}
                            onRevert={(change) => {
                                void handleUndoAiChange(change);
                            }}
                            getCanRevert={getCanUndoAiChange}
                        />
                    )}
                </>
            )}
        </div>
    );
};
