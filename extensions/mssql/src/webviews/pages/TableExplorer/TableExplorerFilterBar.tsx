/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    Button,
    Dropdown,
    Option,
    Input,
    makeStyles,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { DismissRegular, AddRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import {
    AppliedFilter,
    FilterConjunction,
    FilterOperator,
    operatorTakesValue,
} from "../../../tableExplorer/tableQueryComposer";

export type { AppliedFilter, FilterConjunction, FilterOperator };

interface FilterRow extends AppliedFilter {
    id: string;
    conjunction: FilterConjunction;
}

interface ColumnOption {
    id: string;
    name: string;
}

interface TableExplorerFilterBarProps {
    columns: ColumnOption[];
    onApply: (filters: AppliedFilter[]) => void;
    onClear: () => void;
    disabled?: boolean;
    initialFilters?: AppliedFilter[];
    isOpen?: boolean;
}

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("4px"),
        ...shorthands.padding("8px", "12px"),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    },
    row: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    conjunctionLabel: {
        width: "80px",
        paddingLeft: "10px",
        boxSizing: "border-box",
        fontSize: "12px",
        color: tokens.colorNeutralForeground2,
    },
    conjunctionDropdown: {
        width: "80px",
        minWidth: "80px",
    },
    columnDropdown: {
        minWidth: "140px",
    },
    operatorDropdown: {
        minWidth: "120px",
    },
    valueInput: {
        flex: "0 1 240px",
    },
    actions: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("12px"),
        marginTop: "4px",
    },
    linkButton: {
        backgroundColor: "transparent",
        ...shorthands.border("none"),
        color: tokens.colorBrandForegroundLink,
        cursor: "pointer",
        fontSize: "12px",
        ...shorthands.padding("4px"),
    },
});

const OPERATORS: { value: FilterOperator; labelKey: keyof typeof OPERATOR_LABELS }[] = [
    { value: "equals", labelKey: "equals" },
    { value: "notEquals", labelKey: "notEquals" },
    { value: "contains", labelKey: "contains" },
    { value: "notContains", labelKey: "notContains" },
    { value: "startsWith", labelKey: "startsWith" },
    { value: "endsWith", labelKey: "endsWith" },
    { value: "greaterThan", labelKey: "greaterThan" },
    { value: "lessThan", labelKey: "lessThan" },
    { value: "isNull", labelKey: "isNull" },
    { value: "isNotNull", labelKey: "isNotNull" },
];

const OPERATOR_LABELS = {
    equals: () => loc.tableExplorer.filterOpEquals,
    notEquals: () => loc.tableExplorer.filterOpNotEquals,
    contains: () => loc.tableExplorer.filterOpContains,
    notContains: () => loc.tableExplorer.filterOpNotContains,
    startsWith: () => loc.tableExplorer.filterOpStartsWith,
    endsWith: () => loc.tableExplorer.filterOpEndsWith,
    greaterThan: () => loc.tableExplorer.filterOpGreaterThan,
    lessThan: () => loc.tableExplorer.filterOpLessThan,
    isNull: () => loc.tableExplorer.filterOpIsNull,
    isNotNull: () => loc.tableExplorer.filterOpIsNotNull,
};

function newRow(defaultColumn?: string): FilterRow {
    return {
        id: crypto.randomUUID(),
        column: defaultColumn ?? "",
        operator: "equals",
        value: "",
        conjunction: "AND",
    };
}

function appliedFilterToRow(filter: AppliedFilter, defaultColumn: string): FilterRow {
    return {
        id: crypto.randomUUID(),
        column: filter.column || defaultColumn,
        operator: filter.operator,
        value: filter.value,
        conjunction: filter.conjunction || "AND",
    };
}

