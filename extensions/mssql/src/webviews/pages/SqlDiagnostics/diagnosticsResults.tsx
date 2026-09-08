/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useId, useMemo, useRef, useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { Column, GridOption, SlickgridReactInstance } from "slickgrid-react";
import { htmlEncode } from "@slickgrid-universal/utils";
import {
    FluentSlickGrid,
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
} from "../../common/FluentSlickGrid/FluentSlickGrid";
import {
    cellDisplayText,
    DiagnosticsResult,
    formatCell,
} from "../../../sharedInterfaces/sqlDiagnostics";
import { LocConstants } from "../../common/locConstants";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { waitInvestigation } from "sql-feature/diagnostics/dmv";

const useStyles = makeStyles({
    numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
    root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
    grid: { flexGrow: 1, minHeight: "140px", position: "relative" },
    details: {
        height: "40%",
        minHeight: "160px",
        overflow: "auto",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: "12px",
    },
    toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
    properties: { display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 3fr", gap: "8px" },
    value: { margin: 0, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" },
    text: {
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        fontSize: "var(--vscode-editor-font-size)",
    },
});

export function DiagnosticsResults({
    result,
    openText,
    themeKind,
    onSelectRow,
    showInspector = true,
}: {
    result: DiagnosticsResult;
    onSelectRow?: (index: number) => void;
    showInspector?: boolean;
    themeKind?: ColorThemeKind;
    openText: (rowIndex: number, field: string) => void;
}) {
    const styles = useStyles();
    const gridId = `sql-feature-results-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const loc = LocConstants.getInstance().sqlFeatureResults;
    const grid = useRef<SlickgridReactInstance | undefined>(undefined);
    const [selectedIndex, setSelectedIndex] = useState<number>();
    const rows = useMemo(
        () => result.rows.map((row, index) => ({ ...row, __sqlFeatureRowId: index })),
        [result],
    );
    const columns = useMemo<Column[]>(
        () =>
            result.columns.map((column) => ({
                id: column.field,
                field: column.field,
                name: column.header,
                width: column.wide ? 420 : (column.width ?? 140),
                minWidth: 70,
                sortable: true,
                cssClass:
                    column.format &&
                    ["number", "duration-us", "duration-ms", "bytes", "percent"].includes(
                        column.format,
                    )
                        ? styles.numeric
                        : undefined,
                formatter: (_row, _cell, value) =>
                    htmlEncode(formatCell(value, column.format).replace(/\s*\n\s*/g, " ")),
            })),
        [result, styles.numeric],
    );
    const options = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            datasetIdPropertyName: "__sqlFeatureRowId",
            enableSorting: true,
            darkMode:
                themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
            enableAutoTooltip: false,
            rowHeight: 32,
            autoResize: createFluentAutoResizeOptions(`#${gridId}-container`),
        }),
        [themeKind, gridId],
    );
    const select = (event: CustomEvent) => {
        const row = event.detail?.args?.row;
        if (typeof row !== "number") return;
        const item = grid.current?.dataView.getItem(row) as
            | { __sqlFeatureRowId?: number }
            | undefined;
        setSelectedIndex(item?.__sqlFeatureRowId);
        if (item?.__sqlFeatureRowId !== undefined) onSelectRow?.(item.__sqlFeatureRowId);
    };
    const selected = selectedIndex === undefined ? undefined : result.rows[selectedIndex];
    return (
        <div className={styles.root}>
            <div
                className={styles.grid}
                id={`${gridId}-container`}
                role="region"
                aria-label={loc.results}>
                <FluentSlickGrid
                    gridId={gridId}
                    columns={columns}
                    options={options}
                    dataset={rows}
                    onReactGridCreated={(event) => {
                        grid.current = event.detail;
                    }}
                    onClick={select}
                    onActiveCellChanged={select}
                />
            </div>
            {selected && showInspector && (
                <section className={styles.details} aria-label={loc.details}>
                    {typeof selected.wait_type === "string" && (
                        <Text>
                            {
                                LocConstants.getInstance().sqlWaits.guidance[
                                    waitInvestigation(selected.wait_type)
                                ]
                            }
                        </Text>
                    )}
                    <div className={styles.toolbar}>
                        <Text weight="semibold">{loc.details}</Text>
                        <Button onClick={() => setSelectedIndex(undefined)}>
                            {LocConstants.getInstance().common.close}
                        </Button>
                    </div>
                    {result.truncated && <Text>{loc.incomplete}</Text>}
                    <dl className={styles.properties}>
                        {result.columns
                            .filter((column) => !column.wide)
                            .map((column) => (
                                <div key={column.field} style={{ display: "contents" }}>
                                    <dt>{column.header}</dt>
                                    <dd className={styles.value}>
                                        {formatCell(selected[column.field], column.format)}
                                    </dd>
                                </div>
                            ))}
                    </dl>
                    {result.columns
                        .filter((column) => column.wide)
                        .map((column) => (
                            <section key={column.field}>
                                <div className={styles.toolbar}>
                                    <Text weight="semibold">{column.header}</Text>
                                    <Button onClick={() => openText(selectedIndex!, column.field)}>
                                        {loc.openText}
                                    </Button>
                                </div>
                                <pre className={styles.text}>
                                    {cellDisplayText(selected[column.field])}
                                </pre>
                            </section>
                        ))}
                </section>
            )}
        </div>
    );
}
