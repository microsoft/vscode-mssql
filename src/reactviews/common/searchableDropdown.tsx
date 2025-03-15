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
    MenuItem,
    SearchBox,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { CSSProperties, useEffect, useRef, useState } from "react";

export const SearchableDropdown = (props: {
    searchPlaceholder: string;
    selectedOption: string;
    options: string[];
    onSelect: (selected: string) => void;
    ariaLabel?: string;
    size?: "small" | "medium" | "large";
    style?: CSSProperties;
}) => {
    const [searchText, setSearchText] = useState("");
    const [selectedOption, setSelectedOption] = useState(props.selectedOption);
    const [popoverWidth, setPopoverWidth] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const searchBoxRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (buttonRef.current) {
            setPopoverWidth(buttonRef.current.offsetWidth - 10);
        }
    }, [buttonRef.current]);

    return (
        <Menu
            positioning={{ autoSize: true }}
            onOpenChange={() => {
                setSearchText("");
                if (searchBoxRef.current) {
                    searchBoxRef.current.focus();
                }
            }}
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
                    {selectedOption || "Select"}
                </Button>
            </MenuTrigger>

            <MenuPopover style={{ width: popoverWidth }}>
                <MenuList>
                    <SearchBox
                        ref={searchBoxRef}
                        placeholder="Search"
                        value={searchText}
                        onChange={(_e, d) => {
                            setSearchText(d.value || "");
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
                    >
                        {props.options
                            .filter((option) =>
                                option
                                    .toLowerCase()
                                    .includes(searchText.toLowerCase()),
                            )
                            .map((option) => (
                                <MenuItem
                                    key={option}
                                    onClick={() => {
                                        setSelectedOption(option);
                                        props.onSelect(option);
                                    }}
                                    style={{
                                        width: `${popoverWidth - 10}px`,
                                        maxWidth: `${popoverWidth - 10}px`,
                                        padding: "5px 0px",
                                        margin: "2px",
                                    }}
                                >
                                    {option}
                                </MenuItem>
                            ))}
                    </div>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
