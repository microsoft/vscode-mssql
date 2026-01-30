/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReactNode } from "react";
import {
    FlatTree,
    makeStyles,
    mergeClasses,
    Tooltip,
    TreeItem,
    TreeItemLayout,
    HeadlessFlatTreeItemProps,
    Toolbar,
    ToolbarButton,
} from "@fluentui/react-components";
import {
    ArrowUndo16Regular,
    Column20Regular,
    Eye16Regular,
    Key20Regular,
    Table20Regular,
} from "@fluentui/react-icons";
import { ChangeAction, ChangeCategory, SchemaChange, TableChangeGroup } from "./diff/diffUtils";
import { SchemaDesignerChangeDetailsPopover } from "./schemaDesignerChangeDetailsPopover";

export interface FlatTreeItem extends HeadlessFlatTreeItemProps {
    nodeType: "table" | "change";
    tableGroup?: TableChangeGroup;
    change?: SchemaChange;
    tableId: string;
    content: string;
}

type SchemaDesignerChangesTreeProps = {
    flatTree: ReturnType<typeof import("@fluentui/react-components").useHeadlessFlatTree_unstable>;
    flatTreeItems: FlatTreeItem[];
    searchText: string;
    ariaLabel: string;
    loc: {
        revealTooltip: string;
        revertTooltip: string;
        revert: string;
        reveal: string;
    };
    onReveal: (change: SchemaChange) => void;
    onRevert: (change: SchemaChange) => void;
    getCanRevert: (change: SchemaChange) => { canRevert: boolean; reason?: string };
};

const useStyles = makeStyles({
    treeContainer: {
        flex: 1,
        overflow: "auto",
        minHeight: 0,
        minWidth: 0,
        "& .fui-TreeItemLayout": {
            minWidth: 0,
        },
        "& .fui-TreeItemLayout__main": {
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
        },
        "& .fui-TreeItemLayout__main > span": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        "& .fui-TreeItemLayout__actions": {
            opacity: 1,
            visibility: "visible",
        },
    },
    treeItemLayout: {
        fontSize: "12px",
        minWidth: 0,
        color: "var(--vscode-foreground)",
        "& .fui-TreeItemLayout__aside": {
            paddingLeft: 0,
            paddingRight: "5px",
        },
    },
    iconContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    iconAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    iconDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    iconModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    actionBadge: {
        fontSize: "11px",
        fontWeight: 600,
        flexShrink: 0,
    },
    actionBadgeWithBackground: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "16px",
        height: "16px",
        borderRadius: "3px",
        fontSize: "11px",
        fontWeight: 600,
    },
    actionBadgeAddedBg: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 25%, transparent)",
    },
    actionBadgeModifiedBg: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 25%, transparent)",
    },
    actionBadgeDeletedBg: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 25%, transparent)",
    },
    actionBadgeButton: {
        minWidth: "20px",
        height: "auto",
        padding: 0,
        borderRadius: "3px",
        lineHeight: 1,
        backgroundColor: "transparent",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "inherit",
        "&:hover": {
            backgroundColor: "transparent",
        },
        "&:active": {
            backgroundColor: "transparent",
        },
        "&:disabled, &[disabled]": {
            opacity: 1,
            color: "inherit",
            cursor: "default",
        },
        "& .fui-Button__content": {
            fontSize: "11px",
            fontWeight: 600,
            color: "inherit",
        },
        "& .fui-ToolbarButton__content": {
            fontSize: "11px",
            fontWeight: 600,
            color: "inherit",
        },
    },
    actionBadgeButtonWithBg: {
        padding: "2px 4px",
        "&:disabled, &[disabled]": {
            opacity: 1,
            color: "inherit",
            cursor: "default",
        },
    },
    actionBadgeButtonAddedBg: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 25%, transparent)",
        "&:hover": {
            backgroundColor:
                "color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 35%, transparent)",
        },
    },
    actionBadgeButtonModifiedBg: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 25%, transparent)",
        "&:hover": {
            backgroundColor:
                "color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 35%, transparent)",
        },
    },
    actionBadgeButtonDeletedBg: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 25%, transparent)",
        "&:hover": {
            backgroundColor:
                "color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 35%, transparent)",
        },
    },
    changeSummary: {
        display: "flex",
        gap: "4px",
        fontSize: "11px",
        fontWeight: 600,
        alignItems: "center",
    },
    changeSummaryBadge: {
        minWidth: "20px",
        textAlign: "right",
    },
    tableHeaderBase: {
        padding: "2px 0",
    },
    tableHeaderAdded: {
        backgroundImage:
            "linear-gradient(90deg, color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground) 18%, transparent), transparent 70%)",
    },
    tableHeaderDeleted: {
        backgroundImage:
            "linear-gradient(90deg, color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground) 18%, transparent), transparent 70%)",
    },
    tableHeaderModified: {
        backgroundImage:
            "linear-gradient(90deg, color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground) 18%, transparent), transparent 70%)",
    },
    ellipsisText: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        flex: 1,
    },
    searchHighlight: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
    },
});

