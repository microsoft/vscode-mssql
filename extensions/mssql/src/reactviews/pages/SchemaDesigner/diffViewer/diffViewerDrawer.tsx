/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    makeStyles,
    mergeClasses,
    Text,
    tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import * as React from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import { ChangesList } from "./changesList";
import { DIFF_COLORS } from "./colorConstants";
import { useDiffViewer } from "./diffViewerContext";
import "./diffViewer.css";

export interface DiffViewerDrawerProps {
    /** Additional CSS class names */
    className?: string;
}

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
        overflow: "hidden",
    },
    hidden: {
        display: "none",
    },
    header: {
        display: "flex",
        flexDirection: "column",
        padding: "8px 12px",
        flexShrink: 0,
        borderBottom: "1px solid var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sideBarSectionHeader-background, transparent)",
    },
    headerTop: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitle: {
        fontWeight: 700,
        fontSize: "11px",
        lineHeight: "16px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--vscode-sideBarSectionHeader-foreground, inherit)",
    },
    closeButton: {
        minWidth: "auto",
        padding: "4px",
    },
    summaryRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "12px",
        marginTop: "6px",
    },
    summaryItem: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "4px",
        fontSize: "12px",
        color: tokens.colorNeutralForeground2,
    },
    summaryDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
    },
    additionDot: {
        backgroundColor: DIFF_COLORS.addition,
    },
    modificationDot: {
        backgroundColor: DIFF_COLORS.modification,
    },
    deletionDot: {
        backgroundColor: DIFF_COLORS.deletion,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        overflow: "hidden",
    },
    resizeHandle: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        cursor: "ew-resize",
        backgroundColor: "transparent",
        "&:hover": {
            backgroundColor: tokens.colorBrandBackground,
        },
    },
    resizing: {
        backgroundColor: tokens.colorBrandBackground,
    },
});

/**
 * A non-modal inline drawer that displays schema changes.
 * Positioned on the right side of the canvas.
 */
export const DiffViewerDrawer: React.FC<DiffViewerDrawerProps> = ({ className }) => {
    const classes = useStyles();
    const {
        state,
        toggleDrawer,
        setDrawerWidth,
        selectChange,
        toggleGroupExpansion,
        navigateToElement,
        undoChange,
    } = useDiffViewer();

    const [isResizing, setIsResizing] = React.useState(false);
    // eslint-disable-next-line no-restricted-syntax -- React ref requires null, not undefined
    const drawerRef = React.useRef<HTMLDivElement>(null);

    // Handle resize logic
    const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    React.useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!drawerRef.current) return;

            const containerRect = drawerRef.current.parentElement?.getBoundingClientRect();
            if (!containerRect) return;

            const newWidth = containerRect.right - e.clientX;
            // Clamp to min 200px and max 50% of container
            const maxWidth = containerRect.width * 0.5;
            const clampedWidth = Math.max(200, Math.min(newWidth, maxWidth));
            setDrawerWidth(clampedWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isResizing, setDrawerWidth]);

    const handleClose = React.useCallback(() => {
        toggleDrawer();
    }, [toggleDrawer]);

    const handleSelectChange = React.useCallback(
        (change: SchemaDesigner.SchemaChange) => {
            selectChange(change.id);
        },
        [selectChange],
    );

    const handleNavigate = React.useCallback(
        (change: SchemaDesigner.SchemaChange) => {
            navigateToElement(change);
        },
        [navigateToElement],
    );

    const handleUndo = React.useCallback(
        (change: SchemaDesigner.SchemaChange) => {
            undoChange(change);
        },
        [undoChange],
    );

    const handleToggleGroup = React.useCallback(
        (groupId: string, _isExpanded: boolean) => {
            toggleGroupExpansion(groupId);
        },
        [toggleGroupExpansion],
    );

    // Calculate expanded groups set from change groups
    const expandedGroups = React.useMemo(() => {
        const expanded = new Set<string>();
        for (const group of state.changeGroups) {
            if (group.isExpanded) {
                expanded.add(group.tableId);
            }
        }
        return expanded;
    }, [state.changeGroups]);

    const diffViewer = locConstants.schemaDesigner.diffViewer;

    return (
        <div
            ref={drawerRef}
            className={mergeClasses(classes.root, !state.isDrawerOpen && classes.hidden, className)}
            style={{ width: `${state.drawerWidth}px` }}
            role="complementary"
            aria-label={diffViewer?.schemaChanges ?? "Schema Changes"}
            aria-hidden={!state.isDrawerOpen}>
            {/* Resize handle */}
            <div
                className={mergeClasses(classes.resizeHandle, isResizing && classes.resizing)}
                onMouseDown={handleResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize drawer"
            />

            {/* Header */}
            <div className={classes.header}>
                <div className={classes.headerTop}>
                    <Text className={classes.headerTitle}>
                        {diffViewer?.schemaChanges ?? "Schema Changes"}
                    </Text>
                    <Button
                        className={classes.closeButton}
                        appearance="subtle"
                        icon={<DismissRegular />}
                        onClick={handleClose}
                        aria-label={locConstants.common.close}
                    />
                </div>

                {/* Summary counts */}
                {state.changeCounts && state.changeCounts.total > 0 && (
                    <div className={classes.summaryRow}>
                        {state.changeCounts.additions > 0 && (
                            <div className={classes.summaryItem}>
                                <div
                                    className={mergeClasses(
                                        classes.summaryDot,
                                        classes.additionDot,
                                    )}
                                />
                                <span>
                                    {state.changeCounts.additions}{" "}
                                    {diffViewer?.additions ?? "Additions"}
                                </span>
                            </div>
                        )}
                        {state.changeCounts.modifications > 0 && (
                            <div className={classes.summaryItem}>
                                <div
                                    className={mergeClasses(
                                        classes.summaryDot,
                                        classes.modificationDot,
                                    )}
                                />
                                <span>
                                    {state.changeCounts.modifications}{" "}
                                    {diffViewer?.modifications ?? "Modifications"}
                                </span>
                            </div>
                        )}
                        {state.changeCounts.deletions > 0 && (
                            <div className={classes.summaryItem}>
                                <div
                                    className={mergeClasses(
                                        classes.summaryDot,
                                        classes.deletionDot,
                                    )}
                                />
                                <span>
                                    {state.changeCounts.deletions}{" "}
                                    {diffViewer?.deletions ?? "Deletions"}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <Divider />

            {/* Body - Changes list */}
            <div className={classes.body}>
                <ChangesList
                    groups={state.changeGroups}
                    expandedGroups={expandedGroups}
                    selectedChangeId={state.selectedChangeId ?? undefined}
                    onToggleGroup={handleToggleGroup}
                    onSelectChange={handleSelectChange}
                    onNavigateToChange={handleNavigate}
                    onUndoChange={handleUndo}
                />
            </div>
        </div>
    );
};

export default DiffViewerDrawer;
