/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
    Button,
    Input,
    Select,
    Checkbox,
    Divider,
    makeStyles,
    tokens,
    Text,
} from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import {
    FilterClause,
    FilterOperator,
    FilterType,
    FilterTypeHint,
    ColumnDataType,
    ProfilerColumnDef,
} from "../../../sharedInterfaces/profiler";
import { locConstants } from "../../common/locConstants";

/** Maximum character length for text filter inputs */
const MAX_TEXT_INPUT_LENGTH = 1000;

// ─── Operator lists ──────────────────────────────────────────────────────────

/**
 * Operators for text (long string) columns
 */
const TEXT_OPERATORS: FilterOperator[] = [
    FilterOperator.Contains,
    FilterOperator.Equals,
    FilterOperator.NotEquals,
    FilterOperator.StartsWith,
    FilterOperator.EndsWith,
];

/**
 * Operators for numeric columns
 */
const NUMERIC_OPERATORS: FilterOperator[] = [
    FilterOperator.Equals,
    FilterOperator.NotEquals,
    FilterOperator.GreaterThan,
    FilterOperator.GreaterThanOrEqual,
    FilterOperator.LessThan,
    FilterOperator.LessThanOrEqual,
];

/**
 * Operators for datetime columns
 */
const DATETIME_OPERATORS: FilterOperator[] = [
    FilterOperator.Equals,
    FilterOperator.NotEquals,
    FilterOperator.GreaterThan,
    FilterOperator.GreaterThanOrEqual,
    FilterOperator.LessThan,
    FilterOperator.LessThanOrEqual,
];

/**
 * Get a human-readable label for a filter operator
 */
