/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
    makeStyles,
    tokens,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Button,
    Text,
} from "@fluentui/react-components";
import {
    ColumnFilterCriteria,
    ProfilerColumnDef,
    FilterOperator,
} from "../../../../sharedInterfaces/profiler";
import { CategoricalFilter } from "./CategoricalFilter";
import { NumericFilter, validateNumericInput } from "./NumericFilter";
import { TextFilter } from "./TextFilter";
import { DateFilter, validateDateInput } from "./DateFilter";
import { locConstants } from "../../../common/locConstants";

/**
 * Props for the ColumnFilterPopover component
 */
export interface ColumnFilterPopoverProps {
    /** Column definition */
    column: ProfilerColumnDef;
    /** Current filter criteria for this column (if any) */
    currentCriteria?: ColumnFilterCriteria;
    /** Distinct values for categorical columns */
    distinctValues?: string[];
    /** Whether popover is open */
    isOpen: boolean;
    /** Callback when popover open state changes */
    onOpenChange: (open: boolean) => void;
    /** Callback when Apply is clicked */
    onApply: (criteria: ColumnFilterCriteria) => void;
    /** Callback when Clear is clicked */
    onClear: () => void;
    /** Trigger element to anchor the popover (optional if anchorElement is provided) */
    children?: React.ReactElement;
    /** DOM element to anchor the popover to (alternative to children) */
    anchorElement?: HTMLElement | null;
}

/**
 * ColumnFilterPopover provides a popover container for column filters.
 *
 * Features:
 * - Header with column name
 * - Renders appropriate filter based on column type/filterMode
 * - Apply and Clear action buttons
 * - Closes on outside click, Escape key, or horizontal scroll
 */
