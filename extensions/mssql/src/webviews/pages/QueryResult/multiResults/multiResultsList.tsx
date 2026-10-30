/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    mergeClasses,
    type PositioningVirtualElement,
    Spinner,
    Text,
} from "@fluentui/react-components";
import { Dismiss16Regular, ErrorCircle16Regular, Table16Regular } from "@fluentui/react-icons";
import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MultiResultsGroup, MultiResultsState } from "../../../../sharedInterfaces/multiResults";
import { locConstants } from "../../../common/locConstants";
import {
    getDroppedMultiResult,
    getNewGroupTarget,
    isMultiResultDrag,
    startMultiResultDrag,
    useMultiResultsActions,
} from "./multiResultsActions";

/** Static class name so the item's hover and focus styles can reveal its close button. */
const CLOSE_BUTTON_CLASS = "multi-results-list-close";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        boxSizing: "border-box",
        paddingTop: "2px",
        outline: "none",
    },
    item: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexShrink: 0,
        height: "22px",
        paddingLeft: "6px",
        paddingRight: "2px",
        cursor: "pointer",
        userSelect: "none",
        outline: "none",
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        [`:hover .${CLOSE_BUTTON_CLASS}`]: {
            visibility: "visible",
        },
        [`:focus-within .${CLOSE_BUTTON_CLASS}`]: {
            visibility: "visible",
        },
        ":focus-visible": {
            outline: "1px solid var(--vscode-focusBorder)",
            outlineOffset: "-1px",
        },
    },
    itemSelected: {
        backgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
        color: "var(--vscode-list-inactiveSelectionForeground)",
        [`& .${CLOSE_BUTTON_CLASS}`]: {
            visibility: "visible",
        },
    },
    itemDropTarget: {
        backgroundColor: "var(--vscode-list-dropBackground)",
    },
    treeLine: {
        width: "10px",
        flexShrink: 0,
        fontFamily: "var(--vscode-editor-font-family)",
        color: "var(--vscode-tree-indentGuidesStroke)",
        textAlign: "center",
    },
    icon: {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
    },
    errorIcon: {
        color: "var(--vscode-errorForeground)",
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: "13px",
    },
    closedTitle: {
        fontStyle: "italic",
        color: "var(--vscode-descriptionForeground)",
    },
    count: {
        flexShrink: 0,
        minWidth: "8px",
        paddingLeft: "5px",
        paddingRight: "5px",
        borderRadius: "8px",
        fontSize: "11px",
        lineHeight: "16px",
        textAlign: "center",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
    },
    closeButton: {
        visibility: "hidden",
        minWidth: "20px",
        width: "20px",
        height: "20px",
    },
    dropTail: {
        flex: 1,
        minHeight: "24px",
        borderTop: "2px solid transparent",
    },
    dropTailActive: {
        borderTopColor: "var(--vscode-focusBorder)",
    },
});

interface ListItem {
    uri: string;
    group: MultiResultsGroup;
    indexInGroup: number;
}

function getTreeLine(item: ListItem): string {
    const size = item.group.uris.length;
    if (size === 1) {
        return "";
    }
    if (item.indexInGroup === 0) {
        return "┌";
    }
    return item.indexInGroup === size - 1 ? "└" : "├";
}

function getPointTarget(x: number, y: number): PositioningVirtualElement {
    return {
        getBoundingClientRect: () =>
            ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }) as DOMRect,
    };
}

interface MultiResultsListProps {
    state: MultiResultsState;
}