function getOperatorLabel(operator: FilterOperator): string {
    const loc = locConstants.profiler;
    switch (operator) {
        case FilterOperator.Equals:
            return loc.operatorEquals;
        case FilterOperator.NotEquals:
            return loc.operatorNotEquals;
        case FilterOperator.LessThan:
            return loc.operatorLessThan;
        case FilterOperator.LessThanOrEqual:
            return loc.operatorLessThanOrEqual;
        case FilterOperator.GreaterThan:
            return loc.operatorGreaterThan;
        case FilterOperator.GreaterThanOrEqual:
            return loc.operatorGreaterThanOrEqual;
        case FilterOperator.Contains:
            return loc.operatorContains;
        case FilterOperator.StartsWith:
            return loc.operatorStartsWith;
        case FilterOperator.EndsWith:
            return loc.operatorEndsWith;
        default:
            return operator;
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColumnFilterPopoverProps {
    /** The column being filtered */
    column: ProfilerColumnDef;
    /** Bounding rect of the funnel icon that triggered the popover */
    anchorRect: DOMRect | undefined;
    /** Whether the popover is open */
    isOpen: boolean;
    /** Current filter clause for this column (if any) */
    currentClause: FilterClause | undefined;
    /** Distinct values for categorical columns */
    distinctValues: string[];
    /** Callback when popover should close (without applying) */
    onClose: () => void;
    /** Callback when filter is applied for this column */
    onApply: (clause: FilterClause) => void;
    /** Callback when filter is cleared for this column */
    onClear: () => void;
}

/**
 * Determine the filter type for a column based on its type and filterType.
 * Falls back to ColumnDataType mapping when filterType is not explicitly set.
 */
export function getFilterType(column: ProfilerColumnDef): FilterType {
    // Use explicit filterType if set
    if (column.filterType) {
        return column.filterType;
    }
    // Fall back to ColumnDataType mapping
    if (column.type === ColumnDataType.Number) {
        return FilterType.Numeric;
    }
    if (column.type === ColumnDataType.DateTime) {
        return FilterType.Date;
    }
    return FilterType.Text;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Inline filter popover anchored to a column header's funnel icon.
 * Standalone component — can be cleanly removed without affecting ProfilerFilterDialog.
 */
export const ProfilerColumnFilterPopover: React.FC<ColumnFilterPopoverProps> = ({
    column,
    anchorRect,
    isOpen,
    currentClause,
    distinctValues,
    onClose,
    onApply,
    onClear,
}) => {
    const classes = useStyles();
    // eslint-disable-next-line no-restricted-syntax -- DOM refs require null initialization in React
    const popoverRef = useRef<HTMLDivElement>(null);
    const filterType = getFilterType(column);

    // ── Local state ──────────────────────────────────────────────────────────

    // Text / numeric / date operator + value
    const [operator, setOperator] = useState<FilterOperator>(FilterOperator.Contains);
    const [inputValue, setInputValue] = useState("");
    const [validationError, setValidationError] = useState<string | undefined>(undefined);

    // Categorical state
    const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");

    const loc = locConstants.profiler;

    /** All categorical values including the empty string for the "(empty)" option */
    const allCategoricalValues = useMemo(() => {
        return ["", ...distinctValues];
    }, [distinctValues]);

    // ── Initialize from currentClause when popover opens ─────────────────────

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (currentClause) {
            if (
                filterType === FilterType.Categorical &&
                currentClause.operator === FilterOperator.In
            ) {
                setSelectedValues(new Set(currentClause.values ?? []));
            } else {
                setOperator(currentClause.operator);
                setInputValue(currentClause.value !== undefined ? String(currentClause.value) : "");
            }
        } else {
            // Reset to defaults
            if (filterType === FilterType.Categorical) {
                // When no filter is active, all values are selected (no filtering)
                setSelectedValues(new Set(["", ...distinctValues]));
            } else if (filterType === FilterType.Numeric) {
                setOperator(FilterOperator.Equals);
                setInputValue("");
            } else if (filterType === FilterType.Date) {
                setOperator(FilterOperator.GreaterThanOrEqual);
                setInputValue("");
            } else {
                setOperator(FilterOperator.Contains);
                setInputValue("");
            }
        }
        setSearchTerm("");
        setValidationError(undefined);
    }, [isOpen, currentClause, filterType, distinctValues]);

    // ── Close on click outside ──────────────────────────────────────────────

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        // Use requestAnimationFrame to avoid closing immediately from the click that opened it
        requestAnimationFrame(() => {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleKeyDown);
        });
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    // ── Auto-position ────────────────────────────────────────────────────────

    // Dynamically position the popover relative to the anchor element.
    // Uses a ref-based approach to avoid inline styles (which violate lint rules).
    useEffect(() => {
        if (!isOpen || !popoverRef.current) {
            return;
        }
        const el = popoverRef.current;
        if (!anchorRect) {
            el.style.display = "none";
            return;
        }
        const popoverWidth = 280;
        const popoverMaxHeight = 400;
        const margin = 4;

        let left = anchorRect.left;
        let top = anchorRect.bottom + margin;

        // Flip horizontally if near right edge
        if (left + popoverWidth > window.innerWidth) {
            left = Math.max(0, anchorRect.right - popoverWidth);
        }

        // Flip vertically if near bottom edge
        if (top + popoverMaxHeight > window.innerHeight) {
            top = Math.max(0, anchorRect.top - popoverMaxHeight - margin);
        }

        el.style.position = "fixed";
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${popoverWidth}px`;
        el.style.maxHeight = `${popoverMaxHeight}px`;
        el.style.zIndex = "10000";
        el.style.display = "";
    }, [isOpen, anchorRect]);

    // ── Validation ───────────────────────────────────────────────────────────

    /** Regex for YYYY-MM-DD HH:mm:ss or YYYY-MM-DD HH:mm:ss.SSS */
    const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

    const validateDateTimeFormat = useCallback(
        (value: string): boolean => {
            if (value === "") {
                setValidationError(undefined);
                return true;
            }
            if (!DATETIME_REGEX.test(value)) {
                setValidationError(loc.dateFormatError);
                return false;
            }
            const d = new Date(value.replace(" ", "T"));
            if (isNaN(d.getTime())) {
                setValidationError(loc.dateFormatError);
                return false;
            }
            setValidationError(undefined);
            return true;
        },
        [loc.dateFormatError],
    );

    const validate = useCallback((): boolean => {
        if (filterType === FilterType.Numeric) {
            if (inputValue.trim() === "") {
                setValidationError("Value is required");
                return false;
            }
            if (isNaN(Number(inputValue.trim()))) {
                setValidationError("Must be a valid number");
                return false;
            }
        }
        if (filterType === FilterType.Date) {
            if (inputValue.trim() === "") {
                setValidationError("Value is required");
                return false;
            }
            if (!validateDateTimeFormat(inputValue.trim())) {
                return false;
            }
        }
        setValidationError(undefined);
        return true;
    }, [filterType, inputValue, validateDateTimeFormat]);

    // ── Apply handler ────────────────────────────────────────────────────────

    const handleApply = useCallback(() => {
        if (filterType === FilterType.Categorical) {
            // If all values are selected, effectively no filter
            if (selectedValues.size === allCategoricalValues.length) {
                onClear();
                return;
            }
            // selectedValues.size === 0 is blocked by disabled button
            onApply({
                field: column.field,
                operator: FilterOperator.In,
                values: Array.from(selectedValues),
                typeHint: FilterTypeHint.String,
            });
        } else {
            if (!validate()) {
                return;
            }
            const typeHint =
                filterType === FilterType.Numeric
                    ? FilterTypeHint.Number
                    : filterType === FilterType.Date
                      ? FilterTypeHint.DateTime
                      : FilterTypeHint.String;

            const value =
                filterType === FilterType.Numeric ? Number(inputValue.trim()) : inputValue.trim();

            onApply({
                field: column.field,
                operator,
                value,
                typeHint,
            });
        }
    }, [
        filterType,
        column.field,
        operator,
        inputValue,
        selectedValues,
        allCategoricalValues,
        validate,
        onApply,
        onClear,
    ]);

    // ── Categorical helpers ──────────────────────────────────────────────────

    const filteredDistinctValues = useMemo(() => {
        if (!searchTerm.trim()) {
            return distinctValues;
        }
        const term = searchTerm.toLowerCase();
        return distinctValues.filter((v) => v.toLowerCase().includes(term));
    }, [distinctValues, searchTerm]);

    const toggleValue = useCallback((value: string) => {
        setSelectedValues((prev) => {
            const next = new Set(prev);
            if (next.has(value)) {
                next.delete(value);
            } else {
                next.add(value);
            }
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        setSelectedValues(new Set(allCategoricalValues));
    }, [allCategoricalValues]);

    const handleDeselectAll = useCallback(() => {
        setSelectedValues(new Set());
    }, []);

    // ── Render nothing if closed ──────────────────────────────────────────────

    if (!isOpen) {
        // eslint-disable-next-line no-restricted-syntax -- React components return null to render nothing
        return null;
    }

    // ── Determine which operator list to show ───────────────────────────────

    const operators =
        filterType === FilterType.Numeric
            ? NUMERIC_OPERATORS
            : filterType === FilterType.Date
              ? DATETIME_OPERATORS
              : TEXT_OPERATORS;

    // ── Placeholder / hint ──────────────────────────────────────────────────

    const inputPlaceholder =
        filterType === FilterType.Numeric
            ? loc.enterNumber
            : filterType === FilterType.Date
              ? loc.enterDateFormat
              : loc.enterText;

    const hintText =
        filterType === FilterType.Numeric
            ? loc.numericFilterHint(column.header)
            : filterType === FilterType.Text
              ? loc.textFilterHint(column.header)
              : undefined;

    return (
        <div
            ref={popoverRef}
            className={classes.popover}
            role="dialog"
            aria-label={loc.filterColumnHeader(column.header)}
            onKeyDown={(e) => {
                if (e.key === "Enter" && filterType !== FilterType.Categorical) {
                    handleApply();
                }
            }}>
            {/* Header */}
            <div className={classes.headerRow}>
                <Text weight="semibold" className={classes.header}>
                    {loc.filterColumnHeader(column.header)}
                </Text>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular />}
                    onClick={onClose}
                    aria-label={loc.closePopover}
                    className={classes.closeButton}
                />
            </div>
            <Divider className={classes.divider} />

            {/* Filter content */}
            <div className={classes.content}>
                {filterType === FilterType.Categorical ? (
                    /* ── Categorical: searchable checkbox list ─────────────── */
                    <>
                        <Input
                            className={classes.searchInput}
                            placeholder={loc.searchValues}
                            value={searchTerm}
                            onChange={(_e, data) =>
                                setSearchTerm((data.value ?? "").slice(0, MAX_TEXT_INPUT_LENGTH))
                            }
                            aria-label={loc.searchValues}
                            autoFocus
                        />
                        <div className={classes.selectActions}>
                            <Button appearance="transparent" size="small" onClick={handleSelectAll}>
                                {loc.selectAll}
                            </Button>
                            <Button
                                appearance="transparent"
                                size="small"
                                onClick={handleDeselectAll}>
                                {loc.deselectAll}
                            </Button>
                            <Text size={200} className={classes.selectedCount}>
                                {loc.selectedCount(
                                    selectedValues.size,
                                    allCategoricalValues.length,
                                )}
                            </Text>
                        </div>
                        <Divider className={classes.divider} />
                        <div
                            className={classes.checkboxList}
                            role="group"
                            aria-label={loc.filterColumnHeader(column.header)}>
                            {/* Always show an empty category option */}
                            <Checkbox
                                key="__empty__"
                                label={loc.emptyCategory}
                                checked={selectedValues.has("")}
                                onChange={() => toggleValue("")}
                                className={classes.checkboxItem}
                            />
                            {filteredDistinctValues.map((value) => (
                                <Checkbox
                                    key={value}
                                    label={value || loc.emptyCategory}
                                    checked={selectedValues.has(value)}
                                    onChange={() => toggleValue(value)}
                                    className={classes.checkboxItem}
                                />
                            ))}
                        </div>
                    </>
                ) : (
                    /* ── Numeric / Text / Date: operator + value ──────────── */
                    <>
                        <Select
                            className={classes.operatorSelect}
                            value={operator}
                            onChange={(_e, data) => setOperator(data.value as FilterOperator)}
                            aria-label={loc.filterOperator}>
                            {operators.map((op) => (
                                <option key={op} value={op}>
                                    {getOperatorLabel(op)}
                                </option>
                            ))}
                        </Select>
                        <Input
                            className={classes.valueInput}
                            placeholder={inputPlaceholder}
                            value={inputValue}
                            onChange={(_e, data) => {
                                setInputValue((data.value ?? "").slice(0, MAX_TEXT_INPUT_LENGTH));
                                if (filterType === FilterType.Date) {
                                    validateDateTimeFormat((data.value ?? "").trim());
                                } else {
                                    setValidationError(undefined);
                                }
                            }}
                            type={filterType === FilterType.Numeric ? "number" : "text"}
                            aria-label={loc.filterValue}
                            autoFocus
                        />
                        {validationError && (
                            <Text className={classes.validationError} size={200}>
                                {validationError}
                            </Text>
                        )}
                    </>
                )}
            </div>

            {/* Actions */}
            <Divider className={classes.divider} />
            <div className={classes.actions}>
                <Button
                    appearance="primary"
                    size="small"
                    onClick={handleApply}
                    disabled={
                        filterType === FilterType.Categorical && selectedValues.size === 0
                    }>
                    {loc.applyFilter}
                </Button>
                <Button appearance="subtle" size="small" onClick={onClear}>
                    {loc.clearColumnFilter}
                </Button>
            </div>

            {/* Hint (numeric / text only) */}
            {hintText && (
                <>
                    <Divider className={classes.divider} />
                    <Text className={classes.hint} size={200}>
                        {hintText}
                    </Text>
                </>
            )}
        </div>
    );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
    popover: {
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        boxShadow: tokens.shadow16,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px 4px",
    },
    header: {
        fontSize: tokens.fontSizeBase300,
        flex: 1,
    },
    closeButton: {
        minWidth: "auto",
        padding: "2px",
        flexShrink: 0,
    },
    divider: {
        margin: "0",
    },
    content: {
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        overflowY: "auto",
        flex: 1,
    },
    searchInput: {
        width: "100%",
    },
    selectActions: {
        display: "flex",
        gap: "4px",
        alignItems: "center",
    },
    selectedCount: {
        color: tokens.colorNeutralForeground3,
        marginLeft: "auto",
        whiteSpace: "nowrap",
    },
    checkboxList: {
        maxHeight: "200px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
    },
    checkboxItem: {
        padding: "2px 0",
    },
    operatorSelect: {
        width: "100%",
    },
    valueInput: {
        width: "100%",
    },
    validationError: {
        color: tokens.colorPaletteRedForeground1,
    },
    actions: {
        display: "flex",
        gap: "8px",
        padding: "8px 12px",
        justifyContent: "flex-start",
    },
    hint: {
        padding: "4px 12px 8px",
        color: tokens.colorNeutralForeground3,
        fontStyle: "italic",
    },
});
