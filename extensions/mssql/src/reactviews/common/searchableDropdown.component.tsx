/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    InputOnChangeData,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    SearchBox,
    SearchBoxChangeEvent,
    Text,
    tokens,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, {
    CSSProperties,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { locConstants } from "./locConstants";

export interface SearchableDropdownOptions {
    /**
     * Unique value for the option
     */
    value: string;
    /**
     * Display text for the option. If not provided, the value will be used as the display text.
     */
    text?: string;
    /**
     * Option description
     */
    description?: string;
    /**
     * Option Icon- Fluent UI icon component to display for the option
     */
    icon?: keyof typeof FluentOptionIcons;
    /**
     * Optional text color for the option
     */
    color?: keyof typeof tokens;
}

export interface SearchableDropdownProps {
    /**
     * ID for the dropdown. This is used to identify the dropdown in the DOM.
     */
    id?: string;
    /**
     * Options for the dropdown. Each option should have a unique value.
     */
    options: SearchableDropdownOptions[];
    /**
     * The text to display when no option is selected.
     */
    placeholder?: string;
    /**
     * Placeholder text for the search box.
     */
    searchBoxPlaceholder?: string;
    /**
     * The currently selected option. This should be one of the options provided.
     * If not provided, the dropdown will select the first option by default.
     */
    selectedOption?: SearchableDropdownOptions;
    /**
     * Accessibility label for the dropdown button.
     */
    ariaLabel?: string;
    /**
     * Size of the dropdown. Can be "small", "medium", or "large".
     * If not provided, the default size will be medium.
     */
    size?: "small" | "medium" | "large";
    /**
     * Custom styles for the dropdown button.
     */
    style?: CSSProperties;
    /**
     * Sets the dropdown to be disabled. If true, the dropdown will be unclickable and the button will be grayed out.
     */
    disabled?: boolean;
    /**
     * Callback function that is called when an option is selected.
     * @param option The selected option.
     * @returns void
     */
    onSelect: (option: SearchableDropdownOptions, index: number) => void;
    /**
     * Sets the dropdown to be clearable. If true, a clear button will be shown to clear the selected option.
     */
    clearable?: boolean;

    /**
     * Minimum width for the dropdown popup surface.
     * Defaults to 240px; set disableMinPopupWidth to true to turn off.
     */
    minPopupWidth?: number;

    /**
     * Disable the default minimum popup width.
     */
    disableMinPopupWidth?: boolean;

    /**
     * Optional function to render a decoration element for each option.
     */
    renderDecoration?: (option: SearchableDropdownOptions) => React.JSX.Element | undefined;
}

/**
 * Icon Map for options in the searchable dropdown. Add more icons here if you need a specific icon
 */
export const FluentOptionIcons: Record<string, React.JSX.Element> = {
    Warning20Regular: <FluentIcons.Warning20Regular />,
};

export function renderColorSwatch(color: string | undefined): React.JSX.Element | undefined {
    return color ? (
        <span
            aria-hidden="true"
            style={{
                width: "12px",
                height: "12px",
                borderRadius: "2px",
                backgroundColor: color,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
            }}
        />
    ) : undefined;
}

const getOptionDisplayText = (option: SearchableDropdownOptions, placeholder?: string): string => {
    const optionText = option.text || option.value;
    if (optionText === "" && placeholder) {
        return placeholder;
    }
    return optionText;
};

const searchOptions = (text: string, items: SearchableDropdownOptions[]) => {
    if (!text) {
        return items;
    }

    const normalized = text.toLowerCase();

    return items
        .map((item) => {
            const itemString = getOptionDisplayText(item);
            const lowerItem = itemString.toLowerCase();
            let score = 0;

            if (lowerItem === normalized) {
                score = 3; // Exact match
            } else if (lowerItem.startsWith(normalized)) {
                score = 2; // Prefix match
            } else if (lowerItem.includes(normalized)) {
                score = 1; // Partial match
            }

            return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
};

const LIST_HEIGHT_PX = 200;
const OPTION_HEIGHT_PX = 24;
const VIRTUAL_OVERSCAN = 6;
const DEFAULT_MIN_POPUP_WIDTH_PX = 240;

const sizeToFontSize: Record<string, string> = {
    small: tokens.fontSizeBase200,
    medium: tokens.fontSizeBase300,
    large: tokens.fontSizeBase400,
};

export const SearchableDropdown = (props: SearchableDropdownProps) => {
    const [searchText, setSearchText] = useState("");
    const [selectedOption, setSelectedOption] = useState(
        props.selectedOption ?? {
            value: "",
        },
    );

    const triggerFontSize = sizeToFontSize[props.size ?? "medium"];
    const minPopupWidthPx = props.disableMinPopupWidth
        ? undefined
        : (props.minPopupWidth ?? DEFAULT_MIN_POPUP_WIDTH_PX);

    const id = props.id ?? useId();
    const listboxId = `${id}-listbox`;

    const filteredOptions = useMemo(
        () => searchOptions(searchText, props.options),
        [searchText, props.options],
    );

    const [popoverWidth, setPopoverWidth] = useState(0);
    const buttonRef = useRef<HTMLButtonElement | null>(
        undefined as unknown as HTMLButtonElement | null,
    );
    const searchBoxRef = useRef<HTMLInputElement | null>(
        undefined as unknown as HTMLInputElement | null,
    );
    const listContainerRef = useRef<HTMLDivElement | null>(
        undefined as unknown as HTMLDivElement | null,
    );

    const [isOpen, setIsOpen] = useState(false);
    const [isTriggerFocused, setIsTriggerFocused] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number>(-1);

    const triggerBorderColor =
        isOpen || isTriggerFocused
            ? "var(--vscode-focusBorder)"
            : "var(--vscode-settings-dropdownBorder, var(--vscode-input-border, transparent))";

    const selectedOptionIndex = useMemo(
        () => props.options.findIndex((opt) => opt.value === selectedOption.value),
        [props.options, selectedOption.value],
    );

    const activeDescendantId = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

    const virtualizer = useVirtualizer({
        count: filteredOptions.length,
        getScrollElement: () => listContainerRef.current,
        estimateSize: () => OPTION_HEIGHT_PX,
        overscan: VIRTUAL_OVERSCAN,
    });

    const initActiveIndex = useCallback(
        (direction: "down" | "up" = "down") => {
            const optionCount = props.options.length;
            if (optionCount === 0) {
                setActiveIndex(-1);
                return;
            }

            const currentIndex = props.options.findIndex(
                (opt) => opt.value === selectedOption.value,
            );
            const nextIndex =
                currentIndex >= 0 ? currentIndex : direction === "up" ? optionCount - 1 : 0;

            setActiveIndex(nextIndex);
        },
        [props.options, selectedOption.value],
    );

    const closePopup = useCallback((focusTrigger: boolean) => {
        setIsOpen(false);
        setSearchText("");
        setActiveIndex(-1);
        if (focusTrigger) {
            requestAnimationFrame(() => buttonRef.current?.focus());
        }
    }, []);

    const updateOption = useCallback(
        (option: SearchableDropdownOptions) => {
            const index = props.options.findIndex((opt) => opt.value === option.value);
            setSelectedOption(option);
            props.onSelect(option, index);
            closePopup(true);
        },
        [closePopup, props],
    );

    const openPopup = useCallback(
        (direction: "down" | "up" = "down") => {
            if (props.disabled) {
                return;
            }

            // Match existing behavior: opening clears any prior search
            setSearchText("");
            setIsOpen(true);

            initActiveIndex(direction);
        },
        [initActiveIndex, props.disabled],
    );

    const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (props.disabled) {
            return;
        }

        // Keyboard-accessible clear without introducing a nested tab-stop inside the trigger button.
        if (
            props.clearable &&
            selectedOptionIndex !== -1 &&
            (e.key === "Backspace" || e.key === "Delete")
        ) {
            e.preventDefault();
            updateOption({ value: "" });
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            openPopup("down");
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            openPopup("up");
            return;
        }

        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (isOpen) {
                closePopup(true);
            } else {
                openPopup("down");
            }
        }
    };

    const handleSearchBoxKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filteredOptions.length === 0) {
                setActiveIndex(-1);
                return;
            }
            setActiveIndex((prev) => {
                const next = prev < 0 ? 0 : Math.min(prev + 1, filteredOptions.length - 1);
                return next;
            });
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filteredOptions.length === 0) {
                setActiveIndex(-1);
                return;
            }
            setActiveIndex((prev) => {
                const next = prev < 0 ? filteredOptions.length - 1 : Math.max(prev - 1, 0);
                return next;
            });
            return;
        }

        if (e.key === "Home") {
            if (filteredOptions.length > 0) {
                e.preventDefault();
                setActiveIndex(0);
            }
            return;
        }

        if (e.key === "End") {
            if (filteredOptions.length > 0) {
                e.preventDefault();
                setActiveIndex(filteredOptions.length - 1);
            }
            return;
        }

        if (e.key === "PageDown" || e.key === "PageUp") {
            if (filteredOptions.length > 0) {
                e.preventDefault();
                const jump = Math.max(1, Math.floor(LIST_HEIGHT_PX / OPTION_HEIGHT_PX) - 1);
                setActiveIndex((prev) => {
                    const start = prev < 0 ? 0 : prev;
                    const next = e.key === "PageDown" ? start + jump : start - jump;
                    return Math.max(0, Math.min(filteredOptions.length - 1, next));
                });
            }
            return;
        }

        if (e.key === "Enter") {
            if (filteredOptions.length === 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const indexToSelect = activeIndex >= 0 ? activeIndex : 0;
            const option = filteredOptions[indexToSelect];
            if (option) {
                updateOption(option);
            }
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closePopup(true);
            return;
        }

        if (e.key === "Tab") {
            // Allow normal focus traversal; just close the popup.
            closePopup(false);
        }
    };

    const handleSearch = (_e: SearchBoxChangeEvent, d: InputOnChangeData) => {
        const nextSearchText = d.value || "";
        setSearchText(nextSearchText);

        if (!isOpen) {
            return;
        }

        if (nextSearchText) {
            setActiveIndex(0);
            virtualizer.scrollToIndex(0, { align: "start" });
            return;
        }

        // If search is cleared, restore active index to the current selection when possible.
        const currentIndex = props.options.findIndex((opt) => opt.value === selectedOption.value);
        const nextIndex = currentIndex >= 0 ? currentIndex : props.options.length > 0 ? 0 : -1;
        setActiveIndex(nextIndex);
        if (nextIndex >= 0) {
            virtualizer.scrollToIndex(nextIndex, { align: "auto" });
        }
    };

    const getDropdownIcon = () => {
        if (!props.clearable) {
            return <FluentIcons.ChevronDownRegular />;
        }

        if (selectedOptionIndex === -1) {
            return <FluentIcons.ChevronDownRegular />;
        }

        return (
            <FluentIcons.DismissRegular
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                    updateOption({ value: "" });
                    e.stopPropagation();
                }}
                aria-hidden={true}
                title={locConstants.common.clearSelection}
            />
        );
    };

    useEffect(() => {
        if (buttonRef.current) {
            setPopoverWidth(buttonRef.current.offsetWidth);
        }
    }, [isOpen]);

    useEffect(() => {
        const onResize = () => {
            if (buttonRef.current) {
                setPopoverWidth(buttonRef.current.offsetWidth);
            }
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        const fallbackOption = props.options[0] ?? { value: "" };
        setSelectedOption(props.selectedOption ?? fallbackOption);
    }, [props.selectedOption, props.options]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        requestAnimationFrame(() => {
            searchBoxRef.current?.focus();
        });
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        if (activeIndex >= 0) {
            virtualizer.scrollToIndex(activeIndex, { align: "auto" });
        }
    }, [isOpen, activeIndex, virtualizer]);

    // Keep active index in bounds as filtering changes
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        if (filteredOptions.length === 0) {
            setActiveIndex(-1);
            return;
        }
        setActiveIndex((prev) => {
            if (prev < 0) {
                return 0;
            }
            return Math.min(prev, filteredOptions.length - 1);
        });
    }, [filteredOptions.length, isOpen]);

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <Popover
            positioning={{ position: "below", align: "start" }}
            open={isOpen}
            onOpenChange={(_e, data) => {
                setIsOpen(data.open);
                if (data.open) {
                    setSearchText("");
                    initActiveIndex("down");
                } else {
                    setSearchText("");
                    setActiveIndex(-1);
                }
            }}>
            <PopoverTrigger disableButtonEnhancement>
                <Button
                    id={id}
                    size={props.size ?? "medium"}
                    appearance="transparent"
                    ref={buttonRef}
                    icon={getDropdownIcon()}
                    iconPosition="after"
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? listboxId : undefined}
                    aria-label={props.ariaLabel}
                    disabled={props.disabled}
                    className={isOpen ? "dropdown-open" : ""}
                    style={{
                        ...props.style,
                        justifyContent: "space-between",
                        fontWeight: 400,
                        fontSize: triggerFontSize,
                        outline: "none",
                        boxShadow: "none",
                        // Match existing Fluent dropdown styling used across the webviews
                        backgroundColor:
                            "var(--vscode-settings-dropdownBackground, var(--vscode-dropdown-background))",
                        color: "var(--vscode-settings-dropdownForeground, var(--vscode-dropdown-foreground))",
                        borderStyle: "solid",
                        borderWidth: "1px",
                        borderColor: triggerBorderColor,
                        borderRadius: "2px",
                        minHeight: "22px",
                        lineHeight: "19px",
                    }}
                    onKeyDown={handleTriggerKeyDown}
                    onFocus={() => setIsTriggerFocused(true)}
                    onBlur={() => setIsTriggerFocused(false)}>
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            overflow: "hidden",
                        }}>
                        {props.renderDecoration && props.renderDecoration(selectedOption)}
                        <Text
                            style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                fontSize: triggerFontSize,
                                ...(getOptionDisplayText(selectedOption, props.placeholder) ===
                                props.placeholder
                                    ? { color: "var(--vscode-input-placeholderForeground)" }
                                    : {}),
                            }}
                            className={
                                getOptionDisplayText(selectedOption, props.placeholder) ===
                                props.placeholder
                                    ? "placeholder"
                                    : ""
                            }
                            title={getOptionDisplayText(selectedOption, props.placeholder)}>
                            {getOptionDisplayText(selectedOption, props.placeholder)}
                        </Text>
                    </span>
                </Button>
            </PopoverTrigger>

            <PopoverSurface
                style={{
                    width: popoverWidth > 0 ? popoverWidth : "auto",
                    minWidth: minPopupWidthPx !== undefined ? `${minPopupWidthPx}px` : undefined,
                    padding: 0,
                    backgroundColor: "var(--vscode-editorWidget-background)",
                    color: "var(--vscode-editorWidget-foreground, var(--vscode-foreground))",
                    border: "1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, transparent))",
                    borderRadius: "4px",
                    boxShadow: "0 2px 8px var(--vscode-widget-shadow)",
                }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <SearchBox
                        ref={searchBoxRef}
                        size={props.size ?? "medium"}
                        placeholder={props.searchBoxPlaceholder}
                        value={searchText}
                        onChange={handleSearch}
                        aria-controls={listboxId}
                        aria-activedescendant={activeDescendantId}
                        aria-autocomplete="list"
                        onKeyDown={handleSearchBoxKeyDown}
                        style={{ width: "100%", maxWidth: "100%" }}
                    />

                    <div
                        id={listboxId}
                        role="listbox"
                        aria-label={props.ariaLabel || "options"}
                        ref={listContainerRef}
                        style={{
                            height: `${LIST_HEIGHT_PX}px`,
                            overflowY: "auto",
                            width: "100%",
                            overflowX: "hidden",
                        }}>
                        <div
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                                width: "100%",
                                position: "relative",
                            }}>
                            {virtualItems.map((virtualRow) => {
                                const option = filteredOptions[virtualRow.index];
                                if (!option) {
                                    return undefined;
                                }

                                const isSelected = option.value === selectedOption.value;
                                const isActive = virtualRow.index === activeIndex;

                                return (
                                    <div
                                        key={`${id}-${virtualRow.index}-${option.value}`}
                                        id={`${id}-option-${virtualRow.index}`}
                                        role="option"
                                        aria-selected={isSelected}
                                        aria-posinset={virtualRow.index + 1}
                                        aria-setsize={filteredOptions.length}
                                        onMouseEnter={() => setActiveIndex(virtualRow.index)}
                                        onMouseDown={(e) => {
                                            // Keep focus on the search box (required for aria-activedescendant)
                                            e.preventDefault();
                                        }}
                                        onClick={() => updateOption(option)}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                            display: "flex",
                                            alignItems: "center",
                                            boxSizing: "border-box",
                                            padding: "4px 8px",
                                            cursor: "pointer",
                                            fontSize: "12px",
                                            lineHeight: `${OPTION_HEIGHT_PX}px`,
                                            backgroundColor: isSelected
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : isActive
                                                  ? "var(--vscode-list-hoverBackground)"
                                                  : "transparent",
                                            color: isSelected
                                                ? "var(--vscode-list-activeSelectionForeground)"
                                                : option.color
                                                  ? tokens[option.color]
                                                  : "var(--vscode-editorWidget-foreground, var(--vscode-foreground))",
                                        }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                width: "100%",
                                                gap: "8px",
                                            }}>
                                            <span
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                    overflow: "hidden",
                                                    minWidth: 0,
                                                }}>
                                                {props.renderDecoration &&
                                                    props.renderDecoration(option)}
                                                <span
                                                    style={{
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                    title={getOptionDisplayText(option)}>
                                                    {getOptionDisplayText(option)}
                                                </span>
                                            </span>

                                            <span
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "4px",
                                                    flexShrink: 0,
                                                }}>
                                                {option.description && (
                                                    <Text>{option.description}</Text>
                                                )}
                                                {option.icon && FluentOptionIcons[option.icon]}
                                                {isSelected && <FluentIcons.Checkmark16Regular />}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </PopoverSurface>
        </Popover>
    );
};
