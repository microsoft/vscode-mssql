/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback } from "react";
import { makeStyles, tokens, Input, Dropdown, Option, Field } from "@fluentui/react-components";
import { FilterOperator } from "../../../../sharedInterfaces/profiler";
import { locConstants } from "../../../common/locConstants";

/**
 * Props for the DateFilter component
 */
export interface DateFilterProps {
    /** Column field name */
    field: string;
    /** Current operator */
    operator: FilterOperator;
    /** Current value (as string for input, ISO format YYYY-MM-DD or datetime-local) */
    value: string;
    /** Validation error message (if any) */
    error?: string;
    /** Callback when operator changes */
    onOperatorChange: (op: FilterOperator) => void;
    /** Callback when value changes */
    onValueChange: (val: string) => void;
}

/**
 * Available date filter operators (same as numeric)
 */
const DATE_OPERATORS: { key: FilterOperator; label: string }[] = [
    { key: FilterOperator.Equals, label: locConstants.profiler.opEquals },
    { key: FilterOperator.NotEquals, label: locConstants.profiler.opNotEquals },
    { key: FilterOperator.GreaterThan, label: locConstants.profiler.opGreaterThan },
    { key: FilterOperator.GreaterThanOrEqual, label: locConstants.profiler.opGreaterOrEqual },
    { key: FilterOperator.LessThan, label: locConstants.profiler.opLessThan },
    { key: FilterOperator.LessThanOrEqual, label: locConstants.profiler.opLessOrEqual },
];

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingVerticalS,
        minWidth: "250px",
    },
    row: {
        display: "flex",
        flexDirection: "row",
        gap: tokens.spacingHorizontalS,
        alignItems: "flex-start",
    },
    operatorDropdown: {
        minWidth: "140px",
    },
    valueInput: {
        flex: 1,
        minWidth: "150px",
    },
});

/**
 * Validates a date input value
 * @param value The string value to validate (expected in datetime-local format)
 * @returns Object with valid flag and optional error message
 */
export function validateDateInput(value: string): { valid: boolean; error?: string } {
    if (value.trim() === "") {
        return { valid: true }; // Empty is valid (will be caught on apply if needed)
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return { valid: false, error: locConstants.profiler.invalidDate };
    }
    return { valid: true };
}

/**
 * DateFilter component provides operator dropdown and datetime-local input
 * for filtering date/time columns (StartTime).
 *
 * Features:
 * - Dropdown with comparison operators (=, <>, >, >=, <, <=)
 * - datetime-local input for date/time selection
 * - Error message display for invalid input
 */
export const DateFilter: React.FC<DateFilterProps> = ({
    field,
    operator,
    value,
    error,
    onOperatorChange,
    onValueChange,
}) => {
    const classes = useStyles();

    // Handle operator dropdown change
    const handleOperatorChange = useCallback(
        (_event: unknown, data: { optionValue?: string }) => {
            if (data.optionValue) {
                onOperatorChange(data.optionValue as FilterOperator);
            }
        },
        [onOperatorChange],
    );

    // Handle value input change
    const handleValueChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            onValueChange(event.target.value);
        },
        [onValueChange],
    );

    return (
        <div
            className={classes.root}
            data-testid={`date-filter-${field}`}
            role="group"
            aria-label={locConstants.profiler.dateFilterGroupLabel}>
            <div className={classes.row}>
                <Dropdown
                    className={classes.operatorDropdown}
                    value={DATE_OPERATORS.find((op) => op.key === operator)?.label ?? ""}
                    selectedOptions={[operator]}
                    onOptionSelect={handleOperatorChange}
                    aria-label={locConstants.profiler.filterOperator}>
                    {DATE_OPERATORS.map((op) => (
                        <Option key={op.key} value={op.key}>
                            {op.label}
                        </Option>
                    ))}
                </Dropdown>
                <Field
                    className={classes.valueInput}
                    validationState={error ? "error" : "none"}
                    validationMessage={error}>
                    <Input
                        type="datetime-local"
                        value={value}
                        onChange={handleValueChange}
                        aria-label={locConstants.profiler.filterValue}
                        aria-invalid={error ? "true" : "false"}
                    />
                </Field>
            </div>
        </div>
    );
};

export default DateFilter;
