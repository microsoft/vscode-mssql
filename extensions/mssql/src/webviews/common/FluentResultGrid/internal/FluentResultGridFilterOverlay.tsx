/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Input,
    Text,
    makeStyles,
    mergeClasses,
    shorthands,
    tokens,
    type CheckboxOnChangeData,
    type InputOnChangeData,
} from "@fluentui/react-components";
import { Dismiss16Regular, Search16Regular } from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";
import type {
    FluentResultGridFilterOverlayState,
    FluentResultGridFilterValue,
} from "./fluentResultGridOverlays";
import type { FluentResultGridCloseOverlayOptions } from "./fluentResultGridProviderTypes";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";

const popupWidth = 200;
const itemHeight = 22;
const listHeight = itemHeight * 4;

const useStyles = makeStyles({
    root: {
        position: "fixed",
        zIndex: 100000,
        width: `${popupWidth}px`,
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
        color: tokens.colorNeutralForeground1,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        lineHeight: "16px",
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
    searchInput: {
        flexGrow: 1,
        minWidth: 0,
    },
    listContainer: {
        height: `${listHeight}px`,
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
        height: `${itemHeight}px`,
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
        height: `${itemHeight}px`,
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
        flexGrow: 1,
        minWidth: 0,
    },
    emptyState: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: `${listHeight}px`,
        color: tokens.colorNeutralForegroundDisabled,
        padding: tokens.spacingHorizontalM,
        textAlign: "center",
    },
    counter: {
        color: tokens.colorNeutralForeground1,
        whiteSpace: "nowrap",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        flexShrink: 0,
        paddingRight: "4px",
    },
    compactCheckbox: {
        color: tokens.colorNeutralForeground1,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        minHeight: `${itemHeight}px`,
        height: `${itemHeight}px`,
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

function getFilterOverlayPosition({
    anchorRect,
    popupHeight,
}: {
    anchorRect: FluentResultGridFilterOverlayState["anchorRect"];
    popupHeight: number;
}) {
    const horizontalMargin = 8;
    const verticalMargin = 8;
    const gap = 4;
    let left = anchorRect.left;
    const spaceOnRight = window.innerWidth - anchorRect.left;

    if (spaceOnRight < popupWidth + horizontalMargin) {
        left = Math.max(horizontalMargin, anchorRect.right - popupWidth);
    }

    left = Math.max(
        horizontalMargin,
        Math.min(left, window.innerWidth - popupWidth - horizontalMargin),
    );

    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    let top: number;

    if (spaceBelow >= popupHeight + gap) {
        top = anchorRect.bottom + gap;
    } else if (spaceAbove >= popupHeight + gap) {
        top = anchorRect.top - popupHeight - gap;
    } else {
        top = anchorRect.bottom + gap;
        top = Math.min(top, window.innerHeight - popupHeight - verticalMargin);
        top = Math.max(top, verticalMargin);
    }

    return { left, top };
}

export interface FluentResultGridFilterOverlayProps {
    overlay: FluentResultGridFilterOverlayState;
    strings: FluentResultGridStrings;
    closeOverlay: (options?: FluentResultGridCloseOverlayOptions) => void;
}

export function FluentResultGridFilterOverlay({
    overlay,
    strings,
    closeOverlay,
}: FluentResultGridFilterOverlayProps) {
    const styles = useStyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const firstFocusableRef = useRef<HTMLElement | null>(null);
    const lastFocusableRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
    const [search, setSearch] = useState("");
    const [selectedValues, setSelectedValues] = useState<Set<FluentResultGridFilterValue>>(
        () => new Set(overlay.initialSelected),
    );
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [popupHeight, setPopupHeight] = useState(0);

    const filteredItems = useMemo(() => {
        const trimmed = search.trim().toLowerCase();
        if (!trimmed) {
            return overlay.items;
        }
        return overlay.items.filter((item) => item.displayText.toLowerCase().includes(trimmed));
    }, [overlay.items, search]);

    const virtualizer = useVirtualizer({
        count: filteredItems.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => itemHeight,
        overscan: 4,
    });

    const updateSelection = useCallback((value: FluentResultGridFilterValue, checked: boolean) => {
        setSelectedValues((previous) => {
            const next = new Set(previous);
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
            const target = event.target as Node | null;
            if (target && rootRef.current?.contains(target)) {
                return;
            }
            closeOverlay();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeOverlay();
                return;
            }

            if (document.activeElement !== containerRef.current) {
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                setFocusedIndex((previous) =>
                    previous + 1 >= filteredItems.length ? 0 : previous + 1,
                );
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setFocusedIndex((previous) =>
                    previous - 1 < 0 ? filteredItems.length - 1 : previous - 1,
                );
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
    }, [closeOverlay, filteredItems, focusedIndex, selectedValues, updateSelection]);

    useEffect(() => {
        setSelectedValues(new Set(overlay.initialSelected));
        setSearch("");
    }, [overlay.initialSelected, overlay.items]);

    useEffect(() => {
        requestAnimationFrame(() => {
            const height = rootRef.current?.offsetHeight ?? 0;
            if (height > 0 && height !== popupHeight) {
                setPopupHeight(height);
            }
        });
    }, [filteredItems.length, popupHeight]);

    useEffect(() => {
        searchInputRef.current?.focus();
    }, [overlay.anchorRect]);

    useEffect(() => {
        if (focusedIndex >= 0 && containerRef.current) {
            const itemTop = focusedIndex * itemHeight;
            const itemBottom = itemTop + itemHeight;
            const scrollTop = containerRef.current.scrollTop;
            const scrollBottom = scrollTop + listHeight;

            if (itemTop < scrollTop) {
                containerRef.current.scrollTop = itemTop;
            } else if (itemBottom > scrollBottom) {
                containerRef.current.scrollTop = itemBottom - listHeight;
            }
        }
    }, [focusedIndex]);

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
                selectedCount++;
            }
        }

        if (selectedCount === 0) {
            return false as const;
        }

        return selectedCount === filteredItems.length ? (true as const) : ("mixed" as const);
    }, [filteredItems, selectedValues]);

    const position = useMemo(
        () =>
            getFilterOverlayPosition({
                anchorRect: overlay.anchorRect,
                popupHeight,
            }),
        [overlay.anchorRect, popupHeight],
    );

    const onToggleSelectAll = useCallback(
        (_event: ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => {
            const shouldSelectAll = data.checked === true || data.checked === "mixed";
            setSelectedValues((previous) => {
                const next = new Set(previous);
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
        (_event: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) => {
            setSearch(data.value);
        },
        [],
    );

    const handleApply = useCallback(async () => {
        await overlay.onApply(Array.from(selectedValues));
        closeOverlay({ notifyDismiss: false });
    }, [closeOverlay, overlay, selectedValues]);

    const handleClear = useCallback(async () => {
        setSelectedValues(new Set());
        await overlay.onClear();
        closeOverlay({ notifyDismiss: false });
    }, [closeOverlay, overlay]);

    const handleRootKeyDown = useCallback((event: ReactKeyboardEvent) => {
        if (event.key !== "Tab") {
            return;
        }

        const target = event.target as HTMLElement;
        if (event.shiftKey && target === firstFocusableRef.current) {
            event.preventDefault();
            closeButtonRef.current?.focus();
        } else if (!event.shiftKey && target === closeButtonRef.current) {
            event.preventDefault();
            firstFocusableRef.current?.focus();
        } else if (event.shiftKey && target === closeButtonRef.current) {
            event.preventDefault();
            lastFocusableRef.current?.focus();
        } else if (!event.shiftKey && target === lastFocusableRef.current) {
            event.preventDefault();
            closeButtonRef.current?.focus();
        }
    }, []);

    return (
        <div
            ref={rootRef}
            className={styles.root}
            style={{ left: position.left, top: position.top }}
            role="dialog"
            aria-modal="true"
            aria-label={strings.menus.filterOptions}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleRootKeyDown}>
            <div className={styles.titleBar}>
                <Text className={styles.sectionHeading}>
                    {strings.commands[FluentResultGridCommand.OpenFilter]?.label}
                </Text>
                <Button
                    ref={closeButtonRef}
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular style={{ width: 10, height: 10 }} />}
                    onClick={() => closeOverlay()}
                    className={styles.closeButton}
                    title={strings.filter.close}
                    aria-label={strings.filter.close}
                />
            </div>
            <div className={styles.divider} />
            <div className={styles.header}>
                <Input
                    ref={(element) => {
                        searchInputRef.current = element;
                        firstFocusableRef.current = element;
                    }}
                    className={styles.searchInput}
                    appearance="outline"
                    size="small"
                    placeholder={strings.filter.search}
                    value={search}
                    onChange={handleSearchChange}
                    role="searchbox"
                    contentBefore={<Search16Regular />}
                />
            </div>
            {filteredItems.length === 0 ? (
                <div className={styles.emptyState}>
                    <Text>{strings.filter.noResultsToDisplay}</Text>
                </div>
            ) : (
                <>
                    <div className={styles.selectAllRow}>
                        <Checkbox
                            className={styles.compactCheckbox}
                            checked={selectAllState}
                            onChange={onToggleSelectAll}
                            label={strings.commands[FluentResultGridCommand.SelectAll]?.label}
                            title={strings.commands[FluentResultGridCommand.SelectAll]?.label}
                        />
                        <Text
                            weight="semibold"
                            size={100}
                            aria-live="polite"
                            className={styles.counter}>
                            {strings.accessibility.selectedCount(selectedValues.size)}
                        </Text>
                    </div>
                    <div
                        ref={containerRef}
                        className={styles.listContainer}
                        tabIndex={0}
                        role="listbox"
                        aria-label={strings.menus.filterOptions}
                        onFocus={() => {
                            if (focusedIndex === -1 && filteredItems.length > 0) {
                                setFocusedIndex(0);
                            }
                        }}>
                        <div
                            className={styles.scrollableList}
                            style={{ height: `${virtualizer.getTotalSize()}px` }}>
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
                    {strings.filter.apply}
                </Button>
                <Button
                    ref={lastFocusableRef}
                    className={styles.actionButton}
                    appearance="subtle"
                    size="small"
                    onClick={handleClear}>
                    {strings.filter.clear}
                </Button>
            </div>
        </div>
    );
}
