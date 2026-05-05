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

export type FilterOperator =
    | "equals"
    | "notEquals"
    | "contains"
    | "notContains"
    | "startsWith"
    | "endsWith"
    | "greaterThan"
    | "lessThan"
    | "isNull"
    | "isNotNull";

export interface AppliedFilter {
    column: string;
    operator: FilterOperator;
    value: string;
}

interface FilterRow extends AppliedFilter {
    id: string;
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
    conjunction: {
        width: "40px",
        fontSize: "12px",
        color: tokens.colorNeutralForeground2,
        textTransform: "lowercase",
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

function operatorTakesValue(op: FilterOperator): boolean {
    return op !== "isNull" && op !== "isNotNull";
}

function escapeStringLiteral(v: string): string {
    return v.replace(/'/g, "''");
}

function buildPredicate(f: AppliedFilter): string {
    if (!f.column) {
        return "";
    }
    const col = `[${f.column.replace(/]/g, "]]")}]`;
    if (f.operator === "isNull") {
        return `${col} IS NULL`;
    }
    if (f.operator === "isNotNull") {
        return `${col} IS NOT NULL`;
    }
    if (f.value === "") {
        return "";
    }
    const escaped = escapeStringLiteral(f.value);
    const lit = `N'${escaped}'`;
    switch (f.operator) {
        case "equals":
            return `${col} = ${lit}`;
        case "notEquals":
            return `${col} <> ${lit}`;
        case "contains":
            return `${col} LIKE N'%${escaped}%'`;
        case "notContains":
            return `${col} NOT LIKE N'%${escaped}%'`;
        case "startsWith":
            return `${col} LIKE N'${escaped}%'`;
        case "endsWith":
            return `${col} LIKE N'%${escaped}'`;
        case "greaterThan":
            return `${col} > ${lit}`;
        case "lessThan":
            return `${col} < ${lit}`;
        default:
            return "";
    }
}

/**
 * Inject a WHERE clause built from `filters` into `baseQuery`. If `baseQuery`
 * already has a WHERE, the new predicate is appended with AND. If it has an
 * ORDER BY, the WHERE is inserted before it. Returns the original query
 * unchanged when no filter is complete.
 */
export function composeFilteredQuery(baseQuery: string, filters: AppliedFilter[]): string {
    const predicates = filters.map(buildPredicate).filter((p) => p.length > 0);
    if (predicates.length === 0) {
        return baseQuery;
    }
    const newPredicate = predicates.join(" AND ");

    const orderByMatch = baseQuery.match(/\bORDER\s+BY\b/i);
    const head = orderByMatch ? baseQuery.slice(0, orderByMatch.index) : baseQuery;
    const tail = orderByMatch ? baseQuery.slice(orderByMatch.index) : "";

    const hadTrailingSemicolon = /;\s*$/.test(head);
    const normalizedHead = head.replace(/;\s*$/, "");

    const whereMatch = normalizedHead.match(/\bWHERE\b/i);
    let composedHead: string;
    if (whereMatch && whereMatch.index !== undefined) {
        const beforeWhere = normalizedHead.slice(0, whereMatch.index);
        const existing = normalizedHead.slice(whereMatch.index + "WHERE".length).trim();
        composedHead = `${beforeWhere}WHERE (${existing}) AND ${newPredicate} `;
    } else {
        composedHead = `${normalizedHead.trimEnd()}\nWHERE ${newPredicate}\n`;
    }
    return composedHead + tail + (hadTrailingSemicolon && tail === "" ? ";" : "");
}

function newRow(defaultColumn?: string): FilterRow {
    return {
        id: Math.random().toString(36).slice(2),
        column: defaultColumn ?? "",
        operator: "equals",
        value: "",
    };
}

export const TableExplorerFilterBar: React.FC<TableExplorerFilterBarProps> = ({
    columns,
    onApply,
    onClear,
    disabled = false,
}) => {
    const classes = useStyles();
    const defaultColumn = columns[0]?.name ?? "";
    const [rows, setRows] = React.useState<FilterRow[]>(() => [newRow(defaultColumn)]);

    // If columns load after mount, populate the first row's column.
    React.useEffect(() => {
        setRows((prev) => prev.map((r) => (r.column ? r : { ...r, column: defaultColumn })));
    }, [defaultColumn]);

    const updateRow = (id: string, patch: Partial<FilterRow>) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const removeRow = (id: string) => {
        setRows((prev) => {
            const next = prev.filter((r) => r.id !== id);
            return next.length > 0 ? next : [newRow(defaultColumn)];
        });
    };

    const addRow = () => {
        setRows((prev) => [...prev, newRow(defaultColumn)]);
    };

    const handleApply = () => {
        const applied: AppliedFilter[] = rows
            .filter((r) => r.column && (operatorTakesValue(r.operator) ? r.value !== "" : true))
            .map(({ column, operator, value }) => ({ column, operator, value }));
        onApply(applied);
    };

    const handleClear = () => {
        setRows([newRow(defaultColumn)]);
        onClear();
    };

    return (
        <div className={classes.container}>
            {rows.map((row, i) => (
                <div className={classes.row} key={row.id}>
                    <span className={classes.conjunction}>
                        {i === 0 ? loc.tableExplorer.filterWhere : loc.tableExplorer.filterAnd}
                    </span>
                    <Dropdown
                        className={classes.columnDropdown}
                        size="small"
                        value={row.column}
                        selectedOptions={[row.column]}
                        disabled={disabled}
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
                        disabled={disabled || !operatorTakesValue(row.operator)}
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
                <Button appearance="primary" size="small" onClick={handleApply} disabled={disabled}>
                    {loc.tableExplorer.filterApply}
                </Button>
                <Button
                    appearance="transparent"
                    size="small"
                    icon={<AddRegular />}
                    onClick={addRow}
                    disabled={disabled}>
                    {loc.tableExplorer.filterAdd}
                </Button>
                <Button
                    appearance="transparent"
                    size="small"
                    onClick={handleClear}
                    disabled={disabled}>
                    {loc.tableExplorer.filterClear}
                </Button>
            </div>
        </div>
    );
};
