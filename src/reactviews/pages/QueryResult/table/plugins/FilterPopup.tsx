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
import { ArrowSortUp24Regular, ArrowSortDown24Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../../common/locConstants";

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
}

const POPUP_WIDTH = 200;
const LIST_HEIGHT = 200;
const ITEM_HEIGHT = 28;
const OVERSCAN = 4;

const useStyles = makeStyles({
    root: {
        position: "fixed",
        zIndex: 100000,
        width: POPUP_WIDTH + "px",
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalS,
        ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalS),
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: `${tokens.shadow28}, 0 0 0 1px ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground1,
        ...shorthands.border("1px", "solid", tokens.colorTransparentStroke),
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
        flexDirection: "column",
        columnGap: tokens.spacingHorizontalXXS,
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
        ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalXS),
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground3,
        boxShadow: `inset 0 1px 3px ${tokens.colorNeutralShadowAmbient}`,
        "&:focus": {
            outlineStyle: "solid",
            outlineWidth: "2px",
            outlineColor: tokens.colorBrandBackground,
            outlineOffset: "-2px",
        },
    },
    spacer: {
        height: 0,
        width: "100%",
    },
    optionRow: {
        display: "flex",
        alignItems: "center",
        height: ITEM_HEIGHT + "px",
        paddingInline: tokens.spacingHorizontalXS,
        columnGap: tokens.spacingHorizontalXS,
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
        "& .fui-Checkbox__label": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    actions: {
        display: "flex",
        justifyContent: "flex-end",
        columnGap: tokens.spacingHorizontalXS,
        flexWrap: "nowrap",
    },
    actionButton: {
        minWidth: "fit-content",
        flexShrink: 0,
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
    },
    compactCheckbox: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
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
}) => {
    const styles = useStyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
    const lastFocusableRef = useRef<HTMLButtonElement | null>(null);
    const [search, setSearch] = useState<string>("");
    const [scrollTop, setScrollTop] = useState(0);
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
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
        setScrollTop(0);
        setFocusedIndex(-1);
    }, [filteredItems.length]);

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

    const totalItems = items.length;
    const visibleCount = Math.ceil(LIST_HEIGHT / ITEM_HEIGHT);
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(filteredItems.length, startIndex + visibleCount + OVERSCAN * 2);
    const beforeHeight = startIndex * ITEM_HEIGHT;
    const afterHeight = (filteredItems.length - endIndex) * ITEM_HEIGHT;
    const visibleItems = filteredItems.slice(startIndex, endIndex);

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
            const shouldSelect = data.checked === true || data.checked === "mixed";
            setSelectedValues((prev) => {
                const next = new Set(prev);
                if (shouldSelect) {
                    for (const item of filteredItems) {
                        next.add(item.value);
                    }
                } else {
                    for (const item of filteredItems) {
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

    const handleRootKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Tab") {
            const target = e.target as HTMLElement;

            // If Shift+Tab on first element, go to last
            if (e.shiftKey && target === firstFocusableRef.current) {
                e.preventDefault();
                lastFocusableRef.current?.focus();
            }
            // If Tab on last element, go to first
            else if (!e.shiftKey && target === lastFocusableRef.current) {
                e.preventDefault();
                firstFocusableRef.current?.focus();
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
            <div className={styles.header}>
                {(onSortAscending || onSortDescending) && (
                    <div className={styles.sortButtons}>
                        {onSortAscending && (
                            <Button
                                ref={(el) => {
                                    buttonRef.current = el;
                                    firstFocusableRef.current = el;
                                }}
                                appearance="subtle"
                                size="small"
                                icon={<ArrowSortUp24Regular />}
                                onClick={handleSortAscending}
                                title="Sort Ascending"
                                style={{
                                    // align text and icon to the left
                                    justifyContent: "flex-start",
                                }}
                                aria-label="Sort Ascending">
                                Sort Ascending
                            </Button>
                        )}
                        {onSortDescending && (
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<ArrowSortDown24Regular />}
                                onClick={handleSortDescending}
                                style={{
                                    // align text and icon to the left
                                    justifyContent: "flex-start",
                                }}
                                title="Sort Descending"
                                aria-label="Sort Descending">
                                Sort Descending
                            </Button>
                        )}
                    </div>
                )}
                <div className={styles.topRow}>
                    <Input
                        ref={(el) => {
                            searchInputRef.current = el;
                            // If no sort buttons, this is the first focusable element
                            if (!onSortAscending && !onSortDescending) {
                                firstFocusableRef.current = el as any;
                            }
                        }}
                        className={styles.searchInput}
                        appearance="outline"
                        size="small"
                        placeholder={locConstants.queryResult.search}
                        value={search}
                        onChange={handleSearchChange}
                        role="searchbox"
                        contentBefore={
                            <Checkbox
                                className={styles.compactCheckbox}
                                checked={selectAllState}
                                onChange={onToggleSelectAll}
                                title={locConstants.queryResult.selectAll}
                                size="medium"
                            />
                        }
                        contentAfter={
                            <Text
                                weight="semibold"
                                size={100}
                                aria-live="polite"
                                className={styles.counter}>
                                {selectedValues.size + "/" + totalItems}
                            </Text>
                        }
                    />
                </div>
            </div>
            {filteredItems.length === 0 ? (
                <div className={styles.emptyState}>
                    <Text>{locConstants.queryResult.noResultsToDisplay}</Text>
                </div>
            ) : (
                <div
                    ref={containerRef}
                    className={styles.listContainer}
                    tabIndex={0}
                    role="listbox"
                    aria-label="Filter options"
                    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                    onFocus={() => {
                        if (focusedIndex === -1 && filteredItems.length > 0) {
                            setFocusedIndex(0);
                        }
                    }}>
                    <div style={{ height: beforeHeight }} className={styles.spacer} />
                    {visibleItems.map((item, idx) => {
                        const isChecked = selectedValues.has(item.value);
                        const actualIndex = startIndex + idx;
                        const isFocused = actualIndex === focusedIndex;
                        const key = item.index + "-" + actualIndex;
                        return (
                            <div
                                key={key}
                                className={mergeClasses(
                                    styles.optionRow,
                                    isFocused && styles.optionRowFocused,
                                )}
                                title={item.displayText}
                                onClick={() => updateSelection(item.value, !isChecked)}
                                onMouseEnter={() => setFocusedIndex(actualIndex)}>
                                <Checkbox
                                    className={mergeClasses(
                                        styles.optionCheckbox,
                                        styles.compactCheckbox,
                                    )}
                                    checked={isChecked}
                                    onChange={(_, data) =>
                                        updateSelection(item.value, data.checked === true)
                                    }
                                    label={item.displayText}
                                    tabIndex={-1}
                                />
                            </div>
                        );
                    })}
                    <div style={{ height: afterHeight }} className={styles.spacer} />
                </div>
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
                    className={styles.actionButton}
                    appearance="secondary"
                    size="small"
                    onClick={handleClear}>
                    {locConstants.queryResult.clear}
                </Button>
                <Button
                    ref={lastFocusableRef}
                    className={styles.actionButton}
                    appearance="secondary"
                    size="small"
                    onClick={handleClose}>
                    {locConstants.queryResult.close}
                </Button>
            </div>
        </div>
    );
};

export default FilterPopup;
