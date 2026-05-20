/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import {
    Button,
    makeStyles,
    mergeClasses,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    ToggleButton,
} from "@fluentui/react-components";
import {
    Column20Regular,
    Dismiss12Regular,
    Filter16Regular,
    Key20Regular,
    Table20Regular,
} from "@fluentui/react-icons";
import { locConstants } from "../../../../common/locConstants";
import { ChangeAction, ChangeCategory } from "../../diff/diffUtils";

const useStyles = makeStyles({
    triggerButton: {
        flexShrink: 0,
    },
    triggerButtonActive: {
        color: "var(--vscode-textLink-foreground)",
    },
    surface: {
        padding: "10px",
        minWidth: "260px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "8px",
        boxShadow: "var(--vscode-widget-shadow)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "6px",
    },
    headerTitle: {
        fontSize: "13px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
    },
    closeButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        borderRadius: "6px",
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    divider: {
        height: "1px",
        backgroundColor: "var(--vscode-editorWidget-border)",
        opacity: 0.7,
        margin: "6px 0 8px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    sectionTitle: {
        fontSize: "11px",
        color: "var(--vscode-descriptionForeground)",
        fontWeight: 600,
    },
    toggleRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        width: "100%",
    },
    toggleButton: {
        borderRadius: "999px",
        fontSize: "12px",
        minWidth: "unset",
    },
    toggleButtonSelected: {
        border: "1px solid var(--vscode-textLink-foreground)",
        color: "var(--vscode-textLink-foreground)",
        backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 20%, transparent)",
    },
    toggleIcon: {
        width: "14px",
        height: "14px",
    },
    footer: {
        display: "flex",
        gap: "6px",
        marginTop: "10px",
    },
    footerButton: {
        flex: 1,
    },
});

type SchemaDesignerChangesFilterButtonProps = {
    selectedActions: ChangeAction[];
    onToggleAction: (action: ChangeAction) => void;
    selectedCategories: ChangeCategory[];
    onToggleCategory: (category: ChangeCategory) => void;
    hasActiveFilters: boolean;
    onClearFilters: () => void;
};

export const SchemaDesignerChangesFilterButton = ({
    selectedActions,
    onToggleAction,
    selectedCategories,
    onToggleCategory,
    hasActiveFilters,
    onClearFilters,
}: SchemaDesignerChangesFilterButtonProps) => {
    const classes = useStyles();
    const loc = locConstants.schemaDesigner.changesPanel;
    const [open, setOpen] = useState(false);

    const isActionSelected = (action: ChangeAction) => selectedActions.includes(action);
    const isCategorySelected = (category: ChangeCategory) => selectedCategories.includes(category);

    return (
        <Popover
            withArrow
            positioning="below-end"
            open={open}
            onOpenChange={(_, data) => setOpen(data.open)}>
            <PopoverTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<Filter16Regular />}
                    className={mergeClasses(
                        classes.triggerButton,
                        hasActiveFilters && classes.triggerButtonActive,
                    )}
                    aria-label={loc.filterTooltip}
                />
            </PopoverTrigger>
            <PopoverSurface className={classes.surface}>
                <div className={classes.header}>
                    <div className={classes.headerTitle}>{loc.filterPanelTitle}</div>
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Dismiss12Regular />}
                        className={classes.closeButton}
                        aria-label={locConstants.schemaDesigner.close}
                        onClick={() => setOpen(false)}
                    />
                </div>
                <div className={classes.divider} />
                <div className={classes.section}>
                    <div className={classes.sectionTitle}>{loc.actionTypeLabel}</div>
                    <div className={classes.toggleRow}>
                        <ToggleButton
                            shape="circular"
                            size="small"
                            className={mergeClasses(
                                classes.toggleButton,
                                isActionSelected(ChangeAction.Add) && classes.toggleButtonSelected,
                            )}
                            checked={isActionSelected(ChangeAction.Add)}
                            onClick={() => onToggleAction(ChangeAction.Add)}>
                            {loc.filterAdded}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="small"
                            className={mergeClasses(
                                classes.toggleButton,
                                isActionSelected(ChangeAction.Delete) &&
                                    classes.toggleButtonSelected,
                            )}
                            checked={isActionSelected(ChangeAction.Delete)}
                            onClick={() => onToggleAction(ChangeAction.Delete)}>
                            {loc.filterDeleted}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="small"
                            className={mergeClasses(
                                classes.toggleButton,
                                isActionSelected(ChangeAction.Modify) &&
                                    classes.toggleButtonSelected,
                            )}
                            checked={isActionSelected(ChangeAction.Modify)}
                            onClick={() => onToggleAction(ChangeAction.Modify)}>
                            {loc.filterModified}
                        </ToggleButton>
                    </div>
                </div>
                <div className={classes.divider} />
                <div className={classes.section}>
                    <div className={classes.sectionTitle}>{loc.objectTypeLabel}</div>
                    <div className={classes.toggleRow}>
                        <ToggleButton
                            shape="circular"
                            size="small"
                            className={mergeClasses(
                                classes.toggleButton,
                                isCategorySelected(ChangeCategory.Table) &&
                                    classes.toggleButtonSelected,
                            )}
                            icon={<Table20Regular className={classes.toggleIcon} />}
                            checked={isCategorySelected(ChangeCategory.Table)}
                            onClick={() => onToggleCategory(ChangeCategory.Table)}>
                            {loc.tableCategory}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="small"
                            className={mergeClasses(
                                classes.toggleButton,
                                isCategorySelected(ChangeCategory.Column) &&
                                    classes.toggleButtonSelected,
                            )}
                            icon={<Column20Regular className={classes.toggleIcon} />}
                            checked={isCategorySelected(ChangeCategory.Column)}
                            onClick={() => onToggleCategory(ChangeCategory.Column)}>
                            {loc.columnCategory}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="small"
                            className={mergeClasses(
                                classes.toggleButton,
                                isCategorySelected(ChangeCategory.ForeignKey) &&
                                    classes.toggleButtonSelected,
                            )}
                            icon={<Key20Regular className={classes.toggleIcon} />}
                            checked={isCategorySelected(ChangeCategory.ForeignKey)}
                            onClick={() => onToggleCategory(ChangeCategory.ForeignKey)}>
                            {loc.foreignKeyCategory}
                        </ToggleButton>
                    </div>
                </div>
                <div className={classes.divider} />
                <div className={classes.footer}>
                    <Button
                        size="small"
                        appearance="outline"
                        className={classes.footerButton}
                        disabled={!hasActiveFilters}
                        onClick={onClearFilters}>
                        {loc.clearFiltersButton}
                    </Button>
                    <Button
                        size="small"
                        appearance="primary"
                        className={classes.footerButton}
                        onClick={() => setOpen(false)}>
                        {loc.applyFilters}
                    </Button>
                </div>
            </PopoverSurface>
        </Popover>
    );
};
