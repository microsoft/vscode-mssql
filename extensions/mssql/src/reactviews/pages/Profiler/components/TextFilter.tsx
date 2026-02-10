/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback } from "react";
import { makeStyles, tokens, Input, Dropdown, Option, Text } from "@fluentui/react-components";
import { FilterOperator } from "../../../../sharedInterfaces/profiler";
import { locConstants } from "../../../common/locConstants";

/**
 * Props for the TextFilter component
 */
export interface TextFilterProps {
    /** Column field name */
    field: string;
    /** Column display name for hint */
    columnName: string;
    /** Current operator */
    operator: FilterOperator;
    /** Current value */
    value: string;
    /** Callback when operator changes */
    onOperatorChange: (op: FilterOperator) => void;
    /** Callback when value changes */
    onValueChange: (val: string) => void;
}

/**
 * Available text filter operators
 */
const TEXT_OPERATORS: { key: FilterOperator; label: string }[] = [
    { key: FilterOperator.Contains, label: locConstants.profiler.opContains },
    { key: FilterOperator.StartsWith, label: locConstants.profiler.opStartsWith },
    { key: FilterOperator.Equals, label: locConstants.profiler.opEquals },
    { key: FilterOperator.NotEquals, label: locConstants.profiler.opNotEquals },
    { key: FilterOperator.NotContains, label: locConstants.profiler.operatorNotContains },
];

/**
 * Maximum length for text filter input (per spec)
 */
const MAX_LENGTH = 1000;

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
 * TextFilter component provides operator dropdown and text input
 * for filtering text columns (TextData).
 *
 * Features:
 * - Dropdown with text operators (contains, starts with, ends with, equals, not equals)
 * - Text input with placeholder "Enter text..."
 * - Hint line: "Search within {ColumnName} text content"
 * - 1000 character max length
 */
export const TextFilter: React.FC<TextFilterProps> = ({
    field,
    columnName,
    operator,
    value,
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
            data-testid={`text-filter-${field}`}
            role="group"
            aria-label={locConstants.profiler.textFilterGroupLabel}>
            <div className={classes.row}>
                <Dropdown
                    className={classes.operatorDropdown}
                    value={TEXT_OPERATORS.find((op) => op.key === operator)?.label ?? ""}
                    selectedOptions={[operator]}
                    onOptionSelect={handleOperatorChange}
                    aria-label={locConstants.profiler.filterOperator}>
                    {TEXT_OPERATORS.map((op) => (
                        <Option key={op.key} value={op.key}>
                            {op.label}
                        </Option>
                    ))}
                </Dropdown>
                <Input
                    className={classes.valueInput}
                    value={value}
                    onChange={handleValueChange}
                    placeholder={locConstants.profiler.textFilterPlaceholder}
                    maxLength={MAX_LENGTH}
                    aria-label={locConstants.profiler.filterValue}
                />
            </div>
            <Text className={classes.hint} id={`hint-${field}`}>
                {locConstants.profiler.textDataHint(columnName)}
            </Text>
        </div>
    );
};

export default TextFilter;