export const ColumnFilterPopover: React.FC<ColumnFilterPopoverProps> = ({
    column,
    currentCriteria,
    distinctValues = [],
    isOpen,
    onOpenChange,
    onApply,
    onClear,
    children,
    anchorElement,
}) => {
    const classes = useStyles();
    const popoverRef = useRef<HTMLDivElement>(null);

    // Local state for pending changes (before Apply)
    const [pendingSelectedValues, setPendingSelectedValues] = useState<string[]>(
        currentCriteria?.selectedValues ?? [],
    );

    // Local state for numeric filter
    const [pendingOperator, setPendingOperator] = useState<FilterOperator>(
        currentCriteria?.operator ??
            (column.type === "number" ? FilterOperator.GreaterThan : FilterOperator.Contains),
    );
    const [pendingValue, setPendingValue] = useState<string>(
        currentCriteria?.value?.toString() ?? "",
    );
    const [numericError, setNumericError] = useState<string | undefined>(undefined);

    // Get default operator based on column type
    const getDefaultOperator = useCallback((type?: string) => {
        if (type === "number" || type === "datetime") {
            return FilterOperator.GreaterThan;
        }
        return FilterOperator.Contains;
    }, []);

    /**
     * Gets the actual field name to use for filtering.
     * Uses the first eventsMapped field name if available, otherwise falls back to the display field name.
     * This ensures the filter operates on the raw field names that exist in EventRow/additionalData.
     */
    const getFilterFieldName = useCallback(() => {
        return column.eventsMapped?.[0] ?? column.field;
    }, [column.eventsMapped, column.field]);

    // Reset pending state when popover opens or current criteria changes
    useEffect(() => {
        if (isOpen) {
            setPendingSelectedValues(currentCriteria?.selectedValues ?? []);
            setPendingOperator(currentCriteria?.operator ?? getDefaultOperator(column.type));
            setPendingValue(currentCriteria?.value?.toString() ?? "");
            setNumericError(undefined);
        }
    }, [isOpen, currentCriteria, column.type, getDefaultOperator]);

    // Handle Apply button click
    const handleApply = useCallback(() => {
        const filterField = getFilterFieldName();

        // Handle numeric filter
        if (column.type === "number" && column.filterMode !== "categorical") {
            // Validate the input
            const validation = validateNumericInput(pendingValue);
            if (!validation.valid) {
                setNumericError(validation.error);
                return; // Don't close popover on validation error
            }
            if (pendingValue.trim() === "") {
                // Empty value, clear the filter
                onClear();
            } else {
                const criteria: ColumnFilterCriteria = {
                    field: filterField,
                    filterType: "numeric",
                    operator: pendingOperator,
                    value: parseFloat(pendingValue),
                };
                onApply(criteria);
            }
        }
        // Handle datetime filter
        else if (column.type === "datetime") {
            // Validate the input
            const validation = validateDateInput(pendingValue);
            if (!validation.valid) {
                setNumericError(validation.error); // Reuse numericError state for date errors
                return; // Don't close popover on validation error
            }
            if (pendingValue.trim() === "") {
                // Empty value, clear the filter
                onClear();
            } else {
                const criteria: ColumnFilterCriteria = {
                    field: filterField,
                    filterType: "date",
                    operator: pendingOperator,
                    value: pendingValue, // Keep as string, will be parsed when filtering
                };
                onApply(criteria);
            }
        }
        // Handle text filter (only when explicitly set to text mode)
        else if (column.filterMode === "text") {
            if (pendingValue.trim() === "") {
                // Empty value, clear the filter
                onClear();
            } else {
                const criteria: ColumnFilterCriteria = {
                    field: filterField,
                    filterType: "text",
                    operator: pendingOperator,
                    value: pendingValue,
                };
                onApply(criteria);
            }
        }
        // Handle categorical filter (explicit or default for string columns)
        else {
            if (pendingSelectedValues.length === 0) {
                // No values selected, clear the filter instead
                onClear();
            } else {
                const criteria: ColumnFilterCriteria = {
                    field: filterField,
                    filterType: "categorical",
                    selectedValues: pendingSelectedValues,
                };
                onApply(criteria);
            }
        }
        onOpenChange(false);
    }, [
        column.filterMode,
        column.type,
        getFilterFieldName,
        pendingSelectedValues,
        pendingOperator,
        pendingValue,
        onApply,
        onClear,
        onOpenChange,
    ]);

    // Handle Clear button click
    const handleClear = useCallback(() => {
        onClear();
        onOpenChange(false);
    }, [onClear, onOpenChange]);

    // Handle selection changes from CategoricalFilter
    const handleSelectionChange = useCallback((selected: string[]) => {
        setPendingSelectedValues(selected);
    }, []);

    // Handle numeric filter operator change
    const handleOperatorChange = useCallback((op: FilterOperator) => {
        setPendingOperator(op);
        setNumericError(undefined); // Clear error on change
    }, []);

    // Handle numeric filter value change
    const handleNumericValueChange = useCallback((val: string) => {
        setPendingValue(val);
        // Validate on change for immediate feedback
        const validation = validateNumericInput(val);
        setNumericError(validation.error);
    }, []);

    // Handle text filter value change (no validation needed)
    const handleTextValueChange = useCallback((val: string) => {
        setPendingValue(val);
    }, []);

    // Handle date filter value change with validation
    const handleDateValueChange = useCallback((val: string) => {
        setPendingValue(val);
        // Validate on change for immediate feedback
        const validation = validateDateInput(val);
        setNumericError(validation.error);
    }, []);

    // Handle Escape key to close popover and return focus to trigger
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onOpenChange(false);
                // Return focus to the trigger element (funnel button)
                // The trigger is the first child inside PopoverTrigger
                const trigger =
                    popoverRef.current?.previousElementSibling?.querySelector(
                        '[role="button"], button',
                    );
                if (trigger instanceof HTMLElement) {
                    trigger.focus();
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onOpenChange]);

    // T056: Auto-focus first interactive element when popover opens
    useEffect(() => {
        if (!isOpen || !popoverRef.current) {
            return;
        }

        // Use a small delay to ensure the popover content is rendered
        const rafId = requestAnimationFrame(() => {
            if (!popoverRef.current) {
                return;
            }

            // Find the first focusable element in the popover
            const focusableSelectors = [
                "input:not([disabled])",
                "button:not([disabled])",
                '[role="combobox"]:not([disabled])',
                '[role="listbox"]:not([disabled])',
                '[tabindex]:not([tabindex="-1"])',
            ].join(", ");

            const firstFocusable = popoverRef.current.querySelector(focusableSelectors);
            if (firstFocusable instanceof HTMLElement) {
                firstFocusable.focus();
            }
        });

        return () => cancelAnimationFrame(rafId);
    }, [isOpen]);

    // Handle horizontal scroll to close popover
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleScroll = (event: Event) => {
            const target = event.target as HTMLElement;
            // Check if this is a horizontal scroll
            if (target?.scrollLeft !== undefined && target.scrollLeft > 0) {
                onOpenChange(false);
            }
        };

        // Listen for scroll events on the grid viewport
        const gridViewport = document.querySelector(".slick-viewport");
        if (gridViewport) {
            gridViewport.addEventListener("scroll", handleScroll);
            return () => gridViewport.removeEventListener("scroll", handleScroll);
        }
    }, [isOpen, onOpenChange]);

    // Determine if Apply should be enabled
    const canApply = (() => {
        if (column.type === "number" && column.filterMode !== "categorical") {
            return pendingValue.trim() !== "" || currentCriteria !== undefined;
        } else if (column.type === "datetime") {
            return pendingValue.trim() !== "" || currentCriteria !== undefined;
        } else if (column.filterMode === "text") {
            return pendingValue.trim() !== "" || currentCriteria !== undefined;
        } else {
            // Default: categorical filter for string columns
            return pendingSelectedValues.length > 0 || currentCriteria !== undefined;
        }
    })();

    // Determine if Clear should be enabled
    const canClear = currentCriteria !== undefined;

    // Create positioning target from anchorElement if provided
    const positioningTarget = anchorElement
        ? { target: anchorElement }
        : undefined;

    // Render the trigger if children are provided, otherwise use an empty fragment
    const triggerContent = children ? (
        <PopoverTrigger disableButtonEnhancement>{children}</PopoverTrigger>
    ) : (
        <></>
    );

    return (
        <Popover
            open={isOpen}
            onOpenChange={(_e, data) => onOpenChange(data.open)}
            positioning={positioningTarget ?? "below-start"}
            trapFocus>
            {triggerContent}
            <PopoverSurface
                ref={popoverRef}
                className={classes.surface}
                role="dialog"
                aria-label={locConstants.profiler.filterColumnTitle(column.header)}>
                {/* Header */}
                <div className={classes.header}>
                    <Text weight="semibold" size={300}>
                        {locConstants.profiler.filterColumnTitle(column.header)}
                    </Text>
                </div>

                {/* Filter content */}
                <div className={classes.content}>
                    {/* Categorical filter: explicit categorical mode OR string columns without text mode */}
                    {(column.filterMode === "categorical" ||
                        (column.type !== "number" &&
                            column.type !== "datetime" &&
                            column.filterMode !== "text")) && (
                        <CategoricalFilter
                            field={column.field}
                            values={distinctValues}
                            selectedValues={pendingSelectedValues}
                            onSelectionChange={handleSelectionChange}
                        />
                    )}
                    {column.type === "number" && column.filterMode !== "categorical" && (
                        <NumericFilter
                            field={column.field}
                            columnName={column.header}
                            operator={pendingOperator}
                            value={pendingValue}
                            error={numericError}
                            onOperatorChange={handleOperatorChange}
                            onValueChange={handleNumericValueChange}
                        />
                    )}
                    {column.type === "datetime" && (
                        <DateFilter
                            field={column.field}
                            operator={pendingOperator}
                            value={pendingValue}
                            error={numericError}
                            onOperatorChange={handleOperatorChange}
                            onValueChange={handleDateValueChange}
                        />
                    )}
                    {/* Text filter: only when explicitly set to text mode */}
                    {column.filterMode === "text" && (
                        <TextFilter
                            field={column.field}
                            columnName={column.header}
                            operator={pendingOperator}
                            value={pendingValue}
                            onOperatorChange={handleOperatorChange}
                            onValueChange={handleTextValueChange}
                        />
                    )}
                </div>

                {/* Action buttons */}
                <div
                    className={classes.actions}
                    role="group"
                    aria-label={locConstants.profiler.filterActions}>
                    <Button
                        appearance="secondary"
                        size="small"
                        onClick={handleClear}
                        disabled={!canClear}
                        aria-label={locConstants.profiler.columnFilterClearLabel(column.header)}>
                        {locConstants.profiler.columnFilterClear}
                    </Button>
                    <Button
                        appearance="primary"
                        size="small"
                        onClick={handleApply}
                        disabled={!canApply}
                        aria-label={locConstants.profiler.columnFilterApplyLabel(column.header)}>
                        {locConstants.profiler.columnFilterApply}
                    </Button>
                </div>
            </PopoverSurface>
        </Popover>
    );
};

const useStyles = makeStyles({
    surface: {
        padding: tokens.spacingVerticalM,
        minWidth: "220px",
        maxWidth: "320px",
        maxHeight: "400px",
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    header: {
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingBottom: tokens.spacingVerticalS,
    },
    content: {
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
    },
    actions: {
        display: "flex",
        justifyContent: "flex-end",
        gap: tokens.spacingHorizontalS,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingTop: tokens.spacingVerticalS,
    },
});

export default ColumnFilterPopover;
