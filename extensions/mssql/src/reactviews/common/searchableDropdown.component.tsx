/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuTrigger,
    Button,
    MenuPopover,
    MenuList,
    SearchBox,
    MenuItemRadio,
    InputOnChangeData,
    SearchBoxChangeEvent,
    Text,
    tokens,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import React, { CSSProperties, useEffect, useId, useRef, useState } from "react";
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
    if (!text) return items;

    text = text.toLowerCase();

    return items
        .map((item) => {
            const itemString = getOptionDisplayText(item);
            const lowerItem = itemString.toLowerCase();
            let score = 0;

            if (lowerItem === text) {
                score = 3; // Exact match
            } else if (lowerItem.startsWith(text)) {
                score = 2; // Prefix match
            } else if (lowerItem.includes(text)) {
                score = 1; // Partial match
            }

            return { item, score };
        })
        .filter((entry) => entry.score > 0) // Remove non-matching items
        .sort((a, b) => b.score - a.score) // Sort by relevance
        .map((entry) => entry.item); // Extract the original strings
};

export const SearchableDropdown = (props: SearchableDropdownProps) => {
    const [searchText, setSearchText] = useState("");
    const [selectedOption, setSelectedOption] = useState(
        props.selectedOption ?? {
            value: "",
        },
    );

    const id = props.id ?? useId();
    const listboxId = `${id}-listbox`;

    const [popoverWidth, setPopoverWidth] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuContainerRef = useRef<HTMLDivElement>(null);
    const menuItemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

    // Using this to track if the list has been scrolled. After the first scroll, we don't want to scroll to the selected item again.
    const [listScrolled, setIsListScrolled] = useState(false);
    const [selectedOptionIndex, setSelectedOptionIndex] = useState(-1);

    // Using this to track if the search box is focused. This is used to focus the selected item when the search box is blurred.
    const [isSearchFocused, setIsSearchFocused] = useState(false);

    const updateOption = (option: SearchableDropdownOptions) => {
        const index = props.options.findIndex((opt) => opt.value === option.value);
        setSelectedOption(option);
        setSelectedOptionIndex(index);
        props.onSelect(option, index);
        setIsMenuOpen(false);
        setIsListScrolled(false);
    };

    /**
     * Handles the key down event for the search box.
     * If the Enter key is pressed, it selects the first matching option.
     * If the Escape key is pressed, it closes the menu.
     * @param e The keyboard event.
     */
    const handleSearchBoxKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            // If the search text is empty, we don't want to do anything
            if (!searchText) {
                return;
            }
            const filteredOptions = searchOptions(searchText, props.options);
            if (filteredOptions.length > 0) {
                updateOption(filteredOptions[0]);
                e.stopPropagation();
                e.preventDefault();
            }
        } else if (e.key === "Escape") {
            setIsMenuOpen(false);
        }
    };

    /**
     * Handles the change event for the search box.
     * @param _e The event object.
     * @param d The data object containing the new value.
     */
    const handleSearch = (_e: SearchBoxChangeEvent, d: InputOnChangeData) => {
        setSearchText(d.value || "");
    };

    /**
     * Renders the options in the dropdown.
     * @returns The rendered options.
     */
    const renderOptions = () => {
        return searchOptions(searchText, props.options).map((option) => (
            <MenuItemRadio
                ref={(el) => {
                    if (el) {
                        menuItemRefs.current[option.value] = el;
                    }
                }}
                key={`${id}-${option.value}`}
                onClick={() => {
                    updateOption(option);
                }}
                style={{
                    width: `${popoverWidth - 10}px`,
                    maxWidth: `${popoverWidth - 10}px`,
                    padding: "5px 0px",
                    margin: "2px",
                    ...(option.color ? { color: tokens[option.color] } : {}),
                }}
                name={"dropdown-options"}
                value={option.value}
                onFocus={() => {
                    if (isSearchFocused) {
                        // Focus to the selected item if the search box was focused
                        if (menuItemRefs.current[selectedOption.value]) {
                            setTimeout(() => {
                                menuItemRefs.current[selectedOption.value]?.focus();
                            }, 0);
                        }
                        setIsSearchFocused(false);
                    }
                }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                    }}>
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                        }}>
                        {props.renderDecoration && props.renderDecoration(option)}
                        <span>{getOptionDisplayText(option)}</span>
                    </span>

                    <span style={{ display: "flex", gap: "4px", marginRight: "12px" }}>
                        {option.description && <Text>{option.description}</Text>}
                        {option.icon && FluentOptionIcons[option.icon]}
                    </span>
                </div>
            </MenuItemRadio>
        ));
    };

    const getDropdownIcon = () => {
        if (props.clearable) {
            if (selectedOptionIndex === -1) {
                return <FluentIcons.ChevronDownRegular />;
            }
            return (
                <FluentIcons.DismissRegular
                    style={{
                        cursor: "pointer",
                    }}
                    onClick={(e) => {
                        updateOption({
                            value: "",
                        });
                        e.stopPropagation();
                        buttonRef.current?.focus();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            updateOption({
                                value: "",
                            });
                            e.stopPropagation();
                            buttonRef.current?.focus();
                        }
                    }}
                    aria-label={locConstants.common.clearSelection}
                    title={locConstants.common.clearSelection}
                    role="button"
                    tabIndex={0}
                />
            );
        } else {
            return <FluentIcons.ChevronDownRegular />;
        }
    };

    useEffect(() => {
        if (buttonRef.current) {
            setPopoverWidth(Math.max(buttonRef.current.offsetWidth - 10, 200));
        }
    }, [buttonRef.current]);

    useEffect(() => {
        const fallbackOption = props.options[0] ?? {
            value: "",
        };

        setSelectedOption(props.selectedOption ?? fallbackOption);
        setSelectedOptionIndex(
            props.options.findIndex((opt) => opt.value === props.selectedOption?.value),
        );
    }, [props.selectedOption, props.options]);

    return (
        <Menu
            positioning={{ autoSize: true }}
            onOpenChange={async (_e, data) => {
                setSearchText("");
                if (searchBoxRef.current) {
                    searchBoxRef.current.focus();
                }
                setIsMenuOpen(data.open);
                if (selectedOptionIndex !== -1 && !listScrolled) {
                    requestAnimationFrame(() => {
                        const selectedItemRef = menuItemRefs.current[selectedOption.value];
                        if (selectedItemRef && menuContainerRef.current) {
                            selectedItemRef.scrollIntoView({
                                block: "nearest",
                                behavior: "instant",
                            });
                        }
                        setIsListScrolled(true);
                    });
                }
                if (!data.open) {
                    setIsListScrolled(false);
                }
            }}
            open={isMenuOpen}
            hasCheckmarks={true}
            checkedValues={{
                "dropdown-options": [selectedOption.value],
            }}
            aria-label={props.ariaLabel || "options"}>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    id={id}
                    size={props.size ?? "medium"}
                    ref={buttonRef}
                    icon={getDropdownIcon()}
                    iconPosition="after"
                    role="combobox"
                    aria-haspopup="listbox"
                    aria-expanded={isMenuOpen}
                    aria-label={props.ariaLabel}
                    disabled={props.disabled}
                    className={isMenuOpen ? "dropdown-open" : ""}
                    style={{
                        ...props.style,
                        justifyContent: "space-between",
                        fontWeight: 400,
                    }}>
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
            </MenuTrigger>

            <MenuPopover style={{ width: popoverWidth }}>
                <MenuList>
                    <SearchBox
                        ref={searchBoxRef}
                        placeholder={props.searchBoxPlaceholder}
                        value={searchText}
                        onChange={(_e, d) => handleSearch(_e, d)}
                        aria-controls={listboxId}
                        onKeyDown={(e) => handleSearchBoxKeyDown(e)}
                        style={{
                            width: popoverWidth,
                            maxWidth: popoverWidth,
                        }}
                        onFocus={() => {
                            setIsSearchFocused(true);
                        }}
                    />
                    <div
                        style={{
                            maxHeight: "200px",
                            overflowY: "auto",
                            width: `${popoverWidth}px`,
                            overflowX: "hidden",
                        }}
                        role="presentation"
                        ref={menuContainerRef}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                setIsMenuOpen(false);
                                setIsListScrolled(false);
                            }
                            // if a input key is pressed, we want to set the search box value to that key
                            // and focus on the search box
                            if (
                                searchBoxRef.current &&
                                (e.key.length === 1 || e.key === "Backspace")
                            ) {
                                searchBoxRef.current?.focus();
                                searchBoxRef.current.value = e.key;
                            }
                        }}>
                        {renderOptions()}
                    </div>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
