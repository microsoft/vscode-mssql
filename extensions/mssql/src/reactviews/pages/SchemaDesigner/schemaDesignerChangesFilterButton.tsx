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
import { locConstants } from "../../common/locConstants";
import { ChangeAction, ChangeCategory } from "./diff/diffUtils";

// Static style objects - defined outside component to avoid recreation on each render
const ACTION_CHECKED_STYLES = {
    [ChangeAction.Add]: {
        border: "1px solid var(--vscode-gitDecoration-addedResourceForeground)",
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 20%, transparent)",
    },
    [ChangeAction.Delete]: {
        border: "1px solid var(--vscode-gitDecoration-deletedResourceForeground)",
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 20%, transparent)",
    },
    [ChangeAction.Modify]: {
        border: "1px solid var(--vscode-gitDecoration-modifiedResourceForeground)",
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 20%, transparent)",
    },
} as const;

const OBJECT_CHECKED_STYLE = {
    border: "1px solid var(--vscode-textLink-foreground)",
    color: "var(--vscode-textLink-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 20%, transparent)",
} as const;

const useStyles = makeStyles({
    triggerButton: {
        flexShrink: 0,
    },
    triggerButtonActive: {
        color: "var(--vscode-textLink-foreground)",
    },
    surface: {
        padding: "14px",
        minWidth: "320px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "10px",
        boxShadow: "var(--vscode-widget-shadow)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "10px",
    },
    headerTitle: {
        fontSize: "14px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
    },
    closeButton: {
        minWidth: "32px",
        height: "32px",
        borderRadius: "8px",
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    divider: {
        height: "1px",
        backgroundColor: "var(--vscode-editorWidget-border)",
        opacity: 0.7,
        margin: "8px 0 12px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    sectionTitle: {
        fontSize: "12px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--vscode-descriptionForeground)",
        fontWeight: 600,
    },
    toggleRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        width: "100%",
    },
    toggleButton: {
        borderRadius: "999px",
    },
    footer: {
        display: "flex",
        gap: "10px",
        marginTop: "16px",
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
                            size="medium"
                            className={classes.toggleButton}
                            checked={isActionSelected(ChangeAction.Add)}
                            style={
                                isActionSelected(ChangeAction.Add)
                                    ? ACTION_CHECKED_STYLES[ChangeAction.Add]
                                    : undefined
                            }
                            onClick={() => onToggleAction(ChangeAction.Add)}>
                            {loc.filterAdded}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="medium"
                            className={classes.toggleButton}
                            checked={isActionSelected(ChangeAction.Delete)}
                            style={
                                isActionSelected(ChangeAction.Delete)
                                    ? ACTION_CHECKED_STYLES[ChangeAction.Delete]
                                    : undefined
                            }
                            onClick={() => onToggleAction(ChangeAction.Delete)}>
                            {loc.filterDeleted}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="medium"
                            className={classes.toggleButton}
                            checked={isActionSelected(ChangeAction.Modify)}
                            style={
                                isActionSelected(ChangeAction.Modify)
                                    ? ACTION_CHECKED_STYLES[ChangeAction.Modify]
                                    : undefined
                            }
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
                            size="medium"
                            className={classes.toggleButton}
                            icon={<Table20Regular />}
                            checked={isCategorySelected(ChangeCategory.Table)}
                            style={
                                isCategorySelected(ChangeCategory.Table)
                                    ? OBJECT_CHECKED_STYLE
                                    : undefined
                            }
                            onClick={() => onToggleCategory(ChangeCategory.Table)}>
                            {loc.tableCategory}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="medium"
                            className={classes.toggleButton}
                            icon={<Column20Regular />}
                            checked={isCategorySelected(ChangeCategory.Column)}
                            style={
                                isCategorySelected(ChangeCategory.Column)
                                    ? OBJECT_CHECKED_STYLE
                                    : undefined
                            }
                            onClick={() => onToggleCategory(ChangeCategory.Column)}>
                            {loc.columnCategory}
                        </ToggleButton>
                        <ToggleButton
                            shape="circular"
                            size="medium"
                            className={classes.toggleButton}
                            icon={<Key20Regular />}
                            checked={isCategorySelected(ChangeCategory.ForeignKey)}
                            style={
                                isCategorySelected(ChangeCategory.ForeignKey)
                                    ? OBJECT_CHECKED_STYLE
                                    : undefined
                            }
                            onClick={() => onToggleCategory(ChangeCategory.ForeignKey)}>
                            {loc.foreignKeyCategory}
                        </ToggleButton>
                    </div>
                </div>
                <div className={classes.divider} />
                <div className={classes.footer}>
                    <Button
                        appearance="outline"
                        className={classes.footerButton}
                        disabled={!hasActiveFilters}
                        onClick={onClearFilters}>
                        {loc.clearFiltersButton}
                    </Button>
                    <Button
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
