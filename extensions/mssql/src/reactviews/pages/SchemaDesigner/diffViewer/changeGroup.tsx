/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ChevronRightRegular, TableRegular } from "@fluentui/react-icons";
import * as React from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { ChangeItem } from "./changeItem";
import { DIFF_COLORS } from "./colorConstants";
import { locConstants } from "../../../common/locConstants";

export interface ChangeGroupProps {
    group: SchemaDesigner.ChangeGroup;
    isExpanded?: boolean;
    selectedChangeId?: string;
    onToggle?: (groupId: string, isExpanded: boolean) => void;
    onSelectChange?: (change: SchemaDesigner.SchemaChange) => void;
    onNavigateToChange?: (change: SchemaDesigner.SchemaChange) => void;
    onUndoChange?: (change: SchemaDesigner.SchemaChange) => void;
}

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    header: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "8px",
        cursor: "pointer",
        backgroundColor: "transparent",
        border: "none",
        width: "100%",
        textAlign: "left",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "&:focus-visible": {
            outlineOffset: "-2px",
            outline: "2px solid var(--vscode-focusBorder)",
        },
    },
    headerAddition: {
        borderLeft: `3px solid ${DIFF_COLORS.addition}`,
    },
    headerModification: {
        borderLeft: `3px solid ${DIFF_COLORS.modification}`,
    },
    headerDeletion: {
        borderLeft: `3px solid ${DIFF_COLORS.deletion}`,
    },
    chevron: {
        width: "16px",
        height: "16px",
        marginRight: "8px",
        flexShrink: 0,
        color: tokens.colorNeutralForeground2,
        transition: "transform 0.15s ease-in-out",
    },
    chevronExpanded: {
        transform: "rotate(90deg)",
    },
    tableIcon: {
        width: "16px",
        height: "16px",
        marginRight: "8px",
        flexShrink: 0,
    },
    tableIconAddition: {
        color: DIFF_COLORS.addition,
    },
    tableIconModification: {
        color: DIFF_COLORS.modification,
    },
    tableIconDeletion: {
        color: DIFF_COLORS.deletion,
    },
    tableName: {
        fontWeight: 600,
        fontSize: "13px",
        lineHeight: "20px",
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: "var(--vscode-foreground)",
    },
    changeCount: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground2,
        marginLeft: "8px",
        flexShrink: 0,
    },
    changesList: {
        display: "flex",
        flexDirection: "column",
        paddingLeft: "24px",
    },
    changesListHidden: {
        display: "none",
    },
});

/**
 * Renders a collapsible group of changes for a single table.
 * Shows the table name with aggregate state indicator and
 * a list of individual changes when expanded.
 */
export const ChangeGroup: React.FC<ChangeGroupProps> = ({
    group,
    isExpanded = true,
    selectedChangeId,
    onToggle,
    onSelectChange,
    onNavigateToChange,
    onUndoChange,
}) => {
    const classes = useStyles();

    const handleHeaderClick = React.useCallback(() => {
        onToggle?.(group.tableId, !isExpanded);
    }, [group.tableId, isExpanded, onToggle]);

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle?.(group.tableId, !isExpanded);
            }
        },
        [group.tableId, isExpanded, onToggle],
    );

    const getHeaderBorderClass = () => {
        switch (group.aggregateState) {
            case SchemaDesigner.SchemaChangeType.Addition:
                return classes.headerAddition;
            case SchemaDesigner.SchemaChangeType.Modification:
                return classes.headerModification;
            case SchemaDesigner.SchemaChangeType.Deletion:
                return classes.headerDeletion;
            default:
                return undefined;
        }
    };

    const getTableIconClass = () => {
        switch (group.aggregateState) {
            case SchemaDesigner.SchemaChangeType.Addition:
                return classes.tableIconAddition;
            case SchemaDesigner.SchemaChangeType.Modification:
                return classes.tableIconModification;
            case SchemaDesigner.SchemaChangeType.Deletion:
                return classes.tableIconDeletion;
            default:
                return undefined;
        }
    };

    const getAriaLabel = () => {
        const expandLabel = isExpanded
            ? (locConstants.schemaDesigner.diffViewer?.collapseGroup ?? "Collapse group")
            : (locConstants.schemaDesigner.diffViewer?.expandGroup ?? "Expand group");
        return `${group.tableName}, ${group.changes.length} changes. ${expandLabel}`;
    };

    return (
        <div className={classes.root} role="group" aria-label={group.tableName}>
            <button
                className={mergeClasses(classes.header, getHeaderBorderClass())}
                onClick={handleHeaderClick}
                onKeyDown={handleKeyDown}
                aria-expanded={isExpanded}
                aria-label={getAriaLabel()}>
                <ChevronRightRegular
                    className={mergeClasses(classes.chevron, isExpanded && classes.chevronExpanded)}
                    aria-hidden="true"
                />
                <TableRegular
                    className={mergeClasses(classes.tableIcon, getTableIconClass())}
                    aria-hidden="true"
                />
                <span className={classes.tableName} title={group.tableName}>
                    {group.tableName}
                </span>
                <span className={classes.changeCount}>({group.changes.length})</span>
            </button>
            <div
                className={mergeClasses(
                    classes.changesList,
                    !isExpanded && classes.changesListHidden,
                )}
                role="list"
                aria-hidden={!isExpanded}>
                {group.changes.map((change) => (
                    <ChangeItem
                        key={change.id}
                        change={change}
                        isSelected={change.id === selectedChangeId}
                        onSelect={onSelectChange}
                        onNavigate={onNavigateToChange}
                        onUndo={onUndoChange}
                    />
                ))}
            </div>
        </div>
    );
};

export default ChangeGroup;
