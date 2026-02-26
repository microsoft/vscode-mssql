/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
    makeStyles,
    TreeItemValue,
    useHeadlessFlatTree_unstable,
} from "@fluentui/react-components";
import { Checkmark24Regular, Search16Regular } from "@fluentui/react-icons";
import eventBus from "../../schemaDesignerEvents";
import { SchemaDesignerContext } from "../../schemaDesignerStateProvider";
import { locConstants } from "../../../../common/locConstants";
import { ChangeAction, ChangeCategory, SchemaChange, TableChangeGroup } from "../../diff/diffUtils";
import { describeChange } from "../../diff/schemaDiff";
import { SchemaDesignerChangesEmptyState } from "./schemaDesignerChangesEmptyState";
import { SchemaDesignerChangesTree, FlatTreeItem } from "./schemaDesignerChangesTree";
import { useSchemaDesignerDefinitionPanelContext } from "../schemaDesignerDefinitionPanelContext";
import { useSchemaDesignerChangeContext } from "./schemaDesignerChangeContext";
import { formatSchemaDesignerChangeValue } from "./schemaDesignerChangeValueFormatter";

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

type SchemaDesignerChangesListViewProps = {
    searchText: string;
    selectedActions: ChangeAction[];
    selectedCategories: ChangeCategory[];
};

export const SchemaDesignerChangesListView = ({
    searchText,
    selectedActions,
    selectedCategories,
}: SchemaDesignerChangesListViewProps) => {
    const context = useContext(SchemaDesignerContext);
    const changeContext = useSchemaDesignerChangeContext();
    const classes = useStyles();
    const { setIsChangesPanelVisible } = useSchemaDesignerDefinitionPanelContext();

    const [openItems, setOpenItems] = useState<Set<TreeItemValue>>(new Set());

    const loc = locConstants.schemaDesigner.changesPanel;

    useEffect(() => {
        setIsChangesPanelVisible(true);
        return () => {
            setIsChangesPanelVisible(false);
        };
    }, [setIsChangesPanelVisible]);

    const filteredGroups = useMemo(() => {
        if (!changeContext.schemaChangesSummary?.groups) {
            return [];
        }

        const lowerSearch = searchText.toLowerCase().trim();
        const hasSearchText = lowerSearch.length > 0;
        const hasActionFilter = selectedActions.length > 0;
        const hasCategoryFilter = selectedCategories.length > 0;

        if (!hasSearchText && !hasActionFilter && !hasCategoryFilter) {
            return changeContext.schemaChangesSummary.groups;
        }

        return changeContext.schemaChangesSummary.groups
            .map((group) => {
                const tableMatchesSearch =
                    !hasSearchText ||
                    group.tableName.toLowerCase().includes(lowerSearch) ||
                    group.tableSchema.toLowerCase().includes(lowerSearch);

                const matchingChanges = group.changes.filter((change) => {
                    if (hasActionFilter && !selectedActions.includes(change.action)) {
                        return false;
                    }

                    if (hasCategoryFilter && !selectedCategories.includes(change.category)) {
                        return false;
                    }

                    if (hasSearchText) {
                        if (change.objectName?.toLowerCase().includes(lowerSearch)) {
                            return true;
                        }
                        const description = describeChange(change);
                        if (description.toLowerCase().includes(lowerSearch)) {
                            return true;
                        }
                        if (change.propertyChanges) {
                            for (const propertyChange of change.propertyChanges) {
                                if (
                                    propertyChange.displayName.toLowerCase().includes(lowerSearch)
                                ) {
                                    return true;
                                }
                                if (
                                    formatSchemaDesignerChangeValue(propertyChange.oldValue)
                                        .toLowerCase()
                                        .includes(lowerSearch)
                                ) {
                                    return true;
                                }
                                if (
                                    formatSchemaDesignerChangeValue(propertyChange.newValue)
                                        .toLowerCase()
                                        .includes(lowerSearch)
                                ) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }

                    return true;
                });

                if (tableMatchesSearch && !hasActionFilter && !hasCategoryFilter && hasSearchText) {
                    return group;
                } else if (matchingChanges.length > 0) {
                    return { ...group, changes: matchingChanges };
                }
                return undefined;
            })
            .filter((group): group is TableChangeGroup => group !== undefined);
    }, [changeContext.schemaChangesSummary, searchText, selectedActions, selectedCategories]);

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
            context.updateSelectedNodes([]);
            eventBus.emit("clearEdgeSelection");

            if (change.category === ChangeCategory.ForeignKey && change.objectId) {
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
            changeContext.revertChange(change);
        },
        [changeContext],
    );

    const getCanRevert = useCallback(
        (change: SchemaChange) => {
            return changeContext.canRevertChange(change);
        },
        [changeContext],
    );

    const hasNoChanges = changeContext.structuredSchemaChanges.length === 0;
    const hasActiveFiltersOrSearch =
        searchText.trim() !== "" || selectedActions.length > 0 || selectedCategories.length > 0;
    const hasNoResults = filteredGroups.length === 0 && !hasNoChanges;

    return (
        <div className={classes.container}>
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
                        changeContext.schemaChangesCount,
                    )}
                    loc={loc}
                    onReveal={handleReveal}
                    onRevert={handleRevert}
                    getCanRevert={getCanRevert}
                />
            )}
        </div>
    );
};
