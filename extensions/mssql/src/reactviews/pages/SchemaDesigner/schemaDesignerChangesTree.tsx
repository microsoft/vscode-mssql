/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ReactNode } from "react";
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
import { ArrowUndo16Regular, Eye16Regular } from "@fluentui/react-icons";
import * as FluentIcons from "@fluentui/react-icons";
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
    tableIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    tableIconAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    tableIconDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    tableIconModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    changeIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    actionBadge: {
        fontSize: "11px",
        fontWeight: 600,
        flexShrink: 0,
    },
    actionBadgeButton: {
        minWidth: "auto",
        height: "auto",
        padding: 0,
        borderRadius: 0,
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
    actionBadgeAdded: {
        color: "var(--vscode-gitDecoration-addedResourceForeground)",
    },
    actionBadgeModified: {
        color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
    },
    actionBadgeDeleted: {
        color: "var(--vscode-gitDecoration-deletedResourceForeground)",
    },
    changeSummary: {
        display: "flex",
        gap: "6px",
        fontSize: "11px",
        fontWeight: 600,
    },
    tableHeaderBase: {
        borderRadius: "6px",
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
    const index = lowerText.indexOf(lowerSearch);

    if (index === -1) {
        return text;
    }

    const before = text.slice(0, index);
    const match = text.slice(index, index + searchText.trim().length);
    const after = text.slice(index + searchText.trim().length);

    return (
        <>
            {before}
            <span className={highlightClass}>{match}</span>
            {highlightMatches(after, searchText, highlightClass)}
        </>
    );
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
}: SchemaDesignerChangesTreeProps): JSX.Element => {
    const classes = useStyles();
    const renderChangeIcon = (change: SchemaChange) => {
        switch (change.category) {
            case ChangeCategory.Table:
                return <FluentIcons.Table20Regular />;
            case ChangeCategory.Column:
                return <FluentIcons.Column20Regular />;
            case ChangeCategory.ForeignKey:
                return <FluentIcons.Key20Regular />;
        }
    };

    const getActionBadge = (change: SchemaChange) => {
        switch (change.action) {
            case ChangeAction.Add:
                return { letter: "A", className: classes.actionBadgeAdded };
            case ChangeAction.Modify:
                return { letter: "M", className: classes.actionBadgeModified };
            case ChangeAction.Delete:
                return { letter: "D", className: classes.actionBadgeDeleted };
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
                {counts.add > 0 && <span className={classes.actionBadgeAdded}>{counts.add} A</span>}
                {counts.modify > 0 && (
                    <span className={classes.actionBadgeModified}>{counts.modify} M</span>
                )}
                {counts.delete > 0 && (
                    <span className={classes.actionBadgeDeleted}>{counts.delete} D</span>
                )}
            </span>
        );
    };

    const getTableHeaderClass = (group: TableChangeGroup) => {
        if (group.isNew) {
            return classes.tableHeaderAdded;
        }
        if (group.isDeleted) {
            return classes.tableHeaderDeleted;
        }
        if (group.changes.some((change) => change.action === ChangeAction.Modify)) {
            return classes.tableHeaderModified;
        }
        if (group.changes.some((change) => change.action === ChangeAction.Add)) {
            return classes.tableHeaderAdded;
        }
        if (group.changes.some((change) => change.action === ChangeAction.Delete)) {
            return classes.tableHeaderDeleted;
        }
        return undefined;
    };

    const getTableIconClass = (group: TableChangeGroup) => {
        if (group.isNew) {
            return classes.tableIconAdded;
        }
        if (group.isDeleted) {
            return classes.tableIconDeleted;
        }
        if (group.changes.some((change) => change.action === ChangeAction.Modify)) {
            return classes.tableIconModified;
        }
        if (group.changes.some((change) => change.action === ChangeAction.Add)) {
            return classes.tableIconAdded;
        }
        if (group.changes.some((change) => change.action === ChangeAction.Delete)) {
            return classes.tableIconDeleted;
        }
        return undefined;
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
                        return (
                            <TreeItem key={flatTreeItem.value} {...treeItemProps}>
                                <TreeItemLayout
                                    className={mergeClasses(
                                        classes.treeItemLayout,
                                        classes.tableHeaderBase,
                                        getTableHeaderClass(group),
                                    )}
                                    iconBefore={
                                        <span
                                            className={mergeClasses(
                                                classes.tableIcon,
                                                getTableIconClass(group),
                                            )}>
                                            <FluentIcons.Table20Regular />
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
                        const actionBadge = getActionBadge(change);
                        const revertInfo = getCanRevert(change);
                        return (
                            <TreeItem key={flatTreeItem.value} {...treeItemProps}>
                                <TreeItemLayout
                                    className={mergeClasses(classes.treeItemLayout)}
                                    iconBefore={
                                        <span
                                            className={mergeClasses(
                                                classes.changeIcon,
                                                actionBadge.className,
                                            )}>
                                            {renderChangeIcon(change)}
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
                                                    badgeButtonClassName={classes.actionBadgeButton}
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
