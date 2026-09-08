/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { useSqlDiagnosticsSelector } from "../SqlDiagnostics/sqlDiagnosticsSelector";
import { formatCell } from "../../../sharedInterfaces/sqlDiagnostics";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    rows: { display: "flex", flexDirection: "column", gap: "4px", overflowX: "auto" },
    row: {
        display: "grid",
        gridTemplateColumns: "170px minmax(160px, 1fr) 150px",
        alignItems: "center",
        gap: "8px",
        minWidth: "520px",
    },
    gap: {
        display: "grid",
        gridTemplateColumns: "170px minmax(160px, 1fr) 150px",
        alignItems: "center",
        gap: "8px",
        minWidth: "520px",
        color: tokens.colorNeutralForeground3,
    },
    track: {
        height: "14px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusSmall,
        overflow: "hidden",
    },
    bar: {
        height: "100%",
        backgroundColor: tokens.colorBrandBackground,
        minWidth: "2px",
    },
});

export function QueryStoreHistoryChart() {
    const result = useSqlDiagnosticsSelector((state) => state.result);
    const styles = useStyles();
    const loc = LocConstants.getInstance().sqlFeaturePage.queryStore;

    if (!result || result.queryId !== "qds.workloadHistory" || result.rows.length === 0)
        return null;

    const valueField =
        result.snapshot.aggregation === "maximum"
            ? "selected_metric_maximum"
            : result.snapshot.aggregation === "sum"
              ? "selected_metric_total"
              : "selected_metric_average";
    const valueColumn = result.columns.find((column) => column.field === valueField);
    const values = result.rows.map((row) => Number(row[valueField])).filter(Number.isFinite);
    const maximum = Math.max(...values, 1);
    const intervalRows = result.rows.map((row, index) => ({ row, index }));
    const chartRows: (
        | { kind: "gap"; key: string }
        | { kind: "value"; row: (typeof result.rows)[number]; index: number }
    )[] = [];
    for (const current of intervalRows) {
        const previous = chartRows[chartRows.length - 1];
        if (previous?.kind === "value") {
            const previousEnd = new Date(
                String(previous.row.interval_end ?? previous.row.interval_start),
            );
            const currentStart = new Date(String(current.row.interval_start));
            if (
                !Number.isNaN(previousEnd.getTime()) &&
                !Number.isNaN(currentStart.getTime()) &&
                currentStart.getTime() > previousEnd.getTime()
            ) {
                chartRows.push({ kind: "gap", key: `${result.ranAt}:gap:${current.index}` });
            }
        }
        chartRows.push({ kind: "value", ...current });
    }

    return (
        <section className={styles.root} aria-label={loc.history}>
            <Text weight="semibold">{loc.history}</Text>
            <Text size={200}>{loc.historyDescription}</Text>
            <div className={styles.rows} role="list" aria-label={loc.history}>
                {chartRows.map((chartRow) => {
                    if (chartRow.kind === "gap") {
                        return (
                            <div className={styles.gap} key={chartRow.key} role="listitem">
                                <Text size={200}>{loc.missingInterval}</Text>
                                <div className={styles.track} aria-hidden="true" />
                                <Text size={200}>{loc.missingIntervalValue}</Text>
                            </div>
                        );
                    }
                    const { row, index } = chartRow;
                    const interval = formatCell(row.interval_start, "datetime");
                    const value = Number(row[valueField]);
                    const formattedValue = valueColumn
                        ? formatCell(row[valueField], valueColumn.format)
                        : String(row[valueField] ?? "");
                    const width = Number.isFinite(value)
                        ? `${Math.max(2, (value / maximum) * 100)}%`
                        : "0%";
                    return (
                        <div
                            className={styles.row}
                            key={`${result.ranAt}:${index}`}
                            role="listitem"
                            aria-label={loc.historyIntervalValue(interval, formattedValue)}>
                            <Text size={200}>{interval}</Text>
                            <div className={styles.track} aria-hidden="true">
                                <div className={styles.bar} style={{ width }} />
                            </div>
                            <Text size={200}>{formattedValue}</Text>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