export const TableExplorerFilterBar: React.FC<TableExplorerFilterBarProps> = ({
    columns,
    onApply,
    onClear,
    disabled = false,
    initialFilters = [],
    isOpen = true,
}) => {
    const classes = useStyles();
    const defaultColumn = columns[0]?.name ?? "";
    const prevInitialFiltersRef = React.useRef<AppliedFilter[]>([]);
    const valueInputRefs = React.useRef<Map<string, HTMLInputElement>>(new Map());
    const prevIsOpenRef = React.useRef<boolean>(false);
    const pendingFocusRowIdRef = React.useRef<string | null>(null);

    const [rows, setRows] = React.useState<FilterRow[]>(() => {
        if (initialFilters.length > 0) {
            return initialFilters.map((f) => appliedFilterToRow(f, defaultColumn));
        }
        return [];
    });

    // Update rows when initialFilters change (e.g., when filters are applied or cleared)
    React.useEffect(() => {
        const prev = prevInitialFiltersRef.current;

        // Check if initialFilters actually changed
        const filtersChanged =
            prev.length !== initialFilters.length ||
            prev.some((pf, i) => {
                const cf = initialFilters[i];
                return (
                    !cf ||
                    pf.column !== cf.column ||
                    pf.operator !== cf.operator ||
                    pf.value !== cf.value ||
                    pf.conjunction !== cf.conjunction
                );
            });

        if (!filtersChanged) {
            return;
        }

        prevInitialFiltersRef.current = initialFilters;

        if (initialFilters.length > 0) {
            setRows(initialFilters.map((f) => appliedFilterToRow(f, defaultColumn)));
        } else {
            setRows([]);
        }
    }, [initialFilters, defaultColumn]);

    // If columns load after mount, populate the first row's column.
    React.useEffect(() => {
        setRows((prev) => prev.map((r) => (r.column ? r : { ...r, column: defaultColumn })));
    }, [defaultColumn]);

    // When the panel opens, ensure there's at least one row to fill in and
    // arm focus to land in its value input once the row has rendered.
    React.useEffect(() => {
        const wasOpen = prevIsOpenRef.current;
        prevIsOpenRef.current = isOpen;
        if (!isOpen || wasOpen) {
            return;
        }
        setRows((prev) => {
            if (prev.length === 0) {
                const row = newRow(defaultColumn);
                pendingFocusRowIdRef.current = row.id;
                return [row];
            }
            pendingFocusRowIdRef.current = prev[0].id;
            return prev;
        });
    }, [isOpen, defaultColumn]);

    // Apply queued focus once the target row is mounted. We wait one frame so
    // the parent's display:none → visible transition has painted (no-op when
    // the panel was already open, e.g. after clicking Add Filter).
    React.useEffect(() => {
        const targetId = pendingFocusRowIdRef.current;
        if (!targetId || !isOpen) {
            return;
        }
        const el = valueInputRefs.current.get(targetId);
        if (!el) {
            // Row hasn't committed yet; this effect will re-run when rows.length changes.
            return;
        }
        pendingFocusRowIdRef.current = null;
        const id = requestAnimationFrame(() => {
            el.focus();
        });
        return () => cancelAnimationFrame(id);
    }, [isOpen, rows.length]);

    const updateRow = (id: string, patch: Partial<FilterRow>) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const removeRow = (id: string) => {
        setRows((prev) => prev.filter((r) => r.id !== id));
    };

    const addRow = () => {
        const row = newRow(defaultColumn);
        setRows((prev) => [...prev, row]);
        pendingFocusRowIdRef.current = row.id;
    };

    const handleApply = () => {
        const applied: AppliedFilter[] = rows
            .filter((r) => r.column && (operatorTakesValue(r.operator) ? r.value !== "" : true))
            .map(({ column, operator, value, conjunction }) => ({
                column,
                operator,
                value,
                conjunction,
            }));
        onApply(applied);
    };

    const handleClear = () => {
        setRows([]);
        onClear();
    };

    // Check if current filters differ from the initialFilters (last applied)
    const hasChanges = React.useMemo(() => {
        const currentValid = rows.filter(
            (r) => r.column && (operatorTakesValue(r.operator) ? r.value !== "" : true),
        );

        // Different number of filters = changed
        if (currentValid.length !== initialFilters.length) {
            return true;
        }

        // Compare each filter
        return currentValid.some((row, i) => {
            const initial = initialFilters[i];
            if (!initial) {
                return true;
            }
            return (
                row.column !== initial.column ||
                row.operator !== initial.operator ||
                row.value !== initial.value ||
                row.conjunction !== initial.conjunction
            );
        });
    }, [rows, initialFilters]);

    return (
        <div className={classes.container}>
            {rows.map((row, i) => (
                <div className={classes.row} key={row.id}>
                    {i === 0 ? (
                        <span className={classes.conjunctionLabel}>
                            {loc.tableExplorer.filterWhere}
                        </span>
                    ) : (
                        <Dropdown
                            className={classes.conjunctionDropdown}
                            size="small"
                            value={row.conjunction}
                            selectedOptions={[row.conjunction]}
                            disabled={disabled}
                            aria-label={loc.tableExplorer.filterLogicalOperator}
                            onOptionSelect={(_, data) =>
                                updateRow(row.id, {
                                    conjunction:
                                        (data.optionValue?.toUpperCase() as FilterConjunction) ??
                                        "AND",
                                })
                            }>
                            <Option value="AND">AND</Option>
                            <Option value="OR">OR</Option>
                        </Dropdown>
                    )}
                    <Dropdown
                        className={classes.columnDropdown}
                        size="small"
                        value={row.column}
                        selectedOptions={[row.column]}
                        disabled={disabled}
                        aria-label={loc.tableExplorer.filterColumn}
                        onOptionSelect={(_, data) =>
                            updateRow(row.id, { column: data.optionValue ?? "" })
                        }>
                        {columns.map((c) => (
                            <Option key={c.id} value={c.name}>
                                {c.name}
                            </Option>
                        ))}
                    </Dropdown>
                    <Dropdown
                        className={classes.operatorDropdown}
                        size="small"
                        value={OPERATOR_LABELS[row.operator]()}
                        selectedOptions={[row.operator]}
                        disabled={disabled}
                        aria-label={loc.tableExplorer.filterOperator}
                        onOptionSelect={(_, data) =>
                            updateRow(row.id, {
                                operator: (data.optionValue as FilterOperator) ?? "equals",
                            })
                        }>
                        {OPERATORS.map((op) => (
                            <Option key={op.value} value={op.value}>
                                {OPERATOR_LABELS[op.labelKey]()}
                            </Option>
                        ))}
                    </Dropdown>
                    <Input
                        className={classes.valueInput}
                        size="small"
                        value={row.value}
                        placeholder={loc.tableExplorer.filterValuePlaceholder}
                        aria-label={loc.tableExplorer.filterValue}
                        disabled={disabled || !operatorTakesValue(row.operator)}
                        input={{
                            ref: (el: HTMLInputElement | null) => {
                                if (el) {
                                    valueInputRefs.current.set(row.id, el);
                                } else {
                                    valueInputRefs.current.delete(row.id);
                                }
                            },
                        }}
                        onChange={(_, data) => updateRow(row.id, { value: data.value })}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleApply();
                            }
                        }}
                    />
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<DismissRegular />}
                        aria-label={loc.tableExplorer.filterRemove}
                        title={loc.tableExplorer.filterRemove}
                        disabled={disabled}
                        onClick={() => removeRow(row.id)}
                    />
                </div>
            ))}
            <div className={classes.actions}>
                <Button
                    appearance={rows.length === 0 ? "primary" : "transparent"}
                    size="small"
                    icon={<AddRegular />}
                    onClick={addRow}
                    disabled={disabled}>
                    {loc.tableExplorer.filterAdd}
                </Button>
                <Button
                    appearance="primary"
                    size="small"
                    onClick={handleApply}
                    disabled={disabled || !hasChanges}>
                    {loc.tableExplorer.filterApply}
                </Button>
                <Button
                    appearance="transparent"
                    size="small"
                    onClick={handleClear}
                    disabled={disabled || (rows.length === 0 && initialFilters.length === 0)}>
                    {loc.tableExplorer.filterClear}
                </Button>
            </div>
        </div>
    );
};
