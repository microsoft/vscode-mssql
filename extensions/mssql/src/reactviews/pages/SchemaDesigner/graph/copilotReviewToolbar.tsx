/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from "react";
import { Button, makeStyles, Text, Tooltip } from "@fluentui/react-components";
import {
    CheckmarkCircle16Filled,
    ArrowUndo16Regular,
    ChevronLeft16Regular,
    ChevronRight16Regular,
    Sparkle20Filled,
} from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useCopilotChangesContext } from "../definition/copilot/copilotChangesContext";
import { useSchemaDesignerChangeContext } from "../definition/changes/schemaDesignerChangeContext";

const useStyles = makeStyles({
    toolbar: {
        position: "absolute",
        top: "8px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "8px 16px",
        borderRadius: "6px",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.16)",
        width: "580px",
    },
    iconWrapper: {
        display: "flex",
        alignItems: "center",
        color: "var(--vscode-textLink-foreground)",
        flexShrink: 0,
    },
    textGroup: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        gap: "2px",
    },
    title: {
        fontWeight: 600,
        fontSize: "12px",
        lineHeight: "16px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    subtitle: {
        fontSize: "12px",
        lineHeight: "16px",
        color: "var(--vscode-descriptionForeground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    actions: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexShrink: 0,
    },
    navGroup: {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        flexShrink: 0,
    },
});

/**
 * Floating review toolbar that appears above the flow diagram
 * when the Copilot Changes tab is active and there are tracked changes.
 *
 * Shows: AI icon | "Reviewing AI Suggestion" + "Change X of Y: summary" | Accept | Undo | < | >
 */
export const CopilotReviewToolbar = () => {
    const classes = useStyles();
    const changeContext = useSchemaDesignerChangeContext();
    const {
        trackedChanges,
        acceptTrackedChange,
        undoTrackedChange,
        canUndoTrackedChange,
        revealTrackedChange,
        reviewIndex,
        setReviewIndex,
        reviewNext,
        reviewPrev,
        getChangeSummaryText,
    } = useCopilotChangesContext();

    const [undoing, setUndoing] = useState(false);

    // Only render when copilot highlight override is active and there are changes
    const isActive =
        changeContext.showChangesHighlight &&
        changeContext.acceptChange !== undefined &&
        trackedChanges.length > 0;

    // The review toolbar shows changes in reversed order (most recent first),
    // matching the card list ordering.
    const sourceIndex = trackedChanges.length - 1 - reviewIndex;

    // Reveal the current change on the graph when reviewIndex changes
    useEffect(() => {
        if (!isActive || sourceIndex < 0 || sourceIndex >= trackedChanges.length) {
            return;
        }
        revealTrackedChange(sourceIndex);
    }, [isActive, reviewIndex, sourceIndex, trackedChanges.length, revealTrackedChange]);

    const handleAccept = useCallback(() => {
        if (sourceIndex < 0 || sourceIndex >= trackedChanges.length) {
            return;
        }
        acceptTrackedChange(sourceIndex);
        // After accepting (change removed), clamp the review index
        const nextLength = trackedChanges.length - 1;
        if (nextLength <= 0) {
            setReviewIndex(0);
        } else {
            setReviewIndex(Math.min(reviewIndex, nextLength - 1));
        }
    }, [sourceIndex, trackedChanges.length, acceptTrackedChange, setReviewIndex, reviewIndex]);

    const handleUndo = useCallback(async () => {
        if (sourceIndex < 0 || sourceIndex >= trackedChanges.length) {
            return;
        }
        setUndoing(true);
        try {
            await undoTrackedChange(sourceIndex);
            // After undo (change removed), clamp the review index
            const nextLength = trackedChanges.length - 1;
            if (nextLength <= 0) {
                setReviewIndex(0);
            } else {
                setReviewIndex(Math.min(reviewIndex, nextLength - 1));
            }
        } finally {
            setUndoing(false);
        }
    }, [sourceIndex, trackedChanges.length, undoTrackedChange, setReviewIndex, reviewIndex]);

    if (!isActive) {
        return undefined;
    }

    const total = trackedChanges.length;
    const displayNumber = reviewIndex + 1; // 1-based for display
    const summaryText = getChangeSummaryText(sourceIndex);
    const subtitle = `${locConstants.schemaDesigner.changeNofM(displayNumber, total)}: ${summaryText}`;
    const canUndo = canUndoTrackedChange(sourceIndex) && !undoing;

    return (
        <div className={classes.toolbar}>
            <div className={classes.iconWrapper}>
                <Sparkle20Filled />
            </div>

            <div className={classes.textGroup}>
                <Text className={classes.title}>
                    {locConstants.schemaDesigner.reviewingCopilotChange}
                </Text>
                <Tooltip content={subtitle} relationship="description">
                    <Text className={classes.subtitle}>{subtitle}</Text>
                </Tooltip>
            </div>

            <div className={classes.actions}>
                <Tooltip content={locConstants.schemaDesigner.accept} relationship="label">
                    <Button
                        appearance="primary"
                        size="small"
                        icon={<CheckmarkCircle16Filled />}
                        onClick={handleAccept}>
                        {locConstants.schemaDesigner.accept}
                    </Button>
                </Tooltip>
                <Tooltip content={locConstants.schemaDesigner.undo} relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ArrowUndo16Regular />}
                        disabled={!canUndo}
                        onClick={() => void handleUndo()}>
                        {locConstants.schemaDesigner.undo}
                    </Button>
                </Tooltip>
            </div>

            <div className={classes.navGroup}>
                <Tooltip content={locConstants.common.previous} relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ChevronLeft16Regular />}
                        disabled={reviewIndex <= 0}
                        onClick={reviewPrev}
                    />
                </Tooltip>
                <Tooltip content={locConstants.common.next} relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ChevronRight16Regular />}
                        disabled={reviewIndex >= total - 1}
                        onClick={reviewNext}
                    />
                </Tooltip>
            </div>
        </div>
    );
};
