/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useMemo, useCallback } from "react";
import { makeStyles, tokens, Input, Checkbox, Text } from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";

/**
 * Props for the CategoricalFilter component
 */
export interface CategoricalFilterProps {
    /** Column field name */
    field: string;
    /** Available values to select from */
    values: string[];
    /** Currently selected values */
    selectedValues: string[];
    /** Placeholder text for search input (default: "Search values...") */
    searchPlaceholder?: string;
    /** Callback when selection changes */
    onSelectionChange: (selected: string[]) => void;
}

/**
 * CategoricalFilter component provides a searchable checkbox list
 * for filtering categorical column values.
 *
 * Features:
 * - Search input to filter displayed values
 * - Select All / Deselect All functionality
 * - Checkbox list with scrollable container
 * - Shows match count when searching
 */
export const CategoricalFilter: React.FC<CategoricalFilterProps> = ({
    field,
    values,
    selectedValues,
    searchPlaceholder,
    onSelectionChange,
}) => {
    const classes = useStyles();
    const [searchTerm, setSearchTerm] = useState("");

    // Filter values based on search term (case-insensitive)
    const filteredValues = useMemo(() => {
        if (!searchTerm.trim()) {
            return values;
        }
        const lowerSearch = searchTerm.toLowerCase();
        return values.filter((value) => value.toLowerCase().includes(lowerSearch));
    }, [values, searchTerm]);

    // Check if all filtered values are selected
    const allFilteredSelected = useMemo(() => {
        if (filteredValues.length === 0) {
            return false;
        }
        return filteredValues.every((value) => selectedValues.includes(value));
    }, [filteredValues, selectedValues]);

    // Check if some (but not all) filtered values are selected
    const someFilteredSelected = useMemo(() => {
        if (allFilteredSelected) {
            return false;
        }
        return filteredValues.some((value) => selectedValues.includes(value));
    }, [filteredValues, selectedValues, allFilteredSelected]);

    // Handle search input change
    const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
    }, []);

    // Handle Select All / Deselect All toggle
    const handleSelectAllChange = useCallback(
        (_event: React.ChangeEvent<HTMLInputElement>, data: { checked: boolean | "mixed" }) => {
            if (data.checked === true) {
                // Add all filtered values to selection (preserve existing selections)
                const newSelection = new Set(selectedValues);
                filteredValues.forEach((value) => newSelection.add(value));
                onSelectionChange(Array.from(newSelection));
            } else {
                // Remove all filtered values from selection
                const filteredSet = new Set(filteredValues);
                const newSelection = selectedValues.filter((value) => !filteredSet.has(value));
                onSelectionChange(newSelection);
            }
        },
        [filteredValues, selectedValues, onSelectionChange],
    );

    // Handle individual checkbox change
    const handleValueChange = useCallback(
        (value: string, checked: boolean) => {
            if (checked) {
                onSelectionChange([...selectedValues, value]);
            } else {
                onSelectionChange(selectedValues.filter((v) => v !== value));
            }
        },
        [selectedValues, onSelectionChange],
    );

    return (
        <div
            className={classes.container}
            data-field={field}
            role="group"
            aria-label={locConstants.profiler.filterColumnTitle(field)}>
            {/* Search input */}
            <div className={classes.searchContainer}>
                <Input
                    className={classes.searchInput}
                    placeholder={searchPlaceholder ?? locConstants.profiler.searchValuesPlaceholder}
                    value={searchTerm}
                    onChange={handleSearchChange}
                    contentBefore={<Search20Regular aria-hidden="true" />}
                    size="small"
                    aria-label={locConstants.profiler.searchValuesPlaceholder}
                />
            </div>

            {/* Select All checkbox (only when there are values) */}
            {filteredValues.length > 0 && (
                <div className={classes.selectAllContainer}>
                    <Checkbox
                        checked={
                            allFilteredSelected ? true : someFilteredSelected ? "mixed" : false
                        }
                        onChange={handleSelectAllChange}
                        label={
                            searchTerm.trim()
                                ? `${locConstants.profiler.categorySelectAll} (${filteredValues.length})`
                                : locConstants.profiler.categorySelectAll
                        }
                    />
                </div>
            )}

            {/* Checkbox list */}
            <div
                className={classes.listContainer}
                role="listbox"
                aria-label={locConstants.profiler.categoryFilterListLabel}
                aria-multiselectable="true">
                {filteredValues.length === 0 ? (
                    <Text className={classes.noResults} role="status">
                        {locConstants.profiler.noValuesMatch}
                    </Text>
                ) : (
                    filteredValues.map((value) => (
                        <div
                            key={value}
                            className={classes.checkboxItem}
                            role="option"
                            aria-selected={selectedValues.includes(value)}>
                            <Checkbox
                                checked={selectedValues.includes(value)}
                                onChange={(_e, data) =>
                                    handleValueChange(value, data.checked === true)
                                }
                                label={value || "(empty)"}
                            />
                        </div>
                    ))
                )}
            </div>

            {/* Selection count indicator */}
            {selectedValues.length > 0 && (
                <div className={classes.selectionCount} aria-live="polite">
                    <Text size={200}>
                        {locConstants.profiler.selectedCount.replace(
                            "{0}",
                            String(selectedValues.length),
                        )}
                    </Text>
                </div>
            )}
        </div>
    );
};

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        minWidth: "200px",
        maxWidth: "300px",
    },
    searchContainer: {
        paddingBottom: tokens.spacingVerticalXS,
    },
    searchInput: {
        width: "100%",
    },
    selectAllContainer: {
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingBottom: tokens.spacingVerticalS,
    },
    listContainer: {
        maxHeight: "200px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
    checkboxItem: {
        display: "flex",
        alignItems: "center",
    },
    noResults: {
        color: tokens.colorNeutralForeground3,
        fontStyle: "italic",
        padding: tokens.spacingVerticalS,
        textAlign: "center",
    },
    selectionCount: {
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingTop: tokens.spacingVerticalS,
        color: tokens.colorNeutralForeground3,
    },
});

export default CategoricalFilter;
