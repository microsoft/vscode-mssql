/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Checkbox,
    CheckboxOnChangeData,
    Input,
    InputOnChangeData,
    Text,
    makeStyles,
    mergeClasses,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { Dismiss16Regular, Search16Regular } from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { locConstants } from "../../../../common/locConstants";
import { useVscodeWebview2 } from "../../../../common/vscodeWebviewProvider2";
import { WebviewAction } from "../../../../../sharedInterfaces/webview";

export type FilterValue = string | undefined;

export interface ColumnMenuPopupAnchorRect {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
}

export interface FilterListItem {
    value: FilterValue;
    displayText: string;
    index: number;
}

interface ColumnMenuPopupProps {
    anchorRect: ColumnMenuPopupAnchorRect;
    items: FilterListItem[];
    initialSelected: FilterValue[];
    onApply: (selected: FilterValue[]) => Promise<void> | void;
    onClear: () => Promise<void> | void;
    onDismiss: () => void;
}

const POPUP_WIDTH = 200;
const ITEM_HEIGHT = 22;
const LIST_HEIGHT = ITEM_HEIGHT * 4;

const useStyles = makeStyles({
    root: {
        position: "fixed",
        zIndex: 100000,
        width: POPUP_WIDTH + "px",
        display: "flex",
        flexDirection: "column",
        ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: `${tokens.shadow28}, 0 0 0 1px ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground1,
        ...shorthands.border("1px", "solid", tokens.colorTransparentStroke),
        gap: tokens.spacingVerticalS,
    },
    titleBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: "16px",
    },
    closeButton: {
        width: "16px",
        height: "16px",
    },
    sectionHeading: {
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground3,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        lineHeight: "16px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalXS,
    },
    divider: {
        height: "1px",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    header: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalXS,
    },
    topRow: {
        display: "flex",
        alignItems: "center",
        columnGap: tokens.spacingHorizontalXS,
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
    },
    listContainer: {
        height: LIST_HEIGHT + "px",
        overflowY: "auto",
        overflowX: "hidden",
        position: "relative",
        "&:focus": {
            outlineStyle: "solid",
            outlineWidth: "2px",
            outlineColor: tokens.colorBrandBackground,
            outlineOffset: "-2px",
        },
    },
    selectAllRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingRight: "4px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        borderTopLeftRadius: tokens.borderRadiusSmall,
        borderTopRightRadius: tokens.borderRadiusSmall,
        height: ITEM_HEIGHT + "px",
    },
    scrollableList: {
        ...shorthands.padding(0, "4px"),
        position: "relative",
        width: "100%",
    },
    virtualItem: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
    },
    optionRow: {
        display: "flex",
        alignItems: "center",
        height: ITEM_HEIGHT + "px",
        columnGap: 0,
        cursor: "pointer",
        "&:hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    optionRowFocused: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        outline: `2px solid ${tokens.colorBrandBackground}`,
        outlineOffset: "-2px",
    },
    optionCheckbox: {
        width: "100%",
        minWidth: 0,
        pointerEvents: "none",
        "& .fui-Checkbox__label": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    actions: {
        display: "flex",
        columnGap: tokens.spacingHorizontalXS,
        flexWrap: "nowrap",
    },
    actionButton: {
        flex: 1,
        minWidth: 0,
    },
    emptyState: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: LIST_HEIGHT + "px",
        color: tokens.colorNeutralForegroundDisabled,
        padding: tokens.spacingHorizontalM,
        textAlign: "center",
    },
    counter: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        flexShrink: 0,
        paddingRight: "4px",
    },
    compactCheckbox: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        minHeight: ITEM_HEIGHT + "px",
        height: ITEM_HEIGHT + "px",
        display: "flex",
        alignItems: "center",
        "& .fui-Checkbox__indicator": {
            width: "12px",
            height: "12px",
            fontSize: "10px",
            flexShrink: 0,
            alignSelf: "center",
        },
    },
});

export const ColumnMenuPopup: React.FC<ColumnMenuPopupProps> = ({
    anchorRect,
    items,
    initialSelected,
    onApply,
    onClear,
    onDismiss,
}) => {
    const styles = useStyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const firstFocusableRef = useRef<HTMLElement | null>(null);
    const lastFocusableRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const [search, setSearch] = useState<string>("");
    const [selectedValues, setSelectedValues] = useState<Set<FilterValue>>(
        () => new Set(initialSelected),
    );
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);
    const [popupHeight, setPopupHeight] = useState<number>(0);

    const { keyBindings } = useVscodeWebview2();

    const filteredItems = useMemo(() => {
        const trimmed = search.trim().toLowerCase();
        if (!trimmed) {
            return items;
        }
        return items.filter((item) => item.displayText.toLowerCase().includes(trimmed));
    }, [items, search]);

    const virtualizer = useVirtualizer({
        count: filteredItems.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => ITEM_HEIGHT,
        overscan: 4,
    });

    const updateSelection = useCallback((value: FilterValue, checked: boolean) => {
        setSelectedValues((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(value);
            } else {
                next.delete(value);
            }
            return next;
        });
    }, []);

    // Handle outside clicks and keyboard navigation
    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (!rootRef.current) {
                return;
            }
            const target = event.target as Node | null;
            if (target && rootRef.current.contains(target)) {
                return;
            }
            onDismiss();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onDismiss();
                return;
            }

            // Only handle arrow keys and space when focused on the list container
            const activeElement = document.activeElement;
            if (activeElement !== containerRef.current) {
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                setFocusedIndex((prev) => {
                    const nextIndex = prev + 1;
                    return nextIndex >= filteredItems.length ? 0 : nextIndex;
                });
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setFocusedIndex((prev) => {
                    const nextIndex = prev - 1;
                    return nextIndex < 0 ? filteredItems.length - 1 : nextIndex;
                });
            } else if (
                event.key === " " &&
                focusedIndex >= 0 &&
                focusedIndex < filteredItems.length
            ) {
                event.preventDefault();
                const item = filteredItems[focusedIndex];
                updateSelection(item.value, !selectedValues.has(item.value));
            }
        };
        window.addEventListener("mousedown", handleOutsideClick, true);
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("mousedown", handleOutsideClick, true);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onDismiss, filteredItems, focusedIndex, selectedValues, updateSelection]);

    // Sync selected values when initialSelected or items change
    useEffect(() => {
        setSelectedValues(new Set(initialSelected));
        setSearch("");
    }, [initialSelected, items]);

    // Measure popup height on mount and when filtered items change
    useEffect(() => {
        if (rootRef.current) {
            // Use requestAnimationFrame to ensure DOM has been laid out
            requestAnimationFrame(() => {
                if (rootRef.current) {
                    const height = rootRef.current.offsetHeight;
                    if (height > 0 && height !== popupHeight) {
                        setPopupHeight(height);
                    }
                }
            });
        }
    }, [filteredItems.length, popupHeight]);

    // Auto-focus search input when opened
    useEffect(() => {
        if (searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [anchorRect]);

    // Auto-scroll to focused item
    useEffect(() => {
        if (focusedIndex >= 0 && containerRef.current) {
            const itemTop = focusedIndex * ITEM_HEIGHT;
            const itemBottom = itemTop + ITEM_HEIGHT;
            const scrollTop = containerRef.current.scrollTop;
            const scrollBottom = scrollTop + LIST_HEIGHT;

            if (itemTop < scrollTop) {
                containerRef.current.scrollTop = itemTop;
            } else if (itemBottom > scrollBottom) {
                containerRef.current.scrollTop = itemBottom - LIST_HEIGHT;
            }
        }
    }, [focusedIndex]);

    // Reset focus when filtered items change
    useEffect(() => {
        virtualizer.scrollToIndex(0, { align: "start" });
        setFocusedIndex(-1);
    }, [filteredItems.length, virtualizer]);

    const selectAllState = useMemo(() => {
        if (filteredItems.length === 0) {
            return false as const;
        }
        let selectedCount = 0;
        for (const item of filteredItems) {
            if (selectedValues.has(item.value)) {
                selectedCount += 1;
            }
        }
        if (selectedCount === 0) {
            return false as const;
        }
        if (selectedCount === filteredItems.length) {
            return true as const;
        }
        return "mixed" as const;
    }, [filteredItems, selectedValues]);

    const position = useMemo(() => {
        const horizontalMargin = 8;
        const verticalMargin = 8;
        const gap = 4; // Gap between anchor and popup

        // Calculate horizontal position
        let left = anchorRect.left;
        const spaceOnRight = window.innerWidth - anchorRect.left;

        // If popup would overflow on the right, align it to the right edge of the anchor
        if (spaceOnRight < POPUP_WIDTH + horizontalMargin) {
            left = Math.max(horizontalMargin, anchorRect.right - POPUP_WIDTH);
        }

        // Ensure popup doesn't overflow the viewport horizontally
        left = Math.max(
            horizontalMargin,
            Math.min(left, window.innerWidth - POPUP_WIDTH - horizontalMargin),
        );

        // Calculate vertical position
        const spaceBelow = window.innerHeight - anchorRect.bottom;
        const spaceAbove = anchorRect.top;
        let top: number;

        // Prefer positioning below the anchor
        if (spaceBelow >= popupHeight + gap) {
            // Enough space below
            top = anchorRect.bottom + gap;
        } else if (spaceAbove >= popupHeight + gap) {
            // Not enough space below, but enough above
            top = anchorRect.top - popupHeight - gap;
        } else {
            // Not enough space above or below - position below and constrain
            top = anchorRect.bottom + gap;
            // Ensure it doesn't overflow bottom
            top = Math.min(top, window.innerHeight - popupHeight - verticalMargin);
            // Ensure it doesn't overflow top
            top = Math.max(top, verticalMargin);
        }

        return { left, top };
    }, [anchorRect, popupHeight]);

    const onToggleSelectAll = useCallback(
        (_e: React.ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => {
            // Determine if we should select all based on current state
            // When selectAllState is false or mixed, and user clicks, data.checked will be true -> select all
            // When selectAllState is true, and user clicks, data.checked will be false -> deselect all
            const shouldSelectAll = data.checked === true || data.checked === "mixed";
            setSelectedValues((prev) => {
                const next = new Set(prev);
                for (const item of filteredItems) {
                    if (shouldSelectAll) {
                        next.add(item.value);
                    } else {
                        next.delete(item.value);
                    }
                }
                return next;
            });
        },
        [filteredItems],
    );

    const handleSearchChange = useCallback(
        (_e: React.ChangeEvent<HTMLInputElement>, data: InputOnChangeData) => {
            setSearch(data.value);
        },
        [],
    );

    const handleApply = useCallback(async () => {
        await onApply(Array.from(selectedValues));
    }, [onApply, selectedValues]);

    const handleClear = useCallback(async () => {
        setSelectedValues(new Set());
        await onClear();
    }, [onClear]);

    const handleClose = useCallback(() => {
        onDismiss();
    }, [onDismiss]);

    const handleRootKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Tab") {
            const target = e.target as HTMLElement;

            // If Shift+Tab on first element, wrap to close button if it exists, otherwise to last
            if (e.shiftKey && target === firstFocusableRef.current) {
                e.preventDefault();
                if (closeButtonRef.current) {
                    closeButtonRef.current.focus();
                } else {
                    lastFocusableRef.current?.focus();
                }
            }
            // If Tab on close button, go to first element
            else if (!e.shiftKey && target === closeButtonRef.current) {
                e.preventDefault();
                firstFocusableRef.current?.focus();
            }
            // If Shift+Tab on close button, go to last element
            else if (e.shiftKey && target === closeButtonRef.current) {
                e.preventDefault();
                lastFocusableRef.current?.focus();
            }
            // If Tab on last element, wrap to close button if it exists, otherwise to first
            else if (!e.shiftKey && target === lastFocusableRef.current) {
                e.preventDefault();
                if (closeButtonRef.current) {
                    closeButtonRef.current.focus();
                } else {
                    firstFocusableRef.current?.focus();
                }
            }
        }
    }, []);

    return (
        <div
            ref={rootRef}
            className={styles.root}
            style={{ left: position.left, top: position.top }}
            role="dialog"
            aria-modal="true"
            aria-label={locConstants.queryResult.showMenu(
                keyBindings[WebviewAction.ResultGridOpenColumnMenu]?.label,
            )}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleRootKeyDown}>
            <div className={styles.titleBar}>
                <Text className={styles.sectionHeading}>
                    {locConstants.queryResult.filter}
                    <span
                        style={{
                            fontSize: "8px",
                            fontWeight: "100",
                            marginLeft: "6px",
                        }}>
                        {keyBindings[WebviewAction.ResultGridOpenFilterMenu]?.label}
                    </span>
                </Text>
                <Button
                    ref={closeButtonRef}
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular style={{ width: 10, height: 10 }} />}
                    onClick={handleClose}
                    className={styles.closeButton}
                    title={locConstants.common.close}
                    aria-label={locConstants.common.close}
                />
            </div>
            <div className={styles.divider} />
            <div className={styles.header}>
                <div className={styles.section}>
                    <div className={styles.topRow}>
                        <Input
                            ref={(el) => {
                                searchInputRef.current = el;
                                firstFocusableRef.current = el;
                            }}
                            className={styles.searchInput}
                            appearance="outline"
                            size="small"
                            placeholder={locConstants.queryResult.search}
                            value={search}
                            onChange={handleSearchChange}
                            role="searchbox"
                            contentBefore={<Search16Regular />}
                        />
                    </div>
                </div>
            </div>
            {filteredItems.length === 0 ? (
                <div className={styles.emptyState}>
                    <Text>{locConstants.queryResult.noResultsToDisplay}</Text>
                </div>
            ) : (
                <>
                    <div className={styles.selectAllRow}>
                        <Checkbox
                            className={styles.compactCheckbox}
                            checked={selectAllState}
                            onChange={onToggleSelectAll}
                            label={locConstants.queryResult.selectAll}
                            title={locConstants.queryResult.selectAll}
                        />
                        <Text
                            weight="semibold"
                            size={100}
                            aria-live="polite"
                            className={styles.counter}>
                            {locConstants.queryResult.selectedCount(selectedValues.size)}
                        </Text>
                    </div>
                    <div
                        ref={containerRef}
                        className={styles.listContainer}
                        tabIndex={0}
                        role="listbox"
                        aria-label={locConstants.queryResult.filterOptions}
                        onFocus={() => {
                            if (focusedIndex === -1 && filteredItems.length > 0) {
                                setFocusedIndex(0);
                            }
                        }}>
                        <div
                            className={styles.scrollableList}
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                            }}>
                            {virtualizer.getVirtualItems().map((virtualItem) => {
                                const item = filteredItems[virtualItem.index];
                                const isChecked = selectedValues.has(item.value);
                                const isFocused = virtualItem.index === focusedIndex;
                                return (
                                    <div
                                        key={virtualItem.key}
                                        className={styles.virtualItem}
                                        style={{
                                            height: `${virtualItem.size}px`,
                                            transform: `translateY(${virtualItem.start}px)`,
                                        }}>
                                        <div
                                            className={mergeClasses(
                                                styles.optionRow,
                                                isFocused && styles.optionRowFocused,
                                            )}
                                            title={item.displayText}
                                            onClick={() => updateSelection(item.value, !isChecked)}
                                            onMouseEnter={() => setFocusedIndex(virtualItem.index)}>
                                            <Checkbox
                                                className={mergeClasses(
                                                    styles.optionCheckbox,
                                                    styles.compactCheckbox,
                                                )}
                                                checked={isChecked}
                                                label={item.displayText}
                                                tabIndex={-1}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
            <div className={styles.actions}>
                <Button
                    className={styles.actionButton}
                    appearance="primary"
                    size="small"
                    onClick={handleApply}>
                    {locConstants.queryResult.apply}
                </Button>
                <Button
                    ref={lastFocusableRef}
                    className={styles.actionButton}
                    appearance="subtle"
                    size="small"
                    onClick={handleClear}>
                    {locConstants.queryResult.clear}
                </Button>
            </div>
        </div>
    );
};

export default ColumnMenuPopup;
