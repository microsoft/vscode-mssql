/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Input, makeStyles } from "@fluentui/react-components";
import { Search16Regular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { ChangeAction, ChangeCategory } from "./diff/diffUtils";
import { SchemaDesignerChangesFilterButton } from "./schemaDesignerChangesFilterButton";

const useStyles = makeStyles({
    searchContainer: {
        padding: "8px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        flexShrink: 0,
    },
    searchInput: {
        width: "100%",
        minWidth: 0,
    },
});

type SchemaDesignerChangesFiltersProps = {
    searchText: string;
    onSearchTextChange: (value: string) => void;
    selectedActions: ChangeAction[];
    onToggleAction: (action: ChangeAction) => void;
    selectedCategories: ChangeCategory[];
    onToggleCategory: (category: ChangeCategory) => void;
    hasActiveFilters: boolean;
    onClearFilters: () => void;
};

export const SchemaDesignerChangesFilters = ({
    searchText,
    onSearchTextChange,
    selectedActions,
    onToggleAction,
    selectedCategories,
    onToggleCategory,
    hasActiveFilters,
    onClearFilters,
}: SchemaDesignerChangesFiltersProps): JSX.Element => {
    const classes = useStyles();

    return (
        <div className={classes.searchContainer}>
            <Input
                size="small"
                placeholder={locConstants.schemaDesigner.changesPanel.searchPlaceholder}
                value={searchText}
                onChange={(_, data) => onSearchTextChange(data.value)}
                contentBefore={<Search16Regular />}
                contentAfter={
                    <SchemaDesignerChangesFilterButton
                        selectedActions={selectedActions}
                        onToggleAction={onToggleAction}
                        selectedCategories={selectedCategories}
                        onToggleCategory={onToggleCategory}
                        hasActiveFilters={hasActiveFilters}
                        onClearFilters={onClearFilters}
                    />
                }
                className={classes.searchInput}
            />
        </div>
    );
};
