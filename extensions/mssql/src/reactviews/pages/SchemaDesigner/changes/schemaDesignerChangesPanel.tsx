/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    makeStyles,
    TreeItemValue,
    useHeadlessFlatTree_unstable,
} from "@fluentui/react-components";
import { Checkmark24Regular, Search16Regular } from "@fluentui/react-icons";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import eventBus, { SchemaDesignerChangesPanelTab } from "../schemaDesignerEvents";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import { ChangeAction, ChangeCategory, SchemaChange, TableChangeGroup } from "../diff/diffUtils";
import { describeChange } from "../diff/schemaDiff";
import { SchemaDesignerChangesEmptyState } from "./schemaDesignerChangesEmptyState";
import { SchemaDesignerChangesHeader } from "./schemaDesignerChangesHeader";
import { SchemaDesignerChangesFilters } from "./schemaDesignerChangesFilters";
import { SchemaDesignerChangesTree, FlatTreeItem } from "./schemaDesignerChangesTree";
import { getVisiblePendingAiSchemaChanges } from "../aiLedger/ledgerUtils";

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
    aiFooter: {
        display: "flex",
        justifyContent: "flex-end",
        gap: "8px",
        padding: "8px",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editorWidget-background) 65%, transparent)",
        flexShrink: 0,
    },
});

