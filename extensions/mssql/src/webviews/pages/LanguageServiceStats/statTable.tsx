/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

/**
 * The table shape both of this panel's tables use.
 *
 * One grid definition shared between them rather than two, because they sit on the same page and a
 * reader compares them: two tables that size and align their columns differently read as two
 * unrelated things. The column template travels with the caller, since the two have different
 * columns, but the padding, rules, and alignment are decided once here.
 *
 * A CSS grid rather than Fluent's DataGrid because these rows carry no selection, no sorting, and no
 * resizing -- and one of them expands to show a query. The grid keeps every column of both tables on
 * the same axis, which the DataGrid's per-cell layout did not.
 */
export const useTableStyles = makeStyles({
    table: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
    },
    headerRow: {
        display: "grid",
        alignItems: "center",
        columnGap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
        backgroundColor: tokens.colorNeutralBackground2,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    row: {
        display: "grid",
        alignItems: "center",
        columnGap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
        borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    },
    /** The same grid as a row, but interactive, for a table whose rows expand. */
    rowButton: {
        display: "grid",
        alignItems: "center",
        columnGap: tokens.spacingHorizontalM,
        width: "100%",
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
        borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
        borderLeft: "none",
        borderRight: "none",
        borderBottom: "none",
        backgroundColor: "transparent",
        color: tokens.colorNeutralForeground1,
        textAlign: "start",
        cursor: "pointer",
        fontFamily: "inherit",
        ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "-2px",
        },
    },
    headerText: { color: tokens.colorNeutralForeground2 },
    /** Numbers share one axis and one figure width so columns of digits line up. */
    numeric: {
        textAlign: "end",
        justifySelf: "end",
        fontVariantNumeric: "tabular-nums",
    },
    truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
    subtle: { color: tokens.colorNeutralForeground3 },
    mono: { fontFamily: tokens.fontFamilyMonospace },
});

export interface StatColumn {
    readonly key: string;
    readonly label: string;
    readonly align?: "start" | "end";
}

export interface StatRow {
    readonly key: string;
    readonly cells: Readonly<Record<string, ReactNode>>;
}

/** A read-only table whose rows do not expand. */
export const StatTable = ({
    columns,
    rows,
    template,
    label,
}: {
    columns: readonly StatColumn[];
    rows: readonly StatRow[];
    /** The grid template, so each table sizes its own columns while sharing the rest. */
    template: string;
    label: string;
}) => {
    const styles = useTableStyles();
    return (
        <div className={styles.table} role="table" aria-label={label}>
            <div className={styles.headerRow} style={{ gridTemplateColumns: template }} role="row">
                {columns.map((column) => (
                    <Text
                        key={column.key}
                        size={200}
                        role="columnheader"
                        className={`${styles.headerText} ${
                            column.align === "end" ? styles.numeric : ""
                        }`}>
                        {column.label}
                    </Text>
                ))}
            </div>
            {rows.map((row) => (
                <div
                    key={row.key}
                    className={styles.row}
                    style={{ gridTemplateColumns: template }}
                    role="row">
                    {columns.map((column) => (
                        <Text
                            key={column.key}
                            size={200}
                            role="cell"
                            className={`${styles.truncate} ${
                                column.align === "end" ? styles.numeric : ""
                            }`}>
                            {row.cells[column.key]}
                        </Text>
                    ))}
                </div>
            ))}
        </div>
    );
};
