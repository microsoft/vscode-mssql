/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, mergeClasses, tokens, Text } from "@fluentui/react-components";
import {
    AddRegular,
    DeleteRegular,
    EditRegular,
    ArrowUndoRegular,
    ChevronDownRegular,
    ChevronRightRegular,
    EyeRegular,
} from "@fluentui/react-icons";
import * as React from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import { DIFF_COLORS } from "./colorConstants";

export interface ChangeItemProps {
    change: SchemaDesigner.SchemaChange;
    isSelected?: boolean;
    onSelect?: (change: SchemaDesigner.SchemaChange) => void;
    onNavigate?: (change: SchemaDesigner.SchemaChange) => void;
    onUndo?: (change: SchemaDesigner.SchemaChange) => void;
}

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        borderLeft: "3px solid transparent",
        backgroundColor: "transparent",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "&:focus": {
            outline: "1px solid var(--vscode-focusBorder)",
            outlineOffset: "-1px",
        },
        "&:focus-visible": {
            outline: "1px solid var(--vscode-focusBorder)",
            outlineOffset: "-1px",
        },
    },
    mainRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "6px 8px",
    },
    selected: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
    },
    addition: {
        borderLeftColor: DIFF_COLORS.addition,
    },
    modification: {
        borderLeftColor: DIFF_COLORS.modification,
    },
    deletion: {
        borderLeftColor: DIFF_COLORS.deletion,
    },
    expandIcon: {
        width: "12px",
        height: "12px",
        marginRight: "4px",
        flexShrink: 0,
        color: tokens.colorNeutralForeground2,
    },
    icon: {
        width: "16px",
        height: "16px",
        marginRight: "8px",
        flexShrink: 0,
    },
    iconAddition: {
        color: DIFF_COLORS.addition,
    },
    iconModification: {
        color: DIFF_COLORS.modification,
    },
    iconDeletion: {
        color: DIFF_COLORS.deletion,
    },
    content: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        overflow: "hidden",
    },
    entityName: {
        fontWeight: 600,
        fontSize: "13px",
        lineHeight: "18px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: "var(--vscode-foreground)",
    },
    description: {
        fontSize: "12px",
        lineHeight: "16px",
        color: tokens.colorNeutralForeground2,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    undoButton: {
        marginLeft: "8px",
        flexShrink: 0,
        minWidth: "auto",
        padding: "4px",
    },
    revealButton: {
        marginLeft: "4px",
        flexShrink: 0,
        minWidth: "auto",
        padding: "4px",
    },
    detailsPane: {
        padding: "4px 8px 8px 32px",
        backgroundColor: tokens.colorNeutralBackground2,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    detailRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        fontSize: "12px",
        lineHeight: "16px",
        marginBottom: "4px",
        "&:last-child": {
            marginBottom: 0,
        },
    },
    detailLabel: {
        fontWeight: 500,
        minWidth: "60px",
        marginRight: "8px",
        color: tokens.colorNeutralForeground2,
    },
    oldValue: {
        color: DIFF_COLORS.deletion,
        textDecoration: "line-through",
        marginRight: "8px",
    },
    newValue: {
        color: DIFF_COLORS.addition,
    },
    arrow: {
        color: tokens.colorNeutralForeground3,
        margin: "0 6px",
    },
});

/**
 * Renders an individual change item showing the change type icon,
 * entity name, description, and optional undo button.
 */
