/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
    Dialog,
    DialogSurface,
    DialogTitle,
    DialogBody,
    DialogActions,
    DialogContent,
    Button,
    Field,
    Select,
    Input,
    Link,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { Add20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import {
    FilterClause,
    FilterOperator,
    ProfilerColumnDef,
} from "../../../sharedInterfaces/profiler";
import { locConstants } from "../../common/locConstants";

/**
 * Operators that do not require a value input
 */
const VALUE_NOT_REQUIRED_OPERATORS = [FilterOperator.IsNull, FilterOperator.IsNotNull];

/**
 * Get the display label for a filter operator
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
        case FilterOperator.IsNull:
            return loc.operatorIsNull;
        case FilterOperator.IsNotNull:
            return loc.operatorIsNotNull;
        case FilterOperator.Contains:
            return loc.operatorContains;
        case FilterOperator.NotContains:
            return loc.operatorNotContains;
        case FilterOperator.StartsWith:
            return loc.operatorStartsWith;
        case FilterOperator.NotStartsWith:
            return loc.operatorNotStartsWith;
        default:
            return operator;
    }
}

/**
 * All available filter operators in display order
 */
const ALL_OPERATORS: FilterOperator[] = [
    FilterOperator.Equals,
    FilterOperator.NotEquals,
    FilterOperator.LessThan,
    FilterOperator.LessThanOrEqual,
    FilterOperator.GreaterThan,
    FilterOperator.GreaterThanOrEqual,
    FilterOperator.IsNull,
    FilterOperator.IsNotNull,
    FilterOperator.Contains,
    FilterOperator.NotContains,
    FilterOperator.StartsWith,
    FilterOperator.NotStartsWith,
];

/**
 * Operators for string columns (all operators)
 */
const STRING_OPERATORS: FilterOperator[] = ALL_OPERATORS;

/**
 * Operators for numeric columns (comparison operators, no string-specific ones)
 */
const NUMERIC_OPERATORS: FilterOperator[] = [
    FilterOperator.Equals,
    FilterOperator.NotEquals,
    FilterOperator.LessThan,
    FilterOperator.LessThanOrEqual,
    FilterOperator.GreaterThan,
    FilterOperator.GreaterThanOrEqual,
    FilterOperator.IsNull,
    FilterOperator.IsNotNull,
];

/**
 * Operators for datetime columns (comparison operators, no string-specific ones)
 */
const DATETIME_OPERATORS: FilterOperator[] = [
    FilterOperator.Equals,
    FilterOperator.NotEquals,
    FilterOperator.LessThan,
    FilterOperator.LessThanOrEqual,
    FilterOperator.GreaterThan,
    FilterOperator.GreaterThanOrEqual,
    FilterOperator.IsNull,
    FilterOperator.IsNotNull,
];

/**
 * Get the operators available for a column type
 */
function getOperatorsForColumnType(type: string | undefined): FilterOperator[] {
    switch (type) {
        case "number":
            return NUMERIC_OPERATORS;
        case "datetime":
            return DATETIME_OPERATORS;
        case "string":
        default:
            return STRING_OPERATORS;
    }
}

/**
 * Get the default operator for a column type
 */
function getDefaultOperatorForColumnType(type: string | undefined): FilterOperator {
    switch (type) {
        case "number":
            return FilterOperator.Equals;
        case "datetime":
            return FilterOperator.GreaterThanOrEqual;
        case "string":
        default:
            return FilterOperator.Contains;
    }
}

/**
 * Convert column type to filter type hint
 */
function getTypeHintForColumnType(type: string | undefined): string | undefined {
    switch (type) {
        case "number":
            return "number";
        case "datetime":
            return "datetime";
        case "string":
        default:
            return "string";
    }
}

interface EditableClause {
    id: number;
    field: string;
    operator: FilterOperator;
    value: string;
}

export interface ProfilerFilterDialogProps {
    /** Column definitions from the current view */
    columns: ProfilerColumnDef[];
    /** Current filter clauses */
    currentClauses: ReadonlyArray<FilterClause>;
    /** Whether the dialog is open (controlled) */
    isOpen: boolean;

    /** Default field to pre-select when adding a new clause (from column header click) */
    defaultField?: string;
    /** Callback when dialog open state changes */
    onOpenChange: (open: boolean) => void;
    /** Callback when filter is applied */
    onApplyFilter: (clauses: FilterClause[]) => void;
}

/**
 * Filter dialog for configuring profiler event filters.
 * Supports multiple clauses combined with AND logic.
 */
export const ProfilerFilterDialog: React.FC<ProfilerFilterDialogProps> = ({
    columns,
    currentClauses,
    isOpen,
    defaultField,
    onOpenChange,
    onApplyFilter,
}) => {
    const classes = useStyles();
    const loc = locConstants.profiler;
    const [nextId, setNextId] = useState(1);

    // Convert current clauses to editable format when dialog opens
    const [editableClauses, setEditableClauses] = useState<EditableClause[]>([]);

    // Track the previous length of currentClauses to detect external clear
    const prevClausesLengthRef = useRef(currentClauses.length);

    // Get filterable columns only (moved up before handleOpenChange)
    const filterableColumns = columns.filter((col) => col.filterable !== false);

    // Sync editable clauses when currentClauses is cleared externally (e.g., clear filter from toolbar)
    useEffect(() => {
        // Only reset if currentClauses transitioned from having items to being empty
        // This prevents resetting when user is adding new clauses in the dialog
        if (prevClausesLengthRef.current > 0 && currentClauses.length === 0) {
            setEditableClauses([]);
            setNextId(1);
        }
        prevClausesLengthRef.current = currentClauses.length;
    }, [currentClauses.length]);

    // Initialize editable clauses when dialog opens
    const handleOpenChange = useCallback(
        (_event: unknown, data: { open: boolean }) => {
            if (data.open) {
                // Convert current clauses to editable format
                // Only show clauses that were applied (from currentClauses)
                // Don't auto-add a clause here - user must click "Add Clause"
                const editable: EditableClause[] = currentClauses.map((clause, index) => ({
                    id: index + 1,
                    field: clause.field,
                    operator: clause.operator,
                    value: clause.value?.toString() ?? "",
                }));

                setEditableClauses(editable);
                setNextId(editable.length + 1);
            }
            // When dialog closes (cancel or click outside), state resets on next open
            // because we re-initialize from currentClauses
            onOpenChange(data.open);
        },
        [currentClauses, onOpenChange],
    );

    // Get the column definition for a field
    const getColumnForField = useCallback(
        (field: string) => filterableColumns.find((col) => col.field === field),
        [filterableColumns],
    );

    // Add a new clause - use defaultField (from column header click) if provided, otherwise use first column
    const handleAddClause = useCallback(() => {
        // If defaultField is set (from clicking a column header), use that column
        // Otherwise fall back to the first filterable column
        const targetColumn = defaultField
            ? filterableColumns.find((col) => col.field === defaultField)
            : filterableColumns[0];
        const targetFieldName = targetColumn?.field ?? filterableColumns[0]?.field ?? "";
        const targetOperator = getDefaultOperatorForColumnType(targetColumn?.type);
        setEditableClauses((prev) => [
            ...prev,
            {
                id: nextId,
                field: targetFieldName,
                operator: targetOperator,
                value: "",
            },
        ]);
        setNextId((prev) => prev + 1);

        // Announce to screen readers
        const announcement = document.createElement("div");
        announcement.setAttribute("role", "status");
        announcement.setAttribute("aria-live", "polite");
        announcement.className = "sr-only";
        announcement.textContent = loc.clauseAdded;
        document.body.appendChild(announcement);
        setTimeout(() => document.body.removeChild(announcement), 1000);
    }, [defaultField, filterableColumns, nextId, loc.clauseAdded]);

    // Remove a clause
    const handleRemoveClause = useCallback((id: number) => {
        setEditableClauses((prev) => prev.filter((c) => c.id !== id));
    }, []);

    // Update a clause field - also update operator if current one isn't valid for new column type
    const handleFieldChange = useCallback(
        (id: number, field: string) => {
            const newColumn = getColumnForField(field);
            const validOperators = getOperatorsForColumnType(newColumn?.type);

            setEditableClauses((prev) =>
                prev.map((c) => {
                    if (c.id !== id) {
                        return c;
                    }
                    // Check if current operator is valid for new column type
                    const isOperatorValid = validOperators.includes(c.operator);
                    return {
                        ...c,
                        field,
                        // Reset operator to default if current one isn't valid
                        operator: isOperatorValid
                            ? c.operator
                            : getDefaultOperatorForColumnType(newColumn?.type),
                    };
                }),
            );
        },
        [getColumnForField],
    );

    // Update a clause operator
    const handleOperatorChange = useCallback((id: number, operator: FilterOperator) => {
        setEditableClauses((prev) => prev.map((c) => (c.id === id ? { ...c, operator } : c)));
    }, []);

    // Update a clause value
    const handleValueChange = useCallback((id: number, value: string) => {
        setEditableClauses((prev) => prev.map((c) => (c.id === id ? { ...c, value } : c)));
    }, []);

    // Apply filter
    const handleApply = useCallback(() => {
        // Convert editable clauses to FilterClause format
        // Only include clauses with a field selected
        const clauses: FilterClause[] = editableClauses
            .filter((c) => c.field)
            .map((c) => {
                const column = getColumnForField(c.field);
                const typeHint = getTypeHintForColumnType(column?.type);
                return {
                    field: c.field,
                    operator: c.operator,
                    value: VALUE_NOT_REQUIRED_OPERATORS.includes(c.operator) ? undefined : c.value,
                    typeHint: typeHint as "string" | "number" | "date" | "datetime" | "boolean" | undefined,
                };
            });

        onApplyFilter(clauses);
    }, [editableClauses, getColumnForField, onApplyFilter]);

    // Cancel without applying - reset to the last applied state
    const handleCancel = useCallback(() => {
        // Reset editable clauses to the currently applied clauses
        const editable: EditableClause[] = currentClauses.map((clause, index) => ({
            id: index + 1,
            field: clause.field,
            operator: clause.operator,
            value: clause.value?.toString() ?? "",
        }));
        setEditableClauses(editable);
        setNextId(editable.length + 1);
        onOpenChange(false);
    }, [currentClauses, onOpenChange]);

    // OK button - apply filter and close dialog
    const handleOk = useCallback(() => {
        handleApply();
        onOpenChange(false);
    }, [handleApply, onOpenChange]);

    // Clear all clauses (inline action)
    const handleClearAll = useCallback(() => {
        setEditableClauses([]);
        setNextId(1);

        // Announce to screen readers
        const announcement = document.createElement("div");
        announcement.setAttribute("role", "status");
        announcement.setAttribute("aria-live", "polite");
        announcement.className = "sr-only";
        announcement.textContent = loc.allClausesCleared;
        document.body.appendChild(announcement);
        setTimeout(() => document.body.removeChild(announcement), 1000);
    }, [loc.allClausesCleared]);

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogSurface aria-describedby="filter-dialog-description">
                <DialogBody>
                    <DialogTitle>{loc.filterDialogTitle}</DialogTitle>
                    <DialogContent id="filter-dialog-description" className={classes.dialogContent}>
                        {editableClauses.length === 0 ? (
                            <div className={classes.emptyState}>{loc.noFilterClauses}</div>
                        ) : (
                            editableClauses.map((clause) => (
                                <div key={clause.id} className={classes.clauseRow}>
                                    <Field label={loc.filterColumn} className={classes.clauseField}>
                                        <Select
                                            aria-label={loc.filterColumn}
                                            value={clause.field}
                                            onChange={(_e, data) =>
                                                handleFieldChange(clause.id, data.value)
                                            }>
                                            {filterableColumns.map((col) => (
                                                <option key={col.field} value={col.field}>
                                                    {col.header}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field
                                        label={loc.filterOperator}
                                        className={classes.clauseOperator}>
                                        <Select
                                            aria-label={loc.filterOperator}
                                            value={clause.operator}
                                            onChange={(_e, data) =>
                                                handleOperatorChange(
                                                    clause.id,
                                                    data.value as FilterOperator,
                                                )
                                            }>
                                            {getOperatorsForColumnType(
                                                getColumnForField(clause.field)?.type,
                                            ).map((op) => (
                                                <option key={op} value={op}>
                                                    {getOperatorLabel(op)}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    {!VALUE_NOT_REQUIRED_OPERATORS.includes(clause.operator) && (
                                        <Field
                                            label={loc.filterValue}
                                            className={classes.clauseValue}>
                                            <Input
                                                aria-label={loc.filterValue}
                                                value={clause.value}
                                                placeholder={
                                                    getColumnForField(clause.field)?.type ===
                                                    "datetime"
                                                        ? "YYYY-MM-DD HH:mm:ss"
                                                        : undefined
                                                }
                                                onChange={(_e, data) =>
                                                    handleValueChange(clause.id, data.value)
                                                }
                                            />
                                        </Field>
                                    )}
                                    <Button
                                        appearance="subtle"
                                        icon={<Dismiss20Regular />}
                                        className={classes.removeButton}
                                        aria-label={loc.removeClause}
                                        title={loc.removeClause}
                                        onClick={() => handleRemoveClause(clause.id)}
                                    />
                                </div>
                            ))
                        )}
                        {/* Action links: Add a clause, Clear all */}
                        <div className={classes.actionLinks}>
                            <Link
                                as="button"
                                appearance="subtle"
                                onClick={handleAddClause}
                                aria-label={loc.addClause}
                                className={classes.actionLink}
                            >
                                <Add20Regular className={classes.actionLinkIcon} />
                                {loc.addClause}
                            </Link>
                            {editableClauses.length > 0 && (
                                <Link
                                    as="button"
                                    appearance="subtle"
                                    onClick={handleClearAll}
                                    aria-label={loc.clearAll}
                                    className={classes.actionLink}
                                >
                                    {loc.clearAll}
                                </Link>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={handleApply}>
                            {loc.apply}
                        </Button>
                        <Button appearance="primary" onClick={handleOk}>
                            {loc.ok}
                        </Button>
                        <Button appearance="secondary" onClick={handleCancel}>
                            {loc.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

// #region Styles

const useStyles = makeStyles({
    dialogContent: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        minWidth: "500px",
    },
    clauseRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: tokens.spacingHorizontalS,
        padding: tokens.spacingVerticalS,
        backgroundColor: tokens.colorNeutralBackground2,
        borderRadius: tokens.borderRadiusMedium,
    },
    clauseField: {
        flex: 1,
    },
    clauseOperator: {
        flex: 1,
    },
    clauseValue: {
        flex: 2,
    },
    removeButton: {
        minWidth: "auto",
        padding: tokens.spacingHorizontalXS,
        marginTop: "24px", // Align with input fields that have labels
    },
    actionLinks: {
        display: "flex",
        flexDirection: "row",
        gap: tokens.spacingHorizontalL,
        alignItems: "center",
        marginTop: tokens.spacingVerticalS,
    },
    actionLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        cursor: "pointer",
        fontSize: tokens.fontSizeBase300,
    },
    actionLinkIcon: {
        fontSize: "16px",
    },
    emptyState: {
        textAlign: "center",
        padding: tokens.spacingVerticalL,
        color: tokens.colorNeutralForeground3,
    },
});

// #endregion