export const MultiResultsList = ({ state }: MultiResultsListProps) => {
    const classes = useStyles();
    const actions = useMultiResultsActions();
    const { entries, groups, activeGroupId } = state;
    const items: ListItem[] = groups.flatMap((group) =>
        group.uris.map((uri, indexInGroup) => ({ uri, group, indexInGroup })),
    );
    const activeGroup = groups.find((group) => group.id === activeGroupId);
    const selectedUri = activeGroup?.focusedUri;

    const itemRefs = useRef(new Map<string, HTMLDivElement>());
    // The item that is tabbable; arrow keys move it.
    const [tabStopUri, setTabStopUri] = useState<string | undefined>(selectedUri);
    const [dropTargetUri, setDropTargetUri] = useState<string | undefined>(undefined);
    const [isDropOnTail, setIsDropOnTail] = useState(false);
    const [contextMenu, setContextMenu] = useState<
        { uri: string; target: HTMLElement | PositioningVirtualElement } | undefined
    >(undefined);

    useEffect(() => {
        setTabStopUri(selectedUri);
    }, [selectedUri]);

    useEffect(() => {
        const clearDropTargets = () => {
            setDropTargetUri(undefined);
            setIsDropOnTail(false);
        };
        window.addEventListener("dragend", clearDropTargets);
        window.addEventListener("drop", clearDropTargets);
        return () => {
            window.removeEventListener("dragend", clearDropTargets);
            window.removeEventListener("drop", clearDropTargets);
        };
    }, []);

    const effectiveTabStop = items.some((item) => item.uri === tabStopUri)
        ? tabStopUri
        : items[0]?.uri;

    const focusItem = (index: number) => {
        const item = items[Math.max(0, Math.min(index, items.length - 1))];
        if (item) {
            setTabStopUri(item.uri);
            itemRefs.current.get(item.uri)?.focus();
        }
    };

    const onItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
        const item = items[index];
        let handled = true;
        switch (event.key) {
            case "ArrowDown":
                focusItem(index + 1);
                break;
            case "ArrowUp":
                focusItem(index - 1);
                break;
            case "Home":
                focusItem(0);
                break;
            case "End":
                focusItem(items.length - 1);
                break;
            case "Enter":
            case " ":
                actions.focus(item.uri);
                break;
            case "Delete":
                actions.close(item.uri);
                break;
            case "ContextMenu":
                setContextMenu({ uri: item.uri, target: event.currentTarget });
                break;
            case "F10":
                if (event.shiftKey) {
                    setContextMenu({ uri: item.uri, target: event.currentTarget });
                } else {
                    handled = false;
                }
                break;
            default:
                handled = false;
        }
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const onItemDragOver = (event: DragEvent<HTMLDivElement>, uri: string) => {
        if (!isMultiResultDrag(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTargetUri(uri);
    };

    const onItemDragLeave = (event: DragEvent<HTMLDivElement>, uri: string) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTargetUri((current) => (current === uri ? undefined : current));
        }
    };

    // Dropping a result on another one splits it with that result.
    const onItemDrop = (event: DragEvent<HTMLDivElement>, item: ListItem) => {
        const droppedUri = getDroppedMultiResult(event);
        setDropTargetUri(undefined);
        if (!droppedUri) {
            return;
        }
        event.preventDefault();
        if (droppedUri !== item.uri) {
            actions.move(droppedUri, {
                kind: "joinGroup",
                groupId: item.group.id,
                index: item.indexInGroup + 1,
            });
        }
    };

    // Dropping a result below the list puts it in a group of its own at the end.
    const onTailDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!isMultiResultDrag(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setIsDropOnTail(true);
    };

    const onTailDrop = (event: DragEvent<HTMLDivElement>) => {
        const droppedUri = getDroppedMultiResult(event);
        setIsDropOnTail(false);
        if (!droppedUri) {
            return;
        }
        event.preventDefault();
        actions.move(droppedUri, { kind: "newGroup", index: groups.length });
    };

    const getGroupLabel = (group: MultiResultsGroup) =>
        group.uris.map((uri) => entries[uri]?.title ?? uri).join(", ");

    const menuItem = items.find((item) => item.uri === contextMenu?.uri);
    const otherGroups = menuItem ? groups.filter((group) => group !== menuItem.group) : [];

    return (
        <div
            className={classes.root}
            role="listbox"
            aria-label={locConstants.multiResults.resultsList}>
            {items.map((item, index) => {
                const entry = entries[item.uri];
                const title = entry?.title ?? item.uri;
                const displayTitle = entry?.isDocumentClosed
                    ? locConstants.multiResults.closedEditorTitle(title)
                    : title;
                const isSelected = item.uri === selectedUri;
                return (
                    <div
                        key={item.uri}
                        ref={(element) => {
                            if (element) {
                                itemRefs.current.set(item.uri, element);
                            } else {
                                itemRefs.current.delete(item.uri);
                            }
                        }}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={item.uri === effectiveTabStop ? 0 : -1}
                        title={
                            entry?.isDocumentClosed
                                ? locConstants.multiResults.closedEditorTooltip
                                : item.uri
                        }
                        className={mergeClasses(
                            classes.item,
                            isSelected && classes.itemSelected,
                            dropTargetUri === item.uri && classes.itemDropTarget,
                        )}
                        draggable
                        onDragStart={(event) => startMultiResultDrag(event, item.uri)}
                        onDragOver={(event) => onItemDragOver(event, item.uri)}
                        onDragLeave={(event) => onItemDragLeave(event, item.uri)}
                        onDrop={(event) => onItemDrop(event, item)}
                        onClick={() => {
                            setTabStopUri(item.uri);
                            actions.focus(item.uri);
                        }}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            setContextMenu({
                                uri: item.uri,
                                target: getPointTarget(event.clientX, event.clientY),
                            });
                        }}
                        onKeyDown={(event) => onItemKeyDown(event, index)}>
                        <span className={classes.treeLine} aria-hidden>
                            {getTreeLine(item)}
                        </span>
                        <span className={classes.icon}>
                            {entry?.isExecuting ? (
                                <Spinner
                                    size="extra-tiny"
                                    aria-label={locConstants.multiResults.running}
                                />
                            ) : entry?.hasError ? (
                                <ErrorCircle16Regular
                                    className={classes.errorIcon}
                                    aria-label={locConstants.multiResults.hasErrors}
                                />
                            ) : (
                                <Table16Regular aria-hidden />
                            )}
                        </span>
                        <Text
                            truncate
                            wrap={false}
                            className={mergeClasses(
                                classes.title,
                                entry?.isDocumentClosed && classes.closedTitle,
                            )}>
                            {displayTitle}
                        </Text>
                        {(entry?.resultSetCount ?? 0) > 0 && (
                            <span
                                className={classes.count}
                                title={locConstants.multiResults.resultSetCount(
                                    entry.resultSetCount,
                                )}>
                                {entry.resultSetCount}
                            </span>
                        )}
                        <Button
                            className={mergeClasses(classes.closeButton, CLOSE_BUTTON_CLASS)}
                            appearance="subtle"
                            size="small"
                            tabIndex={-1}
                            icon={<Dismiss16Regular />}
                            title={locConstants.multiResults.closeResults}
                            aria-label={locConstants.multiResults.closeResults}
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.close(item.uri);
                            }}
                        />
                    </div>
                );
            })}
            <div
                className={mergeClasses(classes.dropTail, isDropOnTail && classes.dropTailActive)}
                aria-hidden
                onDragOver={onTailDragOver}
                onDragLeave={() => setIsDropOnTail(false)}
                onDrop={onTailDrop}
            />
            <Menu
                open={contextMenu !== undefined && menuItem !== undefined}
                onOpenChange={(_event, data) => {
                    if (!data.open) {
                        setContextMenu(undefined);
                    }
                }}
                positioning={{ target: contextMenu?.target }}>
                <MenuPopover
                    aria-label={
                        menuItem
                            ? locConstants.multiResults.resultActions(
                                  entries[menuItem.uri]?.title ?? menuItem.uri,
                              )
                            : undefined
                    }>
                    {menuItem && (
                        <MenuList>
                            {otherGroups.length > 0 && (
                                <Menu>
                                    <MenuTrigger disableButtonEnhancement>
                                        <MenuItem>{locConstants.multiResults.joinGroup}</MenuItem>
                                    </MenuTrigger>
                                    <MenuPopover>
                                        <MenuList>
                                            {otherGroups.map((group) => (
                                                <MenuItem
                                                    key={group.id}
                                                    onClick={() =>
                                                        actions.move(menuItem.uri, {
                                                            kind: "joinGroup",
                                                            groupId: group.id,
                                                            index: group.uris.length,
                                                        })
                                                    }>
                                                    {getGroupLabel(group)}
                                                </MenuItem>
                                            ))}
                                        </MenuList>
                                    </MenuPopover>
                                </Menu>
                            )}
                            {menuItem.group.uris.length > 1 && (
                                <MenuItem
                                    onClick={() =>
                                        actions.move(
                                            menuItem.uri,
                                            getNewGroupTarget(groups, menuItem.group),
                                        )
                                    }>
                                    {locConstants.multiResults.moveToNewGroup}
                                </MenuItem>
                            )}
                            {(otherGroups.length > 0 || menuItem.group.uris.length > 1) && (
                                <MenuDivider />
                            )}
                            <MenuItem onClick={() => actions.close(menuItem.uri)}>
                                {locConstants.multiResults.closeResults}
                            </MenuItem>
                        </MenuList>
                    )}
                </MenuPopover>
            </Menu>
        </div>
    );
};