export const SchemaDesignerChangesPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const panelRef = useRef<ImperativePanelHandle | undefined>(undefined);
    const changesPanelTabRef = useRef<SchemaDesignerChangesPanelTab>(context.changesPanelTab);
    const { setIsChangesPanelVisible, setShowChangesHighlight, setChangesPanelTab } = context;

    const [searchText, setSearchText] = useState("");
    const [baselineOpenItems, setBaselineOpenItems] = useState<Set<TreeItemValue>>(new Set());
    const [actionFilters, setActionFilters] = useState<ChangeAction[]>([]);
    const [categoryFilters, setCategoryFilters] = useState<ChangeCategory[]>([]);
    const [isApplyingAiAction, setIsApplyingAiAction] = useState(false);
    const [activePendingAiChangeId, setActivePendingAiChangeId] = useState<string | undefined>(
        undefined,
    );

    const loc = locConstants.schemaDesigner.changesPanel;
    const pendingAiTabLabel = locConstants.schemaDesigner.pendingAiTabLabel;
    const pendingAiEmptyTitle = locConstants.schemaDesigner.pendingAiEmptyTitle;
    const pendingAiEmptySubtitle = locConstants.schemaDesigner.pendingAiEmptySubtitle;

    useEffect(() => {
        changesPanelTabRef.current = context.changesPanelTab;
    }, [context.changesPanelTab]);

    useEffect(() => {
        // Ensure panel starts collapsed
        panelRef.current?.collapse();
        setIsChangesPanelVisible(false);

        const toggle = () => {
            if (!panelRef.current) {
                return;
            }

            if (panelRef.current.isCollapsed()) {
                setChangesPanelTab("baseline");
                panelRef.current.expand(DEFAULT_PANEL_SIZE);
                setIsChangesPanelVisible(true);
                setShowChangesHighlight(true);
            } else if (changesPanelTabRef.current !== "baseline") {
                setChangesPanelTab("baseline");
            } else {
                panelRef.current.collapse();
                setIsChangesPanelVisible(false);
                setShowChangesHighlight(false);
            }
        };

        const openPanel = (tab?: SchemaDesignerChangesPanelTab) => {
            if (!panelRef.current) {
                return;
            }

            if (tab) {
                setChangesPanelTab(tab);
            }
            if (panelRef.current.isCollapsed()) {
                panelRef.current.expand(DEFAULT_PANEL_SIZE);
            }
            setIsChangesPanelVisible(true);
            setShowChangesHighlight(true);
        };

        eventBus.on("toggleChangesPanel", toggle);
        eventBus.on("openChangesPanel", openPanel);
        return () => {
            eventBus.off("toggleChangesPanel", toggle);
            eventBus.off("openChangesPanel", openPanel);
            setIsChangesPanelVisible(false);
        };
    }, [setChangesPanelTab, setIsChangesPanelVisible, setShowChangesHighlight]);

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

    const pendingAiChanges = useMemo(
        () => getVisiblePendingAiSchemaChanges(context.aiLedger),
        [context.aiLedger],
    );
    const aiLedgerChangesCount = pendingAiChanges.length;

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
        () =>
            pendingAiChanges.map((change) => ({
                value: `ai-change-${change.id}`,
                nodeType: "change" as const,
                change,
                tableId: change.tableId,
                content: getChangeDescription(change),
            })),
        [getChangeDescription, pendingAiChanges],
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

    const pendingAiFlatTree = useHeadlessFlatTree_unstable(pendingAiFlatTreeItems);

    useEffect(() => {
        const handleActivePendingAiChangeUpdated = (changeId: string | undefined) => {
            setActivePendingAiChangeId(changeId);
        };
        eventBus.on("activePendingAiChangeUpdated", handleActivePendingAiChangeUpdated);
        return () => {
            eventBus.off("activePendingAiChangeUpdated", handleActivePendingAiChangeUpdated);
        };
    }, []);

    useEffect(() => {
        if (pendingAiChanges.length === 0) {
            setActivePendingAiChangeId(undefined);
            return;
        }

        if (
            !activePendingAiChangeId ||
            !pendingAiChanges.some((change) => change.id === activePendingAiChangeId)
        ) {
            setActivePendingAiChangeId(pendingAiChanges[0].id);
        }
    }, [activePendingAiChangeId, pendingAiChanges]);

    const handleReveal = useCallback(
        (change: SchemaChange) => {
            if (context.changesPanelTab === "pendingAi") {
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

    const handleKeepAllAi = useCallback(() => {
        context.keepAllAiLedger();
    }, [context]);

    const handleUndoAllAi = useCallback(async () => {
        if (isApplyingAiAction) {
            return;
        }
        setIsApplyingAiAction(true);
        try {
            await context.undoAllAiLedger();
        } finally {
            setIsApplyingAiAction(false);
        }
    }, [context, isApplyingAiAction]);

    const getCanKeepAiChange = useCallback(
        (_change: SchemaChange) => ({
            canKeep: !isApplyingAiAction,
        }),
        [isApplyingAiAction],
    );

    const getCanUndoAiChange = useCallback(
        (_change: SchemaChange) => ({
            canRevert: !isApplyingAiAction,
        }),
        [isApplyingAiAction],
    );

    const hasNoChanges = context.structuredSchemaChanges.length === 0;
    const hasActiveFilters = actionFilters.length > 0 || categoryFilters.length > 0;
    const hasActiveFiltersOrSearch =
        searchText.trim() !== "" || actionFilters.length > 0 || categoryFilters.length > 0;
    const hasNoResults = baselineFilteredGroups.length === 0 && !hasNoChanges;
    const hasNoPendingAiResults = pendingAiChanges.length === 0;
    const hasAiLedgerChanges = aiLedgerChangesCount > 0;

    useEffect(() => {
        if (context.changesPanelTab !== "pendingAi" || hasAiLedgerChanges) {
            return;
        }

        panelRef.current?.collapse();
        setIsChangesPanelVisible(false);
        setShowChangesHighlight(false);
        setChangesPanelTab("baseline");
    }, [
        context.changesPanelTab,
        hasAiLedgerChanges,
        setChangesPanelTab,
        setIsChangesPanelVisible,
        setShowChangesHighlight,
    ]);

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
                    title={
                        context.changesPanelTab === "baseline"
                            ? locConstants.schemaDesigner.changesPanelTitle(
                                  context.schemaChangesCount,
                              )
                            : locConstants.schemaDesigner.pendingAiChangesPanelTitle(
                                  aiLedgerChangesCount,
                              )
                    }
                    onClose={() => {
                        panelRef.current?.collapse();
                        setIsChangesPanelVisible(false);
                        setShowChangesHighlight(false);
                    }}
                />

                {context.changesPanelTab === "baseline" ? (
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
                            />
                        )}
                    </>
                ) : hasAiLedgerChanges ? (
                    <>
                        {hasNoPendingAiResults ? (
                            <SchemaDesignerChangesEmptyState
                                icon={<Checkmark24Regular />}
                                title={pendingAiEmptyTitle}
                                subtitle={pendingAiEmptySubtitle}
                            />
                        ) : (
                            <SchemaDesignerChangesTree
                                flatTree={pendingAiFlatTree}
                                flatTreeItems={pendingAiFlatTreeItems}
                                searchText=""
                                ariaLabel={pendingAiTabLabel}
                                activeChangeId={activePendingAiChangeId}
                                loc={{
                                    ...loc,
                                    keep: locConstants.schemaDesigner.keep,
                                    keepTooltip:
                                        locConstants.schemaDesigner.keepAiChangeTooltip,
                                    revert: locConstants.schemaDesigner.undo,
                                    revertTooltip:
                                        locConstants.schemaDesigner.undoAiChangeTooltip,
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
                        <div className={classes.aiFooter}>
                            <Button
                                size="small"
                                appearance="primary"
                                onClick={handleKeepAllAi}
                                disabled={isApplyingAiAction}>
                                {locConstants.schemaDesigner.keepAll}
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => {
                                    void handleUndoAllAi();
                                }}
                                disabled={isApplyingAiAction}>
                                {locConstants.schemaDesigner.undoAll}
                            </Button>
                        </div>
                    </>
                ) : (
                    <SchemaDesignerChangesEmptyState
                        icon={<Checkmark24Regular />}
                        title={pendingAiEmptyTitle}
                        subtitle={pendingAiEmptySubtitle}
                    />
                )}
            </div>
        </Panel>
    );
};
