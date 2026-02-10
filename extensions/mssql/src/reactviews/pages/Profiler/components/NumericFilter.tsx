/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback } from "react";
import {
    makeStyles,
    tokens,
    Input,
    Dropdown,
    Option,
    Text,
    Field,
} from "@fluentui/react-components";
import { FilterOperator } from "../../../../sharedInterfaces/profiler";
import { locConstants } from "../../../common/locConstants";

/**
 * Props for the NumericFilter component
 */
export interface NumericFilterProps {
    /** Column field name */
    field: string;
    /** Column display name for hint */
    columnName: string;
    /** Current operator */
    operator: FilterOperator;
    /** Current value (as string for input) */
    value: string;
    /** Validation error message (if any) */
    error?: string;
    /** Callback when operator changes */
    onOperatorChange: (op: FilterOperator) => void;
    /** Callback when value changes */
    onValueChange: (val: string) => void;
}

/**
 * Available numeric filter operators
 */
const NUMERIC_OPERATORS: { key: FilterOperator; label: string }[] = [
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
        minWidth: "100px",
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
});

/**
 * Validates a numeric input value
 * @param value The string value to validate
 * @returns Object with valid flag and optional error message
 */
export function validateNumericInput(value: string): { valid: boolean; error?: string } {
    if (value.trim() === "") {
        return { valid: true }; // Empty is valid (will be caught on apply if needed)
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
        return { valid: false, error: locConstants.profiler.invalidNumber };
    }
    return { valid: true };
}

/**
 * NumericFilter component provides operator dropdown and numeric input
 * for filtering numeric columns (Duration, CPU, Reads, Writes).
 *
 * Features:
 * - Dropdown with comparison operators (=, <>, >, >=, <, <=)
 * - Numeric input with validation
 * - Error message display for invalid input
 * - Example hint line showing usage
 */
export const NumericFilter: React.FC<NumericFilterProps> = ({
    field,
    columnName,
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

    // Handle value input change with validation
    const handleValueChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            onValueChange(event.target.value);
        },
        [onValueChange],
    );

    return (
        <div
            className={classes.root}
            data-testid={`numeric-filter-${field}`}
            role="group"
            aria-label={locConstants.profiler.numericFilterGroupLabel}>
            <div className={classes.row}>
                <Dropdown
                    className={classes.operatorDropdown}
                    value={NUMERIC_OPERATORS.find((op) => op.key === operator)?.label ?? ""}
                    selectedOptions={[operator]}
                    onOptionSelect={handleOperatorChange}
                    aria-label={locConstants.profiler.filterOperator}>
                    {NUMERIC_OPERATORS.map((op) => (
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
                        type="number"
                        value={value}
                        onChange={handleValueChange}
                        aria-label={locConstants.profiler.filterValue}
                        aria-invalid={error ? "true" : "false"}
                        placeholder="0"
                    />
                </Field>
            </div>
            <Text className={classes.hint} id={`hint-${field}`}>
                {locConstants.profiler.numericFilterHint(columnName)}
            </Text>
        </div>
    );
};

export default NumericFilter;
