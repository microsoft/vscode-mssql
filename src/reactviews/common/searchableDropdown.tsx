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
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { CSSProperties, useEffect, useId, useRef, useState } from "react";

export interface SearchableDropdownOptions {
    /**
     * Unique value for the option
     */
    value: string;
    /**
     * Display text for the option. If not provided, the value will be used as the display text.
     */
    text?: string;
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
     * Placeholder text for the search box.
     */
    placeholder?: string;
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
    onSelect: (option: SearchableDropdownOptions) => void;
}

const getOptionDisplayText = (option: SearchableDropdownOptions): string => {
    return option.text || option.value;
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
        props.selectedOption ?? props.options[0],
    );

    const id = props.id ?? useId();
    const listboxId = `${id}-listbox`;

    const [popoverWidth, setPopoverWidth] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isEnterKeyPressed, setIsEnterKeyPressed] = useState(false);
    const menuContainerRef = useRef<HTMLDivElement>(null);
    const menuItemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

    /**
     * Handles the key down event for the search box.
     * If the Enter key is pressed, it selects the first matching option.
     * If the Escape key is pressed, it closes the menu.
     * @param e The keyboard event.
     */
    const handleSearchBoxKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            const filteredOptions = props.options.filter((option) =>
                getOptionDisplayText(option)
                    .toLowerCase()
                    .includes(searchText.toLowerCase()),
            );
            if (filteredOptions.length > 0) {
                setSelectedOption(filteredOptions[0]);
                props.onSelect(filteredOptions[0]);
                setIsMenuOpen(false);
                setIsEnterKeyPressed(true);
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
                    setSelectedOption(option);
                    props.onSelect(option);
                    setIsMenuOpen(false);
                }}
                style={{
                    width: `${popoverWidth - 10}px`,
                    maxWidth: `${popoverWidth - 10}px`,
                    padding: "5px 0px",
                    margin: "2px",
                }}
                name={"dropdown-options"}
                value={option.value}
            >
                {getOptionDisplayText(option)}
            </MenuItemRadio>
        ));
    };

    useEffect(() => {
        if (buttonRef.current) {
            setPopoverWidth(buttonRef.current.offsetWidth - 10);
        }
    }, [buttonRef.current]);

    useEffect(() => {
        if (isMenuOpen && menuContainerRef.current) {
            // Wait for menu to fully render
            setTimeout(() => {
                const selectedItemRef =
                    menuItemRefs.current[selectedOption.value];
                if (selectedItemRef && menuContainerRef.current) {
                    // Calculate scroll position to make the selected item visible
                    // ...
                    selectedItemRef.scrollIntoView({ block: "nearest" });
                }
            }, 0);
        }
    }, [isMenuOpen, selectedOption]);

    return (
        <Menu
            positioning={{ autoSize: true }}
            onOpenChange={async (_e, data) => {
                if (isEnterKeyPressed) {
                    setIsEnterKeyPressed(false);
                    return;
                }
                setSearchText("");
                if (searchBoxRef.current) {
                    searchBoxRef.current.focus();
                }
                setIsMenuOpen(data.open);
            }}
            open={isMenuOpen}
            hasCheckmarks={true}
        >
            <MenuTrigger disableButtonEnhancement>
                <Button
                    id={id}
                    size={props.size ?? "medium"}
                    ref={buttonRef}
                    icon={<FluentIcons.ChevronDownRegular />}
                    iconPosition="after"
                    role="combobox"
                    aria-haspopup="listbox"
                    aria-expanded={isMenuOpen}
                    aria-label={props.ariaLabel}
                    disabled={props.disabled}
                    style={{
                        ...props.style,
                        justifyContent: "space-between",
                        fontWeight: 400,
                    }}
                >
                    {getOptionDisplayText(selectedOption)}
                </Button>
            </MenuTrigger>

            <MenuPopover style={{ width: popoverWidth }}>
                <MenuList
                    id={listboxId}
                    aria-label={props.ariaLabel || "options"}
                    checkedValues={{
                        "dropdown-options": [selectedOption.value],
                    }}
                >
                    <SearchBox
                        ref={searchBoxRef}
                        placeholder={props.placeholder}
                        value={searchText}
                        onChange={(_e, d) => handleSearch(_e, d)}
                        aria-controls={listboxId}
                        onKeyDown={(e) => handleSearchBoxKeyDown(e)}
                        style={{ width: popoverWidth, maxWidth: popoverWidth }}
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
                    >
                        {renderOptions()}
                    </div>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
