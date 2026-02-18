/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useContext, useMemo, useState } from "react";
import { makeStyles } from "@fluentui/react-components";
import { SchemaDesignerContext } from "../../schemaDesignerStateProvider";
import { locConstants } from "../../../../common/locConstants";
import { SchemaDesignerChangesToolbar } from "./schemaDesignerChangesToolbar";
import { SegmentedControl } from "../../../../common/segmentedControl";
import { ChangeAction, ChangeCategory } from "../../diff/diffUtils";
import { SchemaDesignerChangesListView } from "./schemaDesignerChangesListView";
import { SchemaDesignerChangesDiffView } from "./schemaDesignerChangesDiffView";
import {
    SchemaDesignerChangesViewMode,
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../schemaDesignerDefinitionPanelContext";

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
    headerActions: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    viewModeSegmented: {
        flexShrink: 0,
    },
});

export const useSchemaDesignerChangesCustomTab = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const changesPanelLoc = locConstants.schemaDesigner.changesPanel;
    const [searchText, setSearchText] = useState("");
    const [actionFilters, setActionFilters] = useState<ChangeAction[]>([]);
    const [categoryFilters, setCategoryFilters] = useState<ChangeCategory[]>([]);
    const { changesViewMode, setChangesViewMode } = useSchemaDesignerDefinitionPanelContext();
    const hasNoChanges = context.structuredSchemaChanges.length === 0;
    const hasActiveFilters = actionFilters.length > 0 || categoryFilters.length > 0;

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

    const clearFilters = useCallback(() => {
        setActionFilters([]);
        setCategoryFilters([]);
    }, []);

    return useMemo(
        () => ({
            id: SchemaDesignerDefinitionPanelTab.Changes,
            label: locConstants.schemaDesigner.changesPanelTitle(context.schemaChangesCount),
            headerActions: (
                <div className={classes.headerActions}>
                    {changesViewMode === SchemaDesignerChangesViewMode.SchemaChanges &&
                    !hasNoChanges ? (
                        <SchemaDesignerChangesToolbar
                            searchText={searchText}
                            onSearchTextChange={setSearchText}
                            selectedActions={actionFilters}
                            onToggleAction={toggleActionFilter}
                            selectedCategories={categoryFilters}
                            onToggleCategory={toggleCategoryFilter}
                            hasActiveFilters={hasActiveFilters}
                            onClearFilters={clearFilters}
                        />
                    ) : undefined}

                    <SegmentedControl<SchemaDesignerChangesViewMode>
                        value={changesViewMode}
                        onValueChange={setChangesViewMode}
                        className={classes.viewModeSegmented}
                        ariaLabel={changesPanelLoc.viewModeAriaLabel}
                        options={[
                            {
                                value: SchemaDesignerChangesViewMode.SchemaChanges,
                                label: changesPanelLoc.viewModeSchemaChanges,
                            },
                            {
                                value: SchemaDesignerChangesViewMode.SchemaDiff,
                                label: changesPanelLoc.viewModeSchemaDiff,
                            },
                        ]}
                    />
                </div>
            ),
            content:
                changesViewMode === SchemaDesignerChangesViewMode.SchemaChanges ? (
                    <SchemaDesignerChangesListView
                        searchText={searchText}
                        selectedActions={actionFilters}
                        selectedCategories={categoryFilters}
                    />
                ) : (
                    <SchemaDesignerChangesDiffView />
                ),
        }),
        [
            actionFilters,
            categoryFilters,
            changesViewMode,
            clearFilters,
            classes.headerActions,
            classes.viewModeSegmented,
            context.schemaChangesCount,
            changesPanelLoc.viewModeAriaLabel,
            changesPanelLoc.viewModeSchemaChanges,
            changesPanelLoc.viewModeSchemaDiff,
            hasActiveFilters,
            hasNoChanges,
            searchText,
            setChangesViewMode,
            toggleActionFilter,
            toggleCategoryFilter,
        ],
    );
};
