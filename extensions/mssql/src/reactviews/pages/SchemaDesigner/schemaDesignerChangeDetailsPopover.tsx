/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from "react";
import {
    Button,
    makeStyles,
    mergeClasses,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Text,
    ToolbarButton,
} from "@fluentui/react-components";
import {
    Column20Regular,
    Dismiss12Regular,
    Key20Regular,
    Table20Regular,
} from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { ChangeCategory, type PropertyChange, type SchemaChange } from "./diff/diffUtils";

const useStyles = makeStyles({
    badgeButton: {
        minWidth: "24px",
        height: "24px",
        padding: 0,
        borderRadius: "6px",
    },
    surface: {
        padding: "16px",
        minWidth: "520px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "12px",
        boxShadow: "var(--vscode-widget-shadow)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        marginBottom: "12px",
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minWidth: 0,
    },
    headerIcon: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    headerTitle: {
        fontSize: "16px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
    },
    headerBadge: {
        fontSize: "12px",
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: "8px",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 18%, transparent)",
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
        whiteSpace: "nowrap",
    },
    closeButton: {
        minWidth: "32px",
        height: "32px",
        borderRadius: "8px",
    },
    gridHeader: {
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr 1fr",
        gap: "12px",
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--vscode-descriptionForeground)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        marginBottom: "8px",
    },
    row: {
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr 1fr",
        gap: "12px",
        alignItems: "center",
        padding: "8px 0",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
    },
    propertyName: {
        color: "var(--vscode-foreground)",
        fontSize: "13px",
    },
    valuePill: {
        padding: "4px 10px",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        minHeight: "24px",
        width: "fit-content",
    },
    beforeValue: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 20%, transparent)",
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
        textDecoration: "line-through",
    },
    afterValue: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 20%, transparent)",
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    emptyState: {
        padding: "12px 0",
        color: "var(--vscode-descriptionForeground)",
        fontSize: "12px",
    },
});

type SchemaDesignerChangeDetailsPopoverProps = {
    change: SchemaChange;
    title: string;
    badgeLetter: string;
    badgeClassName: string;
    badgeButtonClassName?: string;
};

const getChangeIcon = (category: ChangeCategory) => {
    switch (category) {
        case ChangeCategory.Table:
            return <Table20Regular />;
        case ChangeCategory.Column:
            return <Column20Regular />;
        case ChangeCategory.ForeignKey:
            return <Key20Regular />;
    }
};

const formatValue = (value: unknown): string => {
    if (value === "") {
        return locConstants.schemaDesigner.changesPanel.emptyValue;
    }
    if (value === undefined || value === null) {
        return locConstants.schemaDesigner.schemaDiff.undefinedValue;
    }
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const getChangeCountLabel = (changes: PropertyChange[]) =>
    locConstants.schemaDesigner.changesPanel.changeCountLabel(changes.length);

export const SchemaDesignerChangeDetailsPopover = ({
    change,
    title,
    badgeLetter,
    badgeClassName,
    badgeButtonClassName,
}: SchemaDesignerChangeDetailsPopoverProps) => {
    const classes = useStyles();
    const [open, setOpen] = useState(false);
    const propertyChanges = change.propertyChanges ?? [];

    const icon = useMemo(() => getChangeIcon(change.category), [change.category]);

    return (
        <Popover
            withArrow
            positioning="below-start"
            open={open}
            onOpenChange={(_, data) => setOpen(data.open)}>
            <PopoverTrigger disableButtonEnhancement>
                <ToolbarButton
                    appearance="transparent"
                    className={mergeClasses(
                        classes.badgeButton,
                        badgeButtonClassName,
                        badgeClassName,
                    )}
                    aria-label={title}>
                    {badgeLetter}
                </ToolbarButton>
            </PopoverTrigger>
            <PopoverSurface className={classes.surface}>
                <div className={classes.header}>
                    <div className={classes.headerLeft}>
                        <span className={classes.headerIcon}>{icon}</span>
                        <Text className={classes.headerTitle}>{title}</Text>
                        <span className={classes.headerBadge}>
                            {getChangeCountLabel(propertyChanges)}
                        </span>
                    </div>
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Dismiss12Regular />}
                        className={classes.closeButton}
                        aria-label={locConstants.schemaDesigner.close}
                        onClick={() => setOpen(false)}
                    />
                </div>

                <div className={classes.gridHeader}>
                    <span>{locConstants.schemaDesigner.changesPanel.propertyHeader}</span>
                    <span>{locConstants.schemaDesigner.changesPanel.beforeHeader}</span>
                    <span>{locConstants.schemaDesigner.changesPanel.afterHeader}</span>
                </div>

                {propertyChanges.length === 0 ? (
                    <div className={classes.emptyState}>
                        {locConstants.schemaDesigner.changesPanel.noPropertyChanges}
                    </div>
                ) : (
                    propertyChanges.map((propertyChange) => (
                        <div key={propertyChange.property} className={classes.row}>
                            <span className={classes.propertyName}>
                                {propertyChange.displayName}
                            </span>
                            <span className={mergeClasses(classes.valuePill, classes.beforeValue)}>
                                {formatValue(propertyChange.oldValue)}
                            </span>
                            <span className={mergeClasses(classes.valuePill, classes.afterValue)}>
                                {formatValue(propertyChange.newValue)}
                            </span>
                        </div>
                    ))
                )}
            </PopoverSurface>
        </Popover>
    );
};
