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
import { SortAscendingIcon } from "../../../../common/icons/sortAscending";
import { SortDescendingIcon } from "../../../../common/icons/sortDescending";
import { SortClearIcon } from "../../../../common/icons/sortClear";

export type FilterValue = string | undefined;

export interface FilterPopupAnchorRect {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
}

export interface FilterPopupItem {
    value: FilterValue;
    displayText: string;
    index: number;
}

interface FilterPopupProps {
    anchorRect: FilterPopupAnchorRect;
    items: FilterPopupItem[];
    initialSelected: FilterValue[];
    onApply: (selected: FilterValue[]) => Promise<void> | void;
    onClear: () => Promise<void> | void;
    onDismiss: () => void;
    onSortAscending?: () => Promise<void> | void;
    onSortDescending?: () => Promise<void> | void;
    onClearSort?: () => Promise<void> | void;
    currentSort?: "asc" | "desc" | "none";
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
        //rowGap: tokens.spacingVerticalS,
        ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: `${tokens.shadow28}, 0 0 0 1px ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground1,
        ...shorthands.border("1px", "solid", tokens.colorTransparentStroke),
    },
    titleBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 0,
        height: "20px",
    },
    closeButton: {
        minWidth: "16px",
        minHeight: "16px",
        width: "16px",
        height: "16px",
        padding: 0,
    },
    sectionHeading: {
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground3,
        marginBottom: 0,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        lineHeight: "20px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalXS,
    },
    divider: {
        height: "1px",
        backgroundColor: tokens.colorNeutralStroke2,
        marginTop: tokens.spacingVerticalXXS,
        marginBottom: tokens.spacingVerticalXXS,
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
    sortButtons: {
        display: "flex",
        flexDirection: "row",
        columnGap: "2px",
    },
    sortButton: {
        minWidth: "20px",
        minHeight: "20px",
        width: "20px",
        height: "20px",
        padding: 0,
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
    },
    listContainer: {
        height: LIST_HEIGHT + "px",
        overflowY: "auto",
        overflowX: "hidden",
        ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
        borderTop: "none",
        borderRadius: tokens.borderRadiusSmall,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        backgroundColor: tokens.colorNeutralBackground3,
        boxShadow: `inset 0 1px 3px ${tokens.colorNeutralShadowAmbient}`,
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
        backgroundColor: tokens.colorNeutralBackground3,
        paddingLeft: "0px",
        paddingRight: "4px",
        paddingTop: "0px",
        paddingBottom: "0px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
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
        paddingInline: 0,
        columnGap: 0,
        borderRadius: tokens.borderRadiusSmall,
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
            width: "14px",
            height: "14px",
            fontSize: "10px",
            flexShrink: 0,
            alignSelf: "center",
        },
        "& .fui-Checkbox__label": {
            lineHeight: "1",
            paddingLeft: "4px",
            alignSelf: "center",
        },
    },
});

export const FilterPopup: React.FC<FilterPopupProps> = ({
    anchorRect,
    items,
    initialSelected,
    onApply,
    onClear,
    onDismiss,
    onSortAscending,
    onSortDescending,
    onClearSort,
    currentSort = "none",
}) => {
    const styles = useStyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const firstFocusableRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const lastFocusableRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const [search, setSearch] = useState<string>("");
    const [selectedValues, setSelectedValues] = useState<Set<FilterValue>>(
        () => new Set(initialSelected),
    );
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);

    useEffect(() => {
        setSelectedValues(new Set(initialSelected));
        setSearch("");
    }, [initialSelected, items]);

    useEffect(() => {
        if (buttonRef.current) {
            buttonRef.current.focus();
        }
    }, [anchorRect]);

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
        const estimatedHeight = LIST_HEIGHT + 120;

        // Calculate available space and position
        let left = anchorRect.left;
        const spaceOnRight = window.innerWidth - anchorRect.left;

        // If popup would overflow on the right, align it to the right edge of the anchor
        if (spaceOnRight < POPUP_WIDTH + horizontalMargin) {
            left = Math.max(horizontalMargin, anchorRect.right - POPUP_WIDTH);
        }

        // Ensure popup doesn't overflow the viewport
        left = Math.max(
            horizontalMargin,
            Math.min(left, window.innerWidth - POPUP_WIDTH - horizontalMargin),
        );

        const maxTop = Math.max(
            verticalMargin,
            window.innerHeight - estimatedHeight - verticalMargin,
        );
        const top = Math.min(anchorRect.bottom + 4, Math.max(maxTop, verticalMargin));

        return { left, top };
    }, [anchorRect]);

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

    const handleSortAscending = useCallback(async () => {
        if (onSortAscending) {
            await onSortAscending();
            onDismiss();
        }
    }, [onSortAscending, onDismiss]);

    const handleSortDescending = useCallback(async () => {
        if (onSortDescending) {
            await onSortDescending();
            onDismiss();
        }
    }, [onSortDescending, onDismiss]);

    const handleClearSort = useCallback(async () => {
        if (onClearSort) {
            await onClearSort();
            onDismiss();
        }
    }, [onClearSort, onDismiss]);

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
            aria-label={locConstants.queryResult.showMenu}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleRootKeyDown}>
            {(onSortAscending || onSortDescending) && (
                <div className={styles.titleBar}>
                    <Text className={styles.sectionHeading}>Sort</Text>
                    <Button
                        ref={closeButtonRef}
                        appearance="subtle"
                        size="small"
                        icon={<Dismiss16Regular width={10} height={10} />}
                        onClick={handleClose}
                        className={styles.closeButton}
                        title="Close"
                        aria-label="Close"
                    />
                </div>
            )}
            {!(onSortAscending || onSortDescending) && (
                <div className={styles.titleBar}>
                    <Button
                        ref={(el) => {
                            firstFocusableRef.current = el as any;
                        }}
                        appearance="subtle"
                        size="small"
                        icon={<Dismiss16Regular />}
                        onClick={handleClose}
                        className={styles.closeButton}
                        title="Close"
                        aria-label="Close"
                        style={{ marginLeft: "auto" }}
                    />
                </div>
            )}
            <div className={styles.header}>
                {(onSortAscending || onSortDescending) && (
                    <div className={styles.section}>
                        <div className={styles.sortButtons}>
                            {onSortAscending && (
                                <Button
                                    ref={(el) => {
                                        buttonRef.current = el;
                                        firstFocusableRef.current = el;
                                    }}
                                    appearance={currentSort === "asc" ? "primary" : "subtle"}
                                    size="small"
                                    icon={<SortAscendingIcon />}
                                    onClick={handleSortAscending}
                                    title="Sort Ascending"
                                    aria-label="Sort Ascending"
                                    className={styles.sortButton}
                                />
                            )}
                            {onSortDescending && (
                                <Button
                                    appearance={currentSort === "desc" ? "primary" : "subtle"}
                                    size="small"
                                    icon={<SortDescendingIcon />}
                                    onClick={handleSortDescending}
                                    title="Sort Descending"
                                    aria-label="Sort Descending"
                                    className={styles.sortButton}
                                />
                            )}
                            {onClearSort && (
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<SortClearIcon />}
                                    onClick={handleClearSort}
                                    title="Clear Sort"
                                    aria-label="Clear Sort"
                                    className={styles.sortButton}
                                />
                            )}
                        </div>
                    </div>
                )}
                {(onSortAscending || onSortDescending) && <div className={styles.divider} />}
                <div className={styles.section}>
                    <Text className={styles.sectionHeading}>Filter</Text>
                    <div className={styles.topRow}>
                        <Input
                            ref={(el) => {
                                searchInputRef.current = el;
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
                            {selectedValues.size} selected
                        </Text>
                    </div>
                    <div
                        ref={containerRef}
                        className={styles.listContainer}
                        tabIndex={0}
                        role="listbox"
                        aria-label="Filter options"
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
                    appearance="secondary"
                    size="small"
                    onClick={handleClear}>
                    {locConstants.queryResult.clear}
                </Button>
            </div>
        </div>
    );
};

export default FilterPopup;
