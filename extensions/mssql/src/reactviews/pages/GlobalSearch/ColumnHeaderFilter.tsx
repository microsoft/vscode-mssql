/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    makeStyles,
    shorthands,
    tokens,
    Menu,
    MenuTrigger,
    MenuPopover,
    Button,
    SearchBox,
    Checkbox,
    Link,
} from "@fluentui/react-components";
import { Filter16Regular, Filter16Filled } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";

const useStyles = makeStyles({
    headerContainer: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("4px"),
    },
    headerLabel: {
        fontWeight: tokens.fontWeightSemibold,
    },
    filterButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        ...shorthands.padding("0"),
    },
    filterPopover: {
        minWidth: "200px",
        ...shorthands.padding("8px"),
    },
    checkboxList: {
        display: "flex",
        flexDirection: "column",
        maxHeight: "200px",
        overflowY: "auto",
        ...shorthands.gap("4px"),
        marginTop: "8px",
    },
    actionLinks: {
        display: "flex",
        ...shorthands.gap("8px"),
        marginBottom: "8px",
    },
});

interface TextFilterProps {
    type: "text";
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

interface MultiSelectFilterProps {
    type: "multiselect";
    label: string;
    options: string[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
}

type ColumnHeaderFilterProps = TextFilterProps | MultiSelectFilterProps;

export const ColumnHeaderFilter: React.FC<ColumnHeaderFilterProps> = (props) => {
    const classes = useStyles();

    const isActive =
        props.type === "text"
            ? props.value.length > 0
            : props.selectedValues.length > 0 && props.selectedValues.length < props.options.length;

    const FilterIcon = isActive ? Filter16Filled : Filter16Regular;

    return (
        <div className={classes.headerContainer}>
            <span className={classes.headerLabel}>{props.label}</span>
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <Button
                        appearance="subtle"
                        icon={<FilterIcon />}
                        className={classes.filterButton}
                        size="small"
                        aria-label={`Filter ${props.label}`}
                        onClick={(e) => e.stopPropagation()}
                    />
                </MenuTrigger>
                <MenuPopover>
                    <div className={classes.filterPopover}>
                        {props.type === "text" ? (
                            <TextFilterContent {...props} />
                        ) : (
                            <MultiSelectFilterContent {...props} classes={classes} />
                        )}
                    </div>
                </MenuPopover>
            </Menu>
        </div>
    );
};

const TextFilterContent: React.FC<TextFilterProps> = ({ value, onChange, placeholder }) => {
    return (
        <SearchBox
            value={value}
            onChange={(_, data) => onChange(data.value)}
            placeholder={placeholder || loc.globalSearch.filterByName}
            size="small"
        />
    );
};

interface MultiSelectFilterContentProps extends MultiSelectFilterProps {
    classes: ReturnType<typeof useStyles>;
}

const MultiSelectFilterContent: React.FC<MultiSelectFilterContentProps> = ({
    options,
    selectedValues,
    onChange,
    classes,
}) => {
    const handleSelectAll = () => {
        onChange([...options]);
    };

    const handleClear = () => {
        onChange([]);
    };

    const handleCheckboxChange = (option: string, checked: boolean) => {
        if (checked) {
            onChange([...selectedValues, option]);
        } else {
            onChange(selectedValues.filter((v) => v !== option));
        }
    };

    return (
        <>
            <div className={classes.actionLinks}>
                <Link onClick={handleSelectAll}>{loc.globalSearch.selectAll}</Link>
                <Link onClick={handleClear}>{loc.globalSearch.clearFilter}</Link>
            </div>
            <div className={classes.checkboxList}>
                {options.map((option) => (
                    <Checkbox
                        key={option}
                        label={option}
                        checked={selectedValues.includes(option)}
                        onChange={(_, data) => handleCheckboxChange(option, !!data.checked)}
                    />
                ))}
            </div>
        </>
    );
};