export const ChangeItem: React.FC<ChangeItemProps> = ({
    change,
    isSelected = false,
    onSelect,
    onNavigate,
    onUndo,
}) => {
    const classes = useStyles();

    const handleClick = React.useCallback(() => {
        onSelect?.(change);
    }, [change, onSelect]);

    const handleDoubleClick = React.useCallback(() => {
        onNavigate?.(change);
    }, [change, onNavigate]);

    const handleUndo = React.useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onUndo?.(change);
        },
        [change, onUndo],
    );

    const handleReveal = React.useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onNavigate?.(change);
        },
        [change, onNavigate],
    );

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                onNavigate?.(change);
            }
        },
        [change, onNavigate],
    );

    const getChangeTypeIcon = () => {
        switch (change.changeType) {
            case SchemaDesigner.SchemaChangeType.Addition:
                return (
                    <AddRegular
                        className={mergeClasses(classes.icon, classes.iconAddition)}
                        aria-hidden="true"
                    />
                );
            case SchemaDesigner.SchemaChangeType.Modification:
                return (
                    <EditRegular
                        className={mergeClasses(classes.icon, classes.iconModification)}
                        aria-hidden="true"
                    />
                );
            case SchemaDesigner.SchemaChangeType.Deletion:
                return (
                    <DeleteRegular
                        className={mergeClasses(classes.icon, classes.iconDeletion)}
                        aria-hidden="true"
                    />
                );
            default:
                return <></>;
        }
    };

    const getBorderClass = () => {
        switch (change.changeType) {
            case SchemaDesigner.SchemaChangeType.Addition:
                return classes.addition;
            case SchemaDesigner.SchemaChangeType.Modification:
                return classes.modification;
            case SchemaDesigner.SchemaChangeType.Deletion:
                return classes.deletion;
            default:
                return undefined;
        }
    };

    const getAriaLabel = () => {
        const typeLabel = getChangeTypeLabel();
        return `${typeLabel}: ${change.entityName}. ${change.description}`;
    };

    const getChangeTypeLabel = () => {
        switch (change.changeType) {
            case SchemaDesigner.SchemaChangeType.Addition:
                return locConstants.schemaDesigner.diffViewer?.added ?? "Added";
            case SchemaDesigner.SchemaChangeType.Modification:
                return locConstants.schemaDesigner.diffViewer?.modified ?? "Modified";
            case SchemaDesigner.SchemaChangeType.Deletion:
                return locConstants.schemaDesigner.diffViewer?.deleted ?? "Deleted";
            default:
                return "";
        }
    };

    // Check if this is a modification that has details to show
    const hasDetails =
        change.changeType === SchemaDesigner.SchemaChangeType.Modification &&
        change.previousValue &&
        change.currentValue;

    // State for expanded details
    const [isExpanded, setIsExpanded] = React.useState(false);

    const handleToggleExpand = React.useCallback(
        (e: React.MouseEvent) => {
            if (hasDetails) {
                e.stopPropagation();
                setIsExpanded((prev) => !prev);
            }
        },
        [hasDetails],
    );

    /**
     * Extract property differences between old and new values
     */
    const getModificationDetails = (): Array<{
        property: string;
        oldValue: string;
        newValue: string;
    }> => {
        if (!change.previousValue || !change.currentValue) {
            return [];
        }

        const details: Array<{ property: string; oldValue: string; newValue: string }> = [];
        const prev = change.previousValue as Record<string, unknown>;
        const curr = change.currentValue as Record<string, unknown>;

        // Compare relevant properties based on entity type
        const propertiesToCompare = getPropertiesToCompare();

        for (const prop of propertiesToCompare) {
            const oldVal = formatValue(prev[prop]);
            const newVal = formatValue(curr[prop]);
            if (oldVal !== newVal) {
                details.push({
                    property: formatPropertyName(prop),
                    oldValue: oldVal,
                    newValue: newVal,
                });
            }
        }

        return details;
    };

    const getPropertiesToCompare = (): string[] => {
        switch (change.entityType) {
            case SchemaDesigner.SchemaEntityType.Column:
                return [
                    "name",
                    "dataType",
                    "maxLength",
                    "precision",
                    "scale",
                    "isNullable",
                    "isPrimaryKey",
                    "defaultValue",
                    "isIdentity",
                    "identitySeed",
                    "identityIncrement",
                    "isComputed",
                    "computedFormula",
                    "computedPersisted",
                ];
            case SchemaDesigner.SchemaEntityType.ForeignKey:
                return [
                    "name",
                    "referencedTableName",
                    "referencedSchemaName",
                    "onDeleteAction",
                    "onUpdateAction",
                ];
            case SchemaDesigner.SchemaEntityType.Table:
                return ["name", "schema"];
            default:
                return [];
        }
    };

    const formatPropertyName = (prop: string): string => {
        // Convert camelCase to Title Case with spaces
        return prop
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (str) => str.toUpperCase())
            .trim();
    };

    const formatValue = (value: unknown): string => {
        if (value === undefined || value === "") {
            return "(empty)";
        }
        if (typeof value === "boolean") {
            return value ? "Yes" : "No";
        }
        return String(value);
    };

    const modificationDetails = hasDetails ? getModificationDetails() : [];

    return (
        <div
            className={mergeClasses(classes.root, getBorderClass(), isSelected && classes.selected)}
            tabIndex={0}
            role="listitem"
            aria-label={getAriaLabel()}
            aria-selected={isSelected}
            aria-expanded={hasDetails ? isExpanded : undefined}>
            {/* Main row */}
            <div
                className={classes.mainRow}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}>
                {/* Expand/collapse icon for modifications */}
                {hasDetails && modificationDetails.length > 0 ? (
                    <div onClick={handleToggleExpand} style={{ cursor: "pointer" }}>
                        {isExpanded ? (
                            <ChevronDownRegular className={classes.expandIcon} aria-hidden="true" />
                        ) : (
                            <ChevronRightRegular
                                className={classes.expandIcon}
                                aria-hidden="true"
                            />
                        )}
                    </div>
                ) : (
                    <div style={{ width: "16px" }} /> // Spacer for alignment
                )}
                {getChangeTypeIcon()}
                <div className={classes.content}>
                    <span className={classes.entityName} title={change.entityName}>
                        {change.entityName}
                    </span>
                    {change.description && (
                        <span className={classes.description} title={change.description}>
                            {change.description}
                        </span>
                    )}
                </div>
                {onNavigate && (
                    <Button
                        className={classes.revealButton}
                        appearance="subtle"
                        icon={<EyeRegular />}
                        onClick={handleReveal}
                        title={
                            locConstants.schemaDesigner.diffViewer?.revealInCanvas ??
                            "Reveal in canvas"
                        }
                        aria-label={`${locConstants.schemaDesigner.diffViewer?.revealInCanvas ?? "Reveal in canvas"}: ${change.entityName}`}
                    />
                )}
                {onUndo && (
                    <Button
                        className={classes.undoButton}
                        appearance="subtle"
                        icon={<ArrowUndoRegular />}
                        onClick={handleUndo}
                        title={locConstants.schemaDesigner.diffViewer?.undoChange ?? "Undo change"}
                        aria-label={`${locConstants.schemaDesigner.diffViewer?.undoChange ?? "Undo change"}: ${change.entityName}`}
                    />
                )}
            </div>

            {/* Expanded details pane for modifications */}
            {isExpanded && modificationDetails.length > 0 && (
                <div className={classes.detailsPane}>
                    {modificationDetails.map((detail, index) => (
                        <div key={index} className={classes.detailRow}>
                            <Text className={classes.detailLabel}>{detail.property}:</Text>
                            <Text className={classes.oldValue}>{detail.oldValue}</Text>
                            <Text className={classes.arrow}>→</Text>
                            <Text className={classes.newValue}>{detail.newValue}</Text>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ChangeItem;