const highlightMatches = (text: string, searchText: string, highlightClass: string): ReactNode => {
    if (!searchText.trim()) {
        return text;
    }

    const lowerText = text.toLowerCase();
    const lowerSearch = searchText.toLowerCase().trim();
    const parts = lowerText.split(lowerSearch);

    if (parts.length === 1) {
        return text;
    }

    const result: ReactNode[] = [];
    let currentIndex = 0;

    parts.forEach((part, i) => {
        // Add the non-matching part (using original case)
        if (part.length > 0) {
            result.push(text.slice(currentIndex, currentIndex + part.length));
            currentIndex += part.length;
        }

        // Add the matching part (using original case) if not the last segment
        if (i < parts.length - 1) {
            result.push(
                <span key={i} className={highlightClass}>
                    {text.slice(currentIndex, currentIndex + lowerSearch.length)}
                </span>,
            );
            currentIndex += lowerSearch.length;
        }
    });

    return <>{result}</>;
};

export const SchemaDesignerChangesTree = ({
    flatTree,
    flatTreeItems,
    searchText,
    ariaLabel,
    loc,
    onReveal,
    onRevert,
    getCanRevert,
}: SchemaDesignerChangesTreeProps) => {
    const classes = useStyles();

    const renderChangeIcon = (category: ChangeCategory) => {
        switch (category) {
            case ChangeCategory.Table:
                return <Table20Regular />;
            case ChangeCategory.Column:
                return <Column20Regular />;
            case ChangeCategory.ForeignKey:
                return <Key20Regular />;
        }
    };

    const getActionBadge = (action: ChangeAction) => {
        switch (action) {
            case ChangeAction.Add:
                return {
                    letter: "A",
                    className: classes.iconAdded,
                    bgClassName: classes.actionBadgeButtonAddedBg,
                };
            case ChangeAction.Modify:
                return {
                    letter: "M",
                    className: classes.iconModified,
                    bgClassName: classes.actionBadgeButtonModifiedBg,
                };
            case ChangeAction.Delete:
                return {
                    letter: "D",
                    className: classes.iconDeleted,
                    bgClassName: classes.actionBadgeButtonDeletedBg,
                };
        }
    };

    const renderChangeSummary = (group: TableChangeGroup) => {
        const counts = { add: 0, modify: 0, delete: 0 };
        for (const change of group.changes) {
            if (change.action === ChangeAction.Add) counts.add++;
            else if (change.action === ChangeAction.Modify) counts.modify++;
            else if (change.action === ChangeAction.Delete) counts.delete++;
        }
        return (
            <span className={classes.changeSummary}>
                {counts.add > 0 && (
                    <span className={mergeClasses(classes.iconAdded, classes.changeSummaryBadge)}>
                        {counts.add} A
                    </span>
                )}
                {counts.modify > 0 && (
                    <span className={mergeClasses(classes.iconModified, classes.changeSummaryBadge)}>
                        {counts.modify} M
                    </span>
                )}
                {counts.delete > 0 && (
                    <span className={mergeClasses(classes.iconDeleted, classes.changeSummaryBadge)}>
                        {counts.delete} D
                    </span>
                )}
            </span>
        );
    };

    /**
     * Gets the appropriate styling class for a table group based on its change status.
     * Returns both header background and icon color classes.
     */
    const getTableStyles = (group: TableChangeGroup) => {
        if (group.isNew) {
            return { header: classes.tableHeaderAdded, icon: classes.iconAdded };
        }
        if (group.isDeleted) {
            return { header: classes.tableHeaderDeleted, icon: classes.iconDeleted };
        }
        if (group.changes.some((change) => change.action === ChangeAction.Modify)) {
            return { header: classes.tableHeaderModified, icon: classes.iconModified };
        }
        if (group.changes.some((change) => change.action === ChangeAction.Add)) {
            return { header: classes.tableHeaderAdded, icon: classes.iconAdded };
        }
        if (group.changes.some((change) => change.action === ChangeAction.Delete)) {
            return { header: classes.tableHeaderDeleted, icon: classes.iconDeleted };
        }
        return { header: undefined, icon: undefined };
    };

    return (
        <div className={classes.treeContainer}>
            <FlatTree {...flatTree.getTreeProps()} aria-label={ariaLabel}>
                {Array.from(flatTree.items(), (flatTreeItem) => {
                    const { content, ...treeItemProps } = flatTreeItem.getTreeItemProps();
                    const item = flatTreeItems.find((i) => i.value === flatTreeItem.value);

                    if (!item) {
                        return undefined;
                    }

                    if (item.nodeType === "table" && item.tableGroup) {
                        const group = item.tableGroup;
                        const tableStyles = getTableStyles(group);
                        return (
                            <TreeItem key={flatTreeItem.value} {...treeItemProps}>
                                <TreeItemLayout
                                    className={mergeClasses(
                                        classes.treeItemLayout,
                                        classes.tableHeaderBase,
                                        tableStyles.header,
                                    )}
                                    iconBefore={
                                        <span
                                            className={mergeClasses(
                                                classes.iconContainer,
                                                tableStyles.icon,
                                            )}>
                                            <Table20Regular />
                                        </span>
                                    }
                                    aside={renderChangeSummary(group)}>
                                    <Tooltip
                                        content={content as string}
                                        relationship="label"
                                        positioning="above">
                                        <span className={classes.ellipsisText}>
                                            {highlightMatches(
                                                content as string,
                                                searchText,
                                                classes.searchHighlight,
                                            )}
                                        </span>
                                    </Tooltip>
                                </TreeItemLayout>
                            </TreeItem>
                        );
                    }

                    if (item.nodeType === "change" && item.change) {
                        const change = item.change;
                        const actionBadge = getActionBadge(change.action);
                        const revertInfo = getCanRevert(change);
                        return (
                            <TreeItem key={flatTreeItem.value} {...treeItemProps}>
                                <TreeItemLayout
                                    className={mergeClasses(classes.treeItemLayout)}
                                    iconBefore={
                                        <span
                                            className={mergeClasses(
                                                classes.iconContainer,
                                                actionBadge.className,
                                            )}>
                                            {renderChangeIcon(change.category)}
                                        </span>
                                    }
                                    aside={
                                        <Toolbar size="small">
                                            <Tooltip
                                                content={loc.revealTooltip}
                                                relationship="label">
                                                <ToolbarButton
                                                    appearance="subtle"
                                                    aria-label={loc.reveal}
                                                    icon={<Eye16Regular />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onReveal(change);
                                                    }}
                                                />
                                            </Tooltip>
                                            <Tooltip
                                                content={
                                                    revertInfo.canRevert
                                                        ? loc.revertTooltip
                                                        : (revertInfo.reason ?? "")
                                                }
                                                relationship="label">
                                                <ToolbarButton
                                                    appearance="subtle"
                                                    aria-label={loc.revert}
                                                    icon={<ArrowUndo16Regular />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onRevert(change);
                                                    }}
                                                    disabled={!revertInfo.canRevert}
                                                />
                                            </Tooltip>
                                            {change.action === ChangeAction.Modify ? (
                                                <SchemaDesignerChangeDetailsPopover
                                                    change={change}
                                                    title={content as string}
                                                    badgeLetter={actionBadge.letter}
                                                    badgeClassName={mergeClasses(
                                                        classes.actionBadge,
                                                        actionBadge.className,
                                                    )}
                                                    badgeButtonClassName={mergeClasses(
                                                        classes.actionBadgeButton,
                                                        classes.actionBadgeButtonWithBg,
                                                        actionBadge.bgClassName,
                                                    )}
                                                />
                                            ) : (
                                                <ToolbarButton
                                                    appearance="transparent"
                                                    aria-disabled={true}
                                                    aria-label={actionBadge.letter}
                                                    className={mergeClasses(
                                                        classes.actionBadgeButton,
                                                        classes.actionBadge,
                                                        actionBadge.className,
                                                    )}>
                                                    {actionBadge.letter}
                                                </ToolbarButton>
                                            )}
                                        </Toolbar>
                                    }>
                                    <Tooltip
                                        content={content as string}
                                        relationship="label"
                                        positioning="above">
                                        <span className={classes.ellipsisText}>
                                            {highlightMatches(
                                                content as string,
                                                searchText,
                                                classes.searchHighlight,
                                            )}
                                        </span>
                                    </Tooltip>
                                </TreeItemLayout>
                            </TreeItem>
                        );
                    }

                    return undefined;
                })}
            </FlatTree>
        </div>
    );
};
