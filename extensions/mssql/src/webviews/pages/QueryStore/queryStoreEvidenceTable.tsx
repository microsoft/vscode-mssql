/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useId, useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Open16Regular } from "@fluentui/react-icons";
import { useSqlDiagnosticsSelector } from "../SqlDiagnostics/sqlDiagnosticsSelector";
import { cellDisplayText, formatCell } from "../../../sharedInterfaces/sqlDiagnostics";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        flexWrap: "wrap",
    },
    tableWrapper: {
        overflow: "auto",
        maxHeight: "320px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    table: {
        borderCollapse: "collapse",
        minWidth: "100%",
        whiteSpace: "nowrap",
    },
    cell: {
        padding: "6px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        textAlign: "left",
        verticalAlign: "top",
    },
    headerCell: {
        position: "sticky",
        top: 0,
        backgroundColor: tokens.colorNeutralBackground1,
        fontWeight: tokens.fontWeightSemibold,
        zIndex: 1,
    },
    value: { maxWidth: "480px", overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
});

export function QueryStoreEvidenceTable({
    onSelectRow,
}: {
    onSelectRow?: (index: number) => void;
}) {
    const result = useSqlDiagnosticsSelector((state) => state.result);
    const [open, setOpen] = useState(false);
    const tableId = `query-store-evidence-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const loc = LocConstants.getInstance().sqlFeaturePage.queryStore;
    const styles = useStyles();

    if (!result || !result.queryId.startsWith("qds.") || result.rows.length === 0) return null;

    return (
        <section className={styles.root} aria-label={loc.tableTitle}>
            <div className={styles.header}>
                <div>
                    <Text weight="semibold">{loc.tableTitle}</Text>
                    <Text size={200}>{loc.tableDescription}</Text>
                </div>
                <Button
                    aria-controls={tableId}
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}>
                    {open ? loc.hideTable : loc.showTable}
                </Button>
            </div>
            {open && (
                <div className={styles.tableWrapper} id={tableId} tabIndex={0}>
                    <table className={styles.table}>
                        <caption>{loc.tableCaption(result.queryId, result.rows.length)}</caption>
                        <thead>
                            <tr>
                                <th className={`${styles.cell} ${styles.headerCell}`} scope="col">
                                    {loc.inspect}
                                </th>
                                {result.columns.map((column) => (
                                    <th
                                        className={`${styles.cell} ${styles.headerCell}`}
                                        scope="col"
                                        key={column.field}>
                                        {column.header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {result.rows.map((row, rowIndex) => (
                                <tr key={`${result.ranAt}:${rowIndex}`}>
                                    <td className={styles.cell}>
                                        {Number.isSafeInteger(Number(row.query_id)) &&
                                            Number(row.query_id) > 0 && (
                                                <Button
                                                    appearance="subtle"
                                                    icon={<Open16Regular />}
                                                    aria-label={loc.inspectRow(
                                                        String(row.query_id),
                                                    )}
                                                    onClick={() => onSelectRow?.(rowIndex)}>
                                                    {loc.inspect}
                                                </Button>
                                            )}
                                    </td>
                                    {result.columns.map((column) => (
                                        <td
                                            className={`${styles.cell} ${styles.value}`}
                                            key={column.field}>
                                            {column.format
                                                ? formatCell(row[column.field], column.format)
                                                : cellDisplayText(row[column.field])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
