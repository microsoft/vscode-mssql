/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dropdown, Option, Input, makeStyles } from "@fluentui/react-components";
import type { DropdownProps, InputProps } from "@fluentui/react-components";

export interface FilterOperator {
    operator: string;
    desc: string;
}

export interface FluentCompoundFilterProps {
    /** Available operators for the dropdown */
    operators: FilterOperator[];
    /** Initial operator value */
    initialOperator?: string;
    /** Initial search value */
    initialValue?: string;
    /** Placeholder text for the input */
    placeholder?: string;
    /** Callback when filter value or operator changes */
    onChange: (operator: string, value: string) => void;
    /** Callback when filter should be cleared */
    onClear?: () => void;
    /** Column ID for accessibility */
    columnId: string;
}

export interface FluentCompoundFilterRef {
    /** Clear the filter */
    clear: () => void;
    /** Get current filter value */
    getValue: () => string;
    /** Get current operator */
    getOperator: () => string;
    /** Set filter value and operator */
    setValue: (value: string, operator?: string) => void;
}

const useStyles = makeStyles({
    container: {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        width: "100%",
        height: "100%",
    },
    dropdown: {
        minWidth: "unset",
        width: "90px",
        flexShrink: 0,
        "& button": {
            minWidth: "unset",
            paddingLeft: "6px",
            paddingRight: "6px",
            fontSize: "11px",
            height: "24px",
        },
    },
    input: {
        flex: 1,
        minWidth: 0,
        "& input": {
            fontSize: "12px",
            height: "24px",
            paddingTop: "2px",
            paddingBottom: "2px",
        },
    },
    listbox: {
        maxHeight: "200px",
    },
    option: {
        fontSize: "12px",
        padding: "4px 8px",
    },
});

export const FluentCompoundFilterComponent = React.forwardRef<
    FluentCompoundFilterRef,
    FluentCompoundFilterProps
>(
    (
        {
            operators,
            initialOperator = "",
            initialValue = "",
            placeholder = "",
            onChange,
            columnId,
        },
        ref,
    ) => {
        const styles = useStyles();
        const [selectedOperator, setSelectedOperator] = useState<string>(initialOperator);
        const [searchValue, setSearchValue] = useState<string>(initialValue);
        const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

        // Expose methods via ref
        React.useImperativeHandle(ref, () => ({
            clear: () => {
                setSelectedOperator("");
                setSearchValue("");
            },
            getValue: () => searchValue,
            getOperator: () => selectedOperator,
            setValue: (value: string, operator?: string) => {
                setSearchValue(value);
                if (operator !== undefined) {
                    setSelectedOperator(operator);
                }
            },
        }));

        // Debounced onChange callback
        const triggerChange = useCallback(
            (operator: string, value: string) => {
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                }
                debounceTimerRef.current = setTimeout(() => {
                    onChange(operator, value);
                }, 300);
            },
            [onChange],
        );

        // Cleanup debounce timer on unmount
        useEffect(() => {
            return () => {
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                }
            };
        }, []);

        const handleOperatorChange: DropdownProps["onOptionSelect"] = (_event, data) => {
            const newOperator = data.optionValue ?? "";
            setSelectedOperator(newOperator);
            // Trigger immediately for operator changes
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            onChange(newOperator, searchValue);
        };

        const handleInputChange: InputProps["onChange"] = (_event, data) => {
            const newValue = data.value;
            setSearchValue(newValue);
            triggerChange(selectedOperator, newValue);
        };

        const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
                // Trigger immediately on Enter
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                }
                onChange(selectedOperator, searchValue);
            }
        };

        // Find the display text for the selected operator
        const selectedOperatorDisplay =
            operators.find((op) => op.operator === selectedOperator)?.desc ||
            operators[0]?.desc ||
            "";

        return (
            <div className={styles.container}>
                <Dropdown
                    className={styles.dropdown}
                    size="small"
                    value={selectedOperatorDisplay}
                    selectedOptions={[selectedOperator]}
                    onOptionSelect={handleOperatorChange}
                    aria-label={`Filter operator for ${columnId}`}
                    listbox={{ className: styles.listbox }}>
                    {operators.map((op) => (
                        <Option key={op.operator} value={op.operator} className={styles.option}>
                            {op.desc}
                        </Option>
                    ))}
                </Dropdown>
                <Input
                    className={styles.input}
                    size="small"
                    value={searchValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    aria-label={`Filter value for ${columnId}`}
                />
            </div>
        );
    },
);

FluentCompoundFilterComponent.displayName = "FluentCompoundFilterComponent";
