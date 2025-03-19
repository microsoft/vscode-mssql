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
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { CSSProperties, useEffect, useRef, useState } from "react";

export const SearchableDropdown = (props: {
    searchPlaceholder: string;
    selectedOption: SearchableDropdownOptions;
    options: SearchableDropdownOptions[];
    onSelect: (selected: SearchableDropdownOptions) => void;
    ariaLabel?: string;
    size?: "small" | "medium" | "large";
    style?: CSSProperties;
}) => {
    const [searchText, setSearchText] = useState("");
    const [selectedOption, setSelectedOption] = useState(props.selectedOption);
    const [popoverWidth, setPopoverWidth] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isEnterKeyPressed, setIsEnterKeyPressed] = useState(false);
    const menuContainerRef = useRef<HTMLDivElement>(null);
    const menuItemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

    useEffect(() => {
        if (buttonRef.current) {
            setPopoverWidth(buttonRef.current.offsetWidth - 10);
        }
    }, [buttonRef.current]);

    const handleSearch = (searchText: string) => {
        const exactMatches: SearchableDropdownOptions[] = [];
        const partialMatches: SearchableDropdownOptions[] = [];
        props.options.forEach((option) => {
            if (option.displayName.toLowerCase() === searchText.toLowerCase()) {
                exactMatches.push(option);
            } else if (
                option.displayName
                    .toLowerCase()
                    .includes(searchText.toLowerCase())
            ) {
                partialMatches.push(option);
            }
        });
        return [...exactMatches, ...partialMatches];
    };

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
                    size={props.size ?? "medium"}
                    ref={buttonRef}
                    icon={<FluentIcons.ChevronDownRegular />}
                    iconPosition="after"
                    role="input"
                    aria-label={props.ariaLabel}
                    style={{
                        ...props.style,
                        justifyContent: "space-between",
                        fontWeight: 400,
                    }}
                >
                    {selectedOption.displayName || "Select"}
                </Button>
            </MenuTrigger>

            <MenuPopover style={{ width: popoverWidth }}>
                <MenuList
                    checkedValues={{
                        "dropdown-options": [selectedOption.value],
                    }}
                >
                    <SearchBox
                        ref={searchBoxRef}
                        placeholder="Search"
                        value={searchText}
                        onChange={(_e, d) => {
                            setSearchText(d.value || "");
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                const filteredOptions = props.options.filter(
                                    (option) =>
                                        option.displayName
                                            .toLowerCase()
                                            .includes(searchText.toLowerCase()),
                                );
                                if (filteredOptions.length > 0) {
                                    setSelectedOption(filteredOptions[0]);
                                    props.onSelect(filteredOptions[0]);
                                    setIsMenuOpen(false);
                                    setIsEnterKeyPressed(true);
                                }
                            }
                        }}
                        style={{ width: popoverWidth, maxWidth: popoverWidth }}
                    />
                    <div
                        style={{
                            maxHeight: "200px",
                            overflowY: "auto",
                            width: `${popoverWidth}px`,
                            overflowX: "hidden",
                        }}
                        ref={menuContainerRef}
                    >
                        {handleSearch(searchText).map((option) => (
                            <MenuItemRadio
                                ref={(el) => {
                                    if (el) {
                                        menuItemRefs.current[option.value] = el;
                                    }
                                }}
                                key={option.value}
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
                                {option.displayName}
                            </MenuItemRadio>
                        ))}
                    </div>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

export interface SearchableDropdownOptions {
    displayName: string;
    value: string;
}
