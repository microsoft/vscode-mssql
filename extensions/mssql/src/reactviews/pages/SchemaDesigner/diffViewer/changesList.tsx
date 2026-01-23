/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens, Text } from "@fluentui/react-components";
import { CheckmarkCircleRegular } from "@fluentui/react-icons";
import * as React from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { ChangeGroup } from "./changeGroup";
import { locConstants } from "../../../common/locConstants";

export interface ChangesListProps {
    groups: SchemaDesigner.ChangeGroup[];
    expandedGroups?: Set<string>;
    selectedChangeId?: string;
    onToggleGroup?: (groupId: string, isExpanded: boolean) => void;
    onSelectChange?: (change: SchemaDesigner.SchemaChange) => void;
    onNavigateToChange?: (change: SchemaDesigner.SchemaChange) => void;
    onUndoChange?: (change: SchemaDesigner.SchemaChange) => void;
}

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        justifyContent: "flex-start",
        alignItems: "stretch",
        overflowY: "auto",
        overflowX: "hidden",
        minHeight: 0,
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "24px",
        textAlign: "center",
        color: tokens.colorNeutralForeground2,
    },
    emptyIcon: {
        width: "48px",
        height: "48px",
        marginBottom: "16px",
        color: tokens.colorNeutralForeground3,
    },
    emptyText: {
        fontSize: "14px",
        lineHeight: "20px",
    },
    groupsList: {
        display: "flex",
        flexDirection: "column",
    },
});

/**
 * Renders a list of change groups with empty state handling.
 * Each group represents changes to a single table.
 */
export const ChangesList: React.FC<ChangesListProps> = ({
    groups,
    expandedGroups,
    selectedChangeId,
    onToggleGroup,
    onSelectChange,
    onNavigateToChange,
    onUndoChange,
}) => {
    const classes = useStyles();

    // By default, all groups are expanded
    const isGroupExpanded = React.useCallback(
        (groupId: string): boolean => {
            if (expandedGroups === undefined) {
                return true;
            }
            return expandedGroups.has(groupId);
        },
        [expandedGroups],
    );

    // Handle keyboard navigation within the list
    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            if (!groups.length) return;

            const allChanges = groups.flatMap((g) => g.changes);
            if (!allChanges.length) return;

            const currentIndex = selectedChangeId
                ? allChanges.findIndex((c) => c.id === selectedChangeId)
                : -1;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    if (currentIndex < allChanges.length - 1) {
                        onSelectChange?.(allChanges[currentIndex + 1]);
                    } else if (currentIndex === -1 && allChanges.length > 0) {
                        onSelectChange?.(allChanges[0]);
                    }
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    if (currentIndex > 0) {
                        onSelectChange?.(allChanges[currentIndex - 1]);
                    }
                    break;
                case "Enter":
                    if (selectedChangeId) {
                        const selectedChange = allChanges.find((c) => c.id === selectedChangeId);
                        if (selectedChange) {
                            onNavigateToChange?.(selectedChange);
                        }
                    }
                    break;
                case "Delete":
                    if (selectedChangeId) {
                        const selectedChange = allChanges.find((c) => c.id === selectedChangeId);
                        if (selectedChange) {
                            onUndoChange?.(selectedChange);
                        }
                    }
                    break;
            }
        },
        [groups, selectedChangeId, onSelectChange, onNavigateToChange, onUndoChange],
    );

    if (groups.length === 0) {
        return (
            <div className={classes.emptyState} role="status" aria-live="polite">
                <CheckmarkCircleRegular
                    className={`${classes.emptyIcon} diff-viewer-empty-icon`}
                    aria-hidden="true"
                />
                <Text className={classes.emptyText}>
                    {locConstants.schemaDesigner.diffViewer?.noPendingChanges ??
                        "No pending changes"}
                </Text>
            </div>
        );
    }

    return (
        <div
            className={classes.root}
            role="list"
            aria-label={locConstants.schemaDesigner.diffViewer?.schemaChanges ?? "Schema Changes"}
            onKeyDown={handleKeyDown}>
            <div className={classes.groupsList}>
                {groups.map((group) => (
                    <ChangeGroup
                        key={group.tableId}
                        group={group}
                        isExpanded={isGroupExpanded(group.tableId)}
                        selectedChangeId={selectedChangeId}
                        onToggle={onToggleGroup}
                        onSelectChange={onSelectChange}
                        onNavigateToChange={onNavigateToChange}
                        onUndoChange={onUndoChange}
                    />
                ))}
            </div>
        </div>
    );
};

export default ChangesList;
