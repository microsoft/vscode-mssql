/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio result widgets (RBS2-9 renderer slice): consumers of the
 * RESOLVED presentation model only. Payloads arrive via bounded page pulls
 * through the controller (never in state); markdown renders as plain text
 * (no raw HTML — sanitization rule); unsupported kinds, expired handles,
 * pending and missing sources all degrade to explicit visible states (total
 * layout, never blank). Chart renderers (bar, timeseries) are pure inline
 * SVG — the webview CSP forbids external chart libs — and degrade honestly
 * to the grid when the rowset has no chartable columns. The per-widget view
 * switcher is an ephemeral client-side override ("this run only") until the
 * user explicitly saves it as the runbook default through the
 * host-authoritative presentation edit path.
 */

import { useEffect, useState } from "react";
import { locConstants } from "../../common/locConstants";
import {
    compatibleViews,
    ResolvedWidget,
    ViewKind,
    ViewRenderSettings,
} from "../../../sharedInterfaces/runbookPresentation";
import {
    RbsFetchOutputPageRequest,
    RbsOutputArtifactAction,
    RbsOutputArtifactRequest,
} from "../../../sharedInterfaces/runbookStudio";
import { projectDacpacSchemaDiff } from "../../../runbookStudio/presentation/schemaDiffProjection";
import { useRbs } from "./state";

const PAGE_ROWS = 100;
/** Bar chart shows at most this many rows (with an honest truncation note). */
const BAR_MAX_ROWS = 30;
/** Timeseries draws per-point dots only up to this many points (per series). */
const TS_DOT_MAX_POINTS = 50;
/** Timeseries plots at most this many Y series (the palette size). */
const TS_MAX_SERIES = 6;
const TS_VIEW_WIDTH = 600;
const TS_VIEW_HEIGHT = 200;
const TS_PAD = 10;
/** Horizontal gridline positions, top→bottom, as fractions of the Y span. */
const TS_GRID_FRACTIONS = [1, 2 / 3, 1 / 3, 0];
/** Vertical bar-chart gridlines, as percentages of the max value. */
const BAR_GRID_PERCENTS = [25, 50, 75, 100];
/** Chart series palette — VS Code chart theme tokens with the default-dark
 *  theme hexes as fallbacks. Series take colors in this fixed order; the
 *  series count is capped at the palette size, never cycled. */
const CHART_PALETTE = [
    "var(--vscode-charts-blue, #3794ff)",
    "var(--vscode-charts-red, #f14c4c)",
    "var(--vscode-charts-yellow, #cca700)",
    "var(--vscode-charts-green, #89d185)",
    "var(--vscode-charts-purple, #b180d7)",
    "var(--vscode-charts-orange, #d18616)",
];

type CellValue = string | number | boolean | null;

interface FetchedPage {
    columns?: string[];
    rows?: Array<Array<CellValue>>;
    totalRows?: number;
    errorCode?: string;
}

const FILE_ARTIFACT_CONTRACTS = new Set(["dacpacArtifact/1", "schemaDiff/1"]);

function OutputArtifactActions({ widget }: { widget: ResolvedWidget }) {
    const { rpc } = useRbs();
    const loc = locConstants.runbookStudio;
    const handleId =
        widget.state === "ready" &&
        widget.handleId &&
        !widget.derivedSourceId &&
        widget.contract &&
        FILE_ARTIFACT_CONTRACTS.has(widget.contract)
            ? widget.handleId
            : undefined;
    const [artifact, setArtifact] = useState<{ handleId: string; fileName: string } | undefined>();
    const [activeAction, setActiveAction] = useState<RbsOutputArtifactAction | undefined>();
    const [actionError, setActionError] = useState<string | undefined>();

    useEffect(() => {
        let cancelled = false;
        setArtifact(undefined);
        setActionError(undefined);
        if (!handleId) {
            return;
        }
        void rpc.sendRequest(RbsOutputArtifactRequest.type, { handleId }).then((result) => {
            if (!cancelled && result.available && result.fileName) {
                setArtifact({ handleId, fileName: result.fileName });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [handleId, rpc]);

    if (!artifact || artifact.handleId !== handleId) {
        return null;
    }

    const perform = async (action: RbsOutputArtifactAction) => {
        setActiveAction(action);
        setActionError(undefined);
        try {
            const result = await rpc.sendRequest(RbsOutputArtifactRequest.type, {
                handleId: artifact.handleId,
                action,
            });
            if (result.error) {
                setActionError(result.error.message);
            }
        } catch {
            setActionError(loc.dataExpiredDetail);
        } finally {
            setActiveAction(undefined);
        }
    };

    return (
        <>
            <span
                className="rbs-widget-artifact-actions"
                role="group"
                aria-label={artifact.fileName}>
                <button
                    type="button"
                    className="rbs-btn rbs-btn-quiet"
                    disabled={activeAction !== undefined}
                    onClick={() => void perform("open")}>
                    {activeAction === "open" ? loc.artifactActionInProgress : loc.openArtifact}
                </button>
                <button
                    type="button"
                    className="rbs-btn rbs-btn-quiet"
                    disabled={activeAction !== undefined}
                    onClick={() => void perform("reveal")}>
                    {activeAction === "reveal" ? loc.artifactActionInProgress : loc.revealArtifact}
                </button>
                <button
                    type="button"
                    className="rbs-btn rbs-btn-quiet"
                    disabled={activeAction !== undefined}
                    onClick={() => void perform("exportCopy")}>
                    {activeAction === "exportCopy"
                        ? loc.artifactActionInProgress
                        : loc.exportArtifactCopy}
                </button>
            </span>
            {actionError ? (
                <span className="rbs-drift-notice" role="alert">
                    {actionError}
                </span>
            ) : null}
        </>
    );
}

function usePage(
    handleId: string | undefined,
    derivedSourceId: string | undefined,
    derivedPreviewId: string | undefined,
): FetchedPage | undefined {
    const { rpc } = useRbs();
    const [page, setPage] = useState<FetchedPage | undefined>(undefined);
    useEffect(() => {
        let cancelled = false;
        setPage(undefined);
        if (!handleId) {
            return;
        }
        void rpc
            .sendRequest(RbsFetchOutputPageRequest.type, {
                handleId,
                ...(derivedSourceId ? { derivedSourceId } : {}),
                ...(derivedPreviewId ? { derivedPreviewId } : {}),
                startRow: 0,
                rowCount: PAGE_ROWS,
            })
            .then((result) => {
                if (!cancelled) {
                    setPage({
                        ...(result.columns ? { columns: result.columns } : {}),
                        ...(result.rows ? { rows: result.rows } : {}),
                        ...(result.totalRows !== undefined ? { totalRows: result.totalRows } : {}),
                        ...(result.error ? { errorCode: result.error.code } : {}),
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [derivedPreviewId, derivedSourceId, handleId]);
    return page;
}

// ---------------------------------------------------------------------------
// Column heuristics shared by the chart renderers
// ---------------------------------------------------------------------------

/** A cell counts as numeric when it is a finite number or a non-empty string
 *  that parses to one; booleans and NULLs are not chartable magnitudes. */
function numericCellValue(cell: CellValue | undefined): number | undefined {
    if (typeof cell === "number") {
        return Number.isFinite(cell) ? cell : undefined;
    }
    if (typeof cell === "string" && cell.trim() !== "") {
        const parsed = Number(cell);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

/** Numeric column: at least one non-null cell and every non-null cell numeric. */
function isNumericColumn(rows: CellValue[][], columnIndex: number): boolean {
    let sawValue = false;
    for (const row of rows) {
        const cell = row[columnIndex];
        if (cell === null || cell === undefined) {
            continue;
        }
        if (numericCellValue(cell) === undefined) {
            return false;
        }
        sawValue = true;
    }
    return sawValue;
}

function columnCountOf(page: FetchedPage): number {
    let count = page.columns?.length ?? 0;
    for (const row of page.rows ?? []) {
        count = Math.max(count, row.length);
    }
    return count;
}

/** Integer values get locale grouping; fractional values keep raw precision. */
function formatNumber(value: number): string {
    return Number.isInteger(value) ? value.toLocaleString() : String(value);
}

/** Compact axis/value labels (1.2K, 3.4M); tooltips keep full precision. */
const compactNumber = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
});
function formatCompact(value: number): string {
    return compactNumber.format(value);
}

interface XAxis {
    /** Per-row x position (undefined where the cell is missing). */
    values: Array<number | undefined>;
    isTime: boolean;
}

/** Date/time X candidate: every non-null cell is a string Date.parse accepts
 *  (numbers are deliberately excluded — bare numerics like "1" would parse as
 *  surprising calendar dates; they go through the monotonic-numeric rule). */
function dateAxis(rows: CellValue[][], columnIndex: number): XAxis | undefined {
    let sawValue = false;
    const values: Array<number | undefined> = [];
    for (const row of rows) {
        const cell = row[columnIndex];
        if (cell === null || cell === undefined) {
            values.push(undefined);
            continue;
        }
        if (typeof cell !== "string") {
            return undefined;
        }
        const parsed = Date.parse(cell);
        if (Number.isNaN(parsed)) {
            return undefined;
        }
        values.push(parsed);
        sawValue = true;
    }
    return sawValue ? { values, isTime: true } : undefined;
}

/** Numeric X candidate: an all-numeric column whose values are monotonic. */
function monotonicNumericAxis(rows: CellValue[][], columnIndex: number): XAxis | undefined {
    if (!isNumericColumn(rows, columnIndex)) {
        return undefined;
    }
    const values = rows.map((row) => numericCellValue(row[columnIndex]));
    const present = values.filter((value): value is number => value !== undefined);
    let ascending = true;
    let descending = true;
    for (let i = 1; i < present.length; i++) {
        if (present[i] < present[i - 1]) {
            ascending = false;
        }
        if (present[i] > present[i - 1]) {
            descending = false;
        }
    }
    return ascending || descending ? { values, isTime: false } : undefined;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function GridView({ page, settings }: { page: FetchedPage; settings?: ViewRenderSettings }) {
    const loc = locConstants.runbookStudio;
    const rows = (page.rows ?? []).slice(0, settings?.pageSize ?? PAGE_ROWS);
    return (
        <div className="rbs-grid-view">
            <div className="rbs-grid-viewport">
                <table
                    className={`rbs-table ${settings?.density === "compact" ? "rbs-table-compact" : ""}`}>
                    {page.columns ? (
                        <thead>
                            <tr>
                                {page.columns.map((column, i) => (
                                    <th key={i}>{column}</th>
                                ))}
                            </tr>
                        </thead>
                    ) : null}
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                {row.map((cell, cellIndex) => (
                                    <td key={cellIndex} className="rbs-mono">
                                        {cell === null ? "NULL" : String(cell)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {page.totalRows !== undefined && page.totalRows > rows.length ? (
                <div className="rbs-muted">{loc.showingRows(rows.length, page.totalRows)}</div>
            ) : null}
        </div>
    );
}

function ScalarCardsView({ page, settings }: { page: FetchedPage; settings?: ViewRenderSettings }) {
    // scalarSet pages arrive as name/value rows.
    const entries = (page.rows ?? []).map((row) => ({
        label: String(row[0] ?? ""),
        value: row[1] === null ? "NULL" : String(row[1]),
    }));
    return (
        <div
            className={`rbs-cards ${settings?.columns ? "rbs-cards-grid" : ""}`}
            style={
                settings?.columns
                    ? { gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }
                    : undefined
            }>
            {entries.map((entry) => (
                <div className="rbs-card" key={entry.label}>
                    <div className="rbs-card-label">{entry.label}</div>
                    <div className="rbs-card-value">{entry.value}</div>
                </div>
            ))}
        </div>
    );
}

function TextView({
    page,
    mono,
    wrap = false,
}: {
    page: FetchedPage;
    mono: boolean;
    wrap?: boolean;
}) {
    const text = (page.rows ?? [])
        .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join(" "))
        .join("\n");
    return (
        <pre className={`rbs-text-block ${mono ? "rbs-mono" : ""} ${wrap ? "rbs-text-wrap" : ""}`}>
            {text}
        </pre>
    );
}

function JsonView({ page }: { page: FetchedPage }) {
    return (
        <pre className="rbs-text-block rbs-mono">
            {JSON.stringify({ columns: page.columns, rows: page.rows }, undefined, 2)}
        </pre>
    );
}

function SchemaDiffView({ page }: { page: FetchedPage }) {
    const loc = locConstants.runbookStudio;
    const raw = page.rows?.[0]?.[0];
    let diff: ReturnType<typeof projectDacpacSchemaDiff>;
    try {
        if (typeof raw !== "string") {
            throw new Error("missing report");
        }
        const document = new DOMParser().parseFromString(raw, "application/xml");
        if (document.getElementsByTagName("parsererror").length > 0) {
            throw new Error("invalid report");
        }
        diff = projectDacpacSchemaDiff(document);
    } catch {
        diff = undefined;
    }
    if (!diff) {
        return (
            <>
                <div className="rbs-drift-notice" role="status">
                    {loc.schemaDiffUnavailable}
                </div>
                <TextView page={page} mono />
            </>
        );
    }
    return (
        <div className="rbs-schema-diff">
            <div className="rbs-schema-diff-summary" aria-label={loc.schemaDiffSummary}>
                <div className="rbs-card">
                    <div className="rbs-card-label">{loc.schemaChanges}</div>
                    <div className="rbs-card-value">{diff.changeCount.toLocaleString()}</div>
                </div>
                <div className="rbs-card">
                    <div className="rbs-card-label">{loc.schemaAlerts}</div>
                    <div className="rbs-card-value">{diff.alertCount.toLocaleString()}</div>
                </div>
                {diff.operationGroups.map((group) => (
                    <div className="rbs-card" key={group.name}>
                        <div className="rbs-card-label">{group.name}</div>
                        <div className="rbs-card-value">{group.count.toLocaleString()}</div>
                    </div>
                ))}
            </div>
            {diff.omittedOperationGroupCount > 0 ? (
                <div className="rbs-muted">
                    {loc.additionalOperationGroups(diff.omittedOperationGroupCount)}
                </div>
            ) : null}
            {diff.alerts.length > 0 ? (
                <section className="rbs-schema-diff-alerts" aria-label={loc.schemaAlerts}>
                    <h4>{loc.schemaAlerts}</h4>
                    <ul>
                        {diff.alerts.map((alert, index) => (
                            <li key={`${alert.kind}:${index}`}>
                                <strong>{alert.kind}</strong>
                                {alert.detail ? ` — ${alert.detail}` : ""}
                            </li>
                        ))}
                    </ul>
                    {diff.omittedAlertCount > 0 ? (
                        <div className="rbs-muted">
                            {loc.showingRows(diff.alerts.length, diff.alertCount)}
                        </div>
                    ) : null}
                </section>
            ) : null}
            {diff.changes.length === 0 ? (
                <div className="rbs-muted">{loc.noSchemaChanges}</div>
            ) : (
                <div className="rbs-grid-view">
                    <div className="rbs-grid-viewport">
                        <table className="rbs-table">
                            <thead>
                                <tr>
                                    <th>{loc.schemaOperation}</th>
                                    <th>{loc.schemaObjectType}</th>
                                    <th>{loc.schemaObject}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {diff.changes.map((change, index) => (
                                    <tr key={`${change.operation}:${change.name}:${index}`}>
                                        <td>{change.operation}</td>
                                        <td>{change.objectType || loc.notAvailable}</td>
                                        <td className="rbs-mono">
                                            {change.name || loc.unnamedSchemaObject}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {diff.omittedChangeCount > 0 ? (
                        <div className="rbs-muted">
                            {loc.showingRows(diff.changes.length, diff.changeCount)}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

/** Small header line inside a chart: the row count, or an honest partial-page
 *  note when the widget fetched fewer rows than the output holds. */
function ChartMeta({ page, className }: { page: FetchedPage; className?: string }) {
    const loc = locConstants.runbookStudio;
    const shown = page.rows?.length ?? 0;
    const total = page.totalRows ?? shown;
    return (
        <div className={`rbs-chart-meta rbs-muted${className ? ` ${className}` : ""}`}>
            {total > shown ? loc.showingRows(shown, total) : loc.rowCount(total)}
        </div>
    );
}

/** Legend row: color swatch + column name per series. Identity never rides on
 *  color alone — the swatch always sits beside the readable column name. */
function ChartLegend({
    entries,
    className,
}: {
    entries: Array<{ name: string; color: string }>;
    className?: string;
}) {
    return (
        <div className={`rbs-chart-legend${className ? ` ${className}` : ""}`}>
            {entries.map((entry, index) => (
                <span className="rbs-legend-item" key={index} title={entry.name}>
                    <span
                        className="rbs-legend-swatch"
                        style={{ background: entry.color }}
                        aria-hidden="true"
                    />
                    <span className="rbs-legend-name">{entry.name}</span>
                </span>
            ))}
        </div>
    );
}

/** Horizontal bar chart for rowset pages: category = first non-numeric
 *  column (row index when every column is numeric), value = first numeric
 *  column — or grouped pairs (shared scale, 2-color legend) when there are
 *  exactly two numeric columns beside a category. Rows sort by value
 *  descending before the top-30 cut; bars carry native <title> tooltips with
 *  full precision, compact value labels, and subtle gridlines at
 *  25/50/75/100% of max. Degrades honestly to the grid when no numeric
 *  column exists. */
function BarChartView({ page, settings }: { page: FetchedPage; settings?: ViewRenderSettings }) {
    const loc = locConstants.runbookStudio;
    const rows = page.rows ?? [];
    const columnCount = columnCountOf(page);
    const numericColumns: number[] = [];
    let categoryColumn = -1;
    for (let i = 0; i < columnCount; i++) {
        if (isNumericColumn(rows, i)) {
            numericColumns.push(i);
        } else if (categoryColumn === -1) {
            categoryColumn = i;
        }
    }
    if (numericColumns.length === 0) {
        return (
            <>
                <div className="rbs-muted">{loc.noNumericColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    // Exactly two numeric columns beside a category → grouped pairs on one
    // shared scale (never a dual axis); otherwise the first numeric column.
    const grouped = numericColumns.length === 2 && categoryColumn >= 0;
    const seriesColumns = grouped ? numericColumns : numericColumns.slice(0, 1);
    const series = seriesColumns.map((column, index) => ({
        name: page.columns?.[column] ?? String(column + 1),
        color: CHART_PALETTE[index],
    }));
    const bars = rows.map((row, index) => {
        const categoryCell = categoryColumn >= 0 ? row[categoryColumn] : undefined;
        return {
            label:
                categoryColumn >= 0
                    ? categoryCell === null || categoryCell === undefined
                        ? "NULL"
                        : String(categoryCell)
                    : String(index + 1),
            values: seriesColumns.map((column) => numericCellValue(row[column])),
        };
    });
    switch (settings?.sort ?? "value-desc") {
        case "category":
            bars.sort((a, b) => a.label.localeCompare(b.label));
            break;
        case "value-asc":
            bars.sort(
                (a, b) =>
                    (a.values[0] ?? Number.POSITIVE_INFINITY) -
                    (b.values[0] ?? Number.POSITIVE_INFINITY),
            );
            break;
        case "value-desc":
            bars.sort(
                (a, b) =>
                    (b.values[0] ?? Number.NEGATIVE_INFINITY) -
                    (a.values[0] ?? Number.NEGATIVE_INFINITY),
            );
            break;
        case "none":
            break;
    }
    const visibleBars = bars.slice(0, settings?.maxCategories ?? BAR_MAX_ROWS);
    const maxValue = Math.max(
        0,
        ...visibleBars.flatMap((bar) => bar.values.map((value) => value ?? 0)),
    );
    const totalRows = page.totalRows ?? rows.length;
    const categoryName = categoryColumn >= 0 ? page.columns?.[categoryColumn] : undefined;
    const barHeight = grouped ? 12 : 16;
    if (settings?.orientation === "vertical") {
        return (
            <div className="rbs-bar-chart rbs-bar-chart-vertical" role="group">
                <ChartMeta page={page} />
                {grouped ? <ChartLegend entries={series} /> : null}
                <div className="rbs-bar-columns">
                    {visibleBars.map((bar, index) => (
                        <div className="rbs-bar-column" key={index}>
                            <div className="rbs-bar-column-series">
                                {bar.values.map((value, seriesIndex) => {
                                    const exact =
                                        value === undefined ? "NULL" : formatNumber(value);
                                    const title = grouped
                                        ? loc.categorySeriesValue(
                                              bar.label,
                                              series[seriesIndex].name,
                                              exact,
                                          )
                                        : `${bar.label}: ${exact}`;
                                    const fraction =
                                        maxValue > 0 && value !== undefined && value > 0
                                            ? value / maxValue
                                            : 0;
                                    return (
                                        <div
                                            className="rbs-bar-column-track"
                                            key={seriesIndex}
                                            title={title}>
                                            <div
                                                className="rbs-bar-column-fill"
                                                style={{
                                                    background: series[seriesIndex].color,
                                                    height: `${(fraction * 100).toFixed(2)}%`,
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            <span className="rbs-bar-column-label" title={bar.label}>
                                {bar.label}
                            </span>
                        </div>
                    ))}
                </div>
                {totalRows > visibleBars.length ? (
                    <div className="rbs-muted">
                        {loc.showingFirstRows(visibleBars.length, totalRows)}
                    </div>
                ) : null}
            </div>
        );
    }
    return (
        <div
            className="rbs-bar-chart"
            role="group"
            aria-label={
                categoryName !== undefined
                    ? loc.barChartLabel(series.map((entry) => entry.name).join(", "), categoryName)
                    : undefined
            }>
            <ChartMeta page={page} />
            {grouped ? <ChartLegend entries={series} /> : null}
            {visibleBars.map((bar, index) => {
                const titles = bar.values.map((value, seriesIndex) => {
                    const exact = value === undefined ? "NULL" : formatNumber(value);
                    return grouped
                        ? loc.categorySeriesValue(bar.label, series[seriesIndex].name, exact)
                        : `${bar.label}: ${exact}`;
                });
                return (
                    <div
                        className="rbs-bar-row"
                        key={index}
                        role="img"
                        aria-label={titles.join("; ")}>
                        <span className="rbs-bar-label" title={bar.label}>
                            {bar.label}
                        </span>
                        <div className="rbs-bar-tracks">
                            {bar.values.map((value, seriesIndex) => {
                                const fraction =
                                    maxValue > 0 && value !== undefined && value > 0
                                        ? value / maxValue
                                        : 0;
                                return (
                                    <div className="rbs-bar-track" key={seriesIndex}>
                                        <svg
                                            className="rbs-bar-svg"
                                            height={barHeight}
                                            aria-hidden="true"
                                            focusable="false">
                                            <title>{titles[seriesIndex]}</title>
                                            {BAR_GRID_PERCENTS.map((percent) => (
                                                <line
                                                    className="rbs-bar-grid"
                                                    key={percent}
                                                    x1={`${percent}%`}
                                                    x2={`${percent}%`}
                                                    y1="0"
                                                    y2="100%"
                                                />
                                            ))}
                                            <rect
                                                className="rbs-bar-fill"
                                                style={{ fill: series[seriesIndex].color }}
                                                x="0"
                                                y="2"
                                                rx="2"
                                                height={barHeight - 4}
                                                width={`${(fraction * 100).toFixed(2)}%`}
                                            />
                                        </svg>
                                        <span className="rbs-bar-value rbs-mono">
                                            {value === undefined ? "NULL" : formatCompact(value)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            {totalRows > visibleBars.length ? (
                <div className="rbs-muted">
                    {loc.showingFirstRows(visibleBars.length, totalRows)}
                </div>
            ) : null}
        </div>
    );
}

/** Line chart for rowset pages: X = first date/time (or monotonic numeric)
 *  column, Y = every other numeric column (up to six series), each polyline
 *  in its own chart theme color with a legend row under the plot. Four light
 *  gridlines with compact tick labels, first/middle/last X labels, native
 *  SVG <title> tooltips on lines and points. Degrades honestly to the grid
 *  when no usable axis exists. */
function TimeseriesView({ page, settings }: { page: FetchedPage; settings?: ViewRenderSettings }) {
    const loc = locConstants.runbookStudio;
    const rows = page.rows ?? [];
    const columnCount = columnCountOf(page);
    let xColumn = -1;
    let xAxis: XAxis | undefined;
    for (let i = 0; i < columnCount && !xAxis; i++) {
        const candidate = dateAxis(rows, i) ?? monotonicNumericAxis(rows, i);
        if (candidate) {
            xColumn = i;
            xAxis = candidate;
        }
    }
    if (!xAxis) {
        return (
            <>
                <div className="rbs-muted">{loc.needsTimeColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    const axis = xAxis;
    const seriesColumns: number[] = [];
    for (let i = 0; i < columnCount && seriesColumns.length < TS_MAX_SERIES; i++) {
        if (i !== xColumn && isNumericColumn(rows, i)) {
            seriesColumns.push(i);
        }
    }
    if (seriesColumns.length === 0) {
        return (
            <>
                <div className="rbs-muted">{loc.noNumericColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    const series = seriesColumns
        .map((column, index) => ({
            column,
            name: page.columns?.[column] ?? String(column + 1),
            color: CHART_PALETTE[index],
            points: rows
                .map((row, rowIndex) => ({
                    x: axis.values[rowIndex],
                    y: numericCellValue(row[column]),
                }))
                .filter(
                    (point): point is { x: number; y: number } =>
                        point.x !== undefined && point.y !== undefined,
                )
                .sort((a, b) => a.x - b.x),
        }))
        .filter((entry) => entry.points.length > 0);
    const allPoints = series.flatMap((entry) => entry.points);
    if (allPoints.length === 0) {
        return (
            <>
                <div className="rbs-muted">{loc.needsTimeColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    const xMin = Math.min(...allPoints.map((point) => point.x));
    const xMax = Math.max(...allPoints.map((point) => point.x));
    const dataYMin = Math.min(...allPoints.map((point) => point.y));
    const dataYMax = Math.max(...allPoints.map((point) => point.y));
    const yMin = settings?.yAxis === "zero-based" ? Math.min(0, dataYMin) : dataYMin;
    const yMax = settings?.yAxis === "zero-based" ? Math.max(0, dataYMax) : dataYMax;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const px = (x: number) => TS_PAD + ((x - xMin) / xSpan) * (TS_VIEW_WIDTH - 2 * TS_PAD);
    const py = (y: number) =>
        TS_VIEW_HEIGHT - TS_PAD - ((y - yMin) / ySpan) * (TS_VIEW_HEIGHT - 2 * TS_PAD);
    const yTicks = TS_GRID_FRACTIONS.map((fraction) => yMin + fraction * (yMax - yMin));
    const xName = page.columns?.[xColumn] ?? String(xColumn + 1);
    const seriesNames = series.map((entry) => entry.name).join(", ");
    const formatXTick = (value: number) =>
        axis.isTime
            ? new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
            : formatCompact(value);
    const formatXExact = (value: number) =>
        axis.isTime ? new Date(value).toLocaleString() : formatNumber(value);
    return (
        <div
            className="rbs-ts-chart"
            role="group"
            aria-label={loc.timeseriesLabel(seriesNames, xName)}>
            <ChartMeta page={page} className="rbs-ts-meta" />
            <div className="rbs-ts-y rbs-mono" aria-hidden="true">
                {yTicks.map((tick, index) => (
                    <span key={index}>{formatCompact(tick)}</span>
                ))}
            </div>
            <div className="rbs-ts-plot">
                <svg
                    className="rbs-ts-svg"
                    viewBox={`0 0 ${TS_VIEW_WIDTH} ${TS_VIEW_HEIGHT}`}
                    aria-hidden="true"
                    focusable="false">
                    {yTicks.map((tick, index) => (
                        <line
                            className="rbs-ts-grid"
                            key={index}
                            x1={TS_PAD}
                            x2={TS_VIEW_WIDTH - TS_PAD}
                            y1={py(tick).toFixed(1)}
                            y2={py(tick).toFixed(1)}
                        />
                    ))}
                    {series.map((entry) => (
                        <g key={entry.column}>
                            {settings?.interpolation === "step" ? (
                                <path
                                    className="rbs-ts-line"
                                    fill="none"
                                    style={{ stroke: entry.color }}
                                    d={entry.points
                                        .map((point, index) => {
                                            const x = px(point.x).toFixed(1);
                                            const y = py(point.y).toFixed(1);
                                            return index === 0 ? `M ${x} ${y}` : `H ${x} V ${y}`;
                                        })
                                        .join(" ")}>
                                    <title>{entry.name}</title>
                                </path>
                            ) : (
                                <polyline
                                    className="rbs-ts-line"
                                    style={{ stroke: entry.color }}
                                    points={entry.points
                                        .map(
                                            (point) =>
                                                `${px(point.x).toFixed(1)},${py(point.y).toFixed(1)}`,
                                        )
                                        .join(" ")}>
                                    <title>{entry.name}</title>
                                </polyline>
                            )}
                            {entry.points.length <= TS_DOT_MAX_POINTS
                                ? entry.points.map((point, pointIndex) => (
                                      <circle
                                          className="rbs-ts-dot"
                                          style={{ fill: entry.color }}
                                          key={pointIndex}
                                          cx={px(point.x).toFixed(1)}
                                          cy={py(point.y).toFixed(1)}
                                          r="3">
                                          <title>
                                              {loc.seriesPointLabel(
                                                  entry.name,
                                                  formatNumber(point.y),
                                                  formatXExact(point.x),
                                              )}
                                          </title>
                                      </circle>
                                  ))
                                : null}
                        </g>
                    ))}
                </svg>
            </div>
            <div className="rbs-ts-x rbs-mono" aria-hidden="true">
                <span>{formatXTick(xMin)}</span>
                <span>{formatXTick(xMin + (xMax - xMin) / 2)}</span>
                <span>{formatXTick(xMax)}</span>
            </div>
            <ChartLegend entries={series} className="rbs-ts-legend" />
        </div>
    );
}

export function ResolvedWidgetView({
    widget,
    sample = false,
}: {
    widget: ResolvedWidget;
    sample?: boolean;
}) {
    const { setOutputView } = useRbs();
    const loc = locConstants.runbookStudio;
    const fetchedPage = usePage(
        widget.state === "ready" ? widget.handleId : undefined,
        widget.derivedSourceId,
        widget.derivedPreviewId,
    );
    const page: FetchedPage | undefined = widget.runField
        ? {
              columns: ["Metric", "Value"],
              rows: [[widget.runField.field, widget.runField.value]],
              totalRows: 1,
          }
        : widget.runMetric
          ? {
                columns: ["Metric", "Value"],
                rows: [[widget.runMetric.key, widget.runMetric.value]],
                totalRows: 1,
            }
          : fetchedPage;
    // Ephemeral per-widget view override — "this run only": client-side state
    // keyed to the widget id and never sent over RPC unless the user invokes
    // the explicit save action. Ignored automatically when the widget identity
    // changes or the override stops being contract-compatible.
    const [override, setOverride] = useState<{ id: string; view: ViewKind } | undefined>(undefined);
    const [savingDefault, setSavingDefault] = useState(false);
    const [saveDefaultFailed, setSaveDefaultFailed] = useState(false);

    // The artifact edit publishes a new resolved snapshot. Retire the local
    // override only once that snapshot proves the saved default took effect,
    // avoiding a flash back to the old view while the RPC response races the
    // state notification.
    useEffect(() => {
        if (override?.id === widget.id && override.view === widget.view) {
            setOverride(undefined);
            setSaveDefaultFailed(false);
        }
    }, [override, widget.id, widget.view]);

    const candidates =
        widget.state === "ready" && widget.contract ? compatibleViews(widget.contract) : [];
    const overriddenView =
        override !== undefined &&
        override.id === widget.id &&
        override.view !== widget.view &&
        candidates.includes(override.view)
            ? override.view
            : undefined;
    const view = overriddenView ?? widget.view;

    const renderBody = (renderView: ViewKind, settings?: ViewRenderSettings): React.ReactNode => {
        switch (widget.state) {
            case "pending":
                return <div className="rbs-muted">{loc.widgetPending}</div>;
            case "noOutput":
                return <div className="rbs-muted">{loc.noOutputsDetail}</div>;
            case "expired":
                return <div className="rbs-muted">{loc.dataExpiredDetail}</div>;
            case "sourceMissing":
                return <div className="rbs-muted">{loc.widgetSourceMissing}</div>;
            case "ready": {
                if (!page) {
                    return <div className="rbs-muted">{loc.loading}</div>;
                }
                if (page.errorCode) {
                    return <div className="rbs-muted">{loc.dataExpiredDetail}</div>;
                }
                switch (renderView) {
                    case "grid":
                        return <GridView page={page} settings={settings} />;
                    case "scalar-cards":
                        return <ScalarCardsView page={page} settings={settings} />;
                    case "markdown":
                    case "log-view":
                        return (
                            <TextView
                                page={page}
                                mono={renderView === "log-view"}
                                wrap={renderView === "log-view" && settings?.wrap}
                            />
                        );
                    case "json":
                        return <JsonView page={page} />;
                    case "diff":
                        return <SchemaDiffView page={page} />;
                    case "bar":
                        return <BarChartView page={page} settings={settings} />;
                    case "timeseries":
                        return <TimeseriesView page={page} settings={settings} />;
                    default:
                        // Honest degrade: registered-but-unimplemented kinds
                        // say so rather than rendering a blank panel.
                        return (
                            <div className="rbs-muted">{loc.unsupportedRenderer(renderView)}</div>
                        );
                }
            }
        }
    };

    const viewOptions = candidates.includes(widget.view)
        ? candidates
        : [widget.view, ...candidates];
    const multiView = widget.views.length > 1 && widget.presentation.mode !== "single";
    const splitAxis = widget.presentation.mode === "split" ? widget.presentation.axis : undefined;
    const split = multiView && splitAxis !== undefined;
    const body = split ? (
        <div className={`rbs-widget-split rbs-widget-split-${splitAxis}`}>
            {widget.views.map((authoredView) => (
                <section className="rbs-widget-split-pane" key={authoredView.id}>
                    <div className="rbs-widget-split-label rbs-mono">{authoredView.kind}</div>
                    {authoredView.issue ? (
                        <div className="rbs-drift-notice" role="status">
                            {authoredView.issue.message}
                        </div>
                    ) : (
                        renderBody(authoredView.kind, authoredView.settings)
                    )}
                </section>
            ))}
        </div>
    ) : (
        renderBody(view, widget.views.find((candidate) => candidate.kind === view)?.settings)
    );

    const saveAsRunbookDefault = async () => {
        if (!overriddenView) {
            return;
        }
        setSavingDefault(true);
        setSaveDefaultFailed(false);
        try {
            const applied = await setOutputView(widget.nodeId, overriddenView);
            if (!applied) {
                setSaveDefaultFailed(true);
            }
        } catch {
            setSaveDefaultFailed(true);
        } finally {
            setSavingDefault(false);
        }
    };

    return (
        <section className="rbs-widget" aria-label={widget.title}>
            <div className="rbs-widget-header">
                <span className="rbs-widget-title">{widget.title}</span>
                {sample ? <span className="rbs-chip rbs-chip-suggested">{loc.sample}</span> : null}
                {multiView && !split ? (
                    <div
                        className={`rbs-widget-view-tabs rbs-widget-view-tabs-${widget.presentation.mode}`}
                        role="group"
                        aria-label={loc.viewSwitcherLabel(widget.title)}>
                        {widget.views.map((authoredView) => (
                            <button
                                key={authoredView.id}
                                type="button"
                                className={`rbs-graph-toggle ${view === authoredView.kind ? "active" : ""}`}
                                aria-pressed={view === authoredView.kind}
                                disabled={authoredView.issue !== undefined}
                                title={authoredView.issue?.message}
                                onClick={() => {
                                    setSaveDefaultFailed(false);
                                    setOverride(
                                        authoredView.kind === widget.view
                                            ? undefined
                                            : { id: widget.id, view: authoredView.kind },
                                    );
                                }}>
                                {authoredView.title ?? authoredView.kind}
                            </button>
                        ))}
                    </div>
                ) : !split && candidates.length > 0 ? (
                    <>
                        <select
                            className="rbs-select rbs-view-switch"
                            value={view}
                            aria-label={loc.viewSwitcherLabel(widget.title)}
                            onChange={(e) => {
                                const next = e.target.value as ViewKind;
                                setSaveDefaultFailed(false);
                                setOverride(
                                    next === widget.view
                                        ? undefined
                                        : { id: widget.id, view: next },
                                );
                            }}>
                            {viewOptions.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                        {overriddenView ? (
                            <>
                                <span className="rbs-chip rbs-chip-modified">
                                    {loc.modifiedChip}
                                </span>
                                {!sample && !widget.runField ? (
                                    <button
                                        type="button"
                                        className="rbs-btn rbs-btn-quiet"
                                        disabled={savingDefault}
                                        onClick={() => void saveAsRunbookDefault()}>
                                        {savingDefault
                                            ? loc.savingViewAsRunbookDefault
                                            : loc.saveViewAsRunbookDefault}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="rbs-btn rbs-btn-quiet rbs-view-reset"
                                    title={loc.resetViewTitle}
                                    aria-label={loc.resetViewTitle}
                                    onClick={() => setOverride(undefined)}>
                                    ×
                                </button>
                            </>
                        ) : null}
                    </>
                ) : split ? (
                    <span className="rbs-chip">
                        {splitAxis === "row" ? loc.showAsSideBySide : loc.showAsStacked}
                    </span>
                ) : (
                    <span className="rbs-chip">{widget.view}</span>
                )}
                {widget.drift ? (
                    <span
                        className="rbs-chip rbs-chip-warn"
                        title={loc.driftDetail(widget.drift.requestedView, widget.view)}>
                        {loc.driftBadge}
                    </span>
                ) : null}
                {widget.contract ? (
                    <span className="rbs-muted rbs-mono">{widget.contract}</span>
                ) : null}
                {!sample ? <OutputArtifactActions widget={widget} /> : null}
            </div>
            {widget.drift ? (
                <div className="rbs-drift-notice" role="status">
                    {loc.driftDetail(widget.drift.requestedView, widget.view)}
                </div>
            ) : null}
            {saveDefaultFailed ? (
                <div className="rbs-drift-notice" role="alert">
                    {loc.saveViewAsRunbookDefaultFailed}
                </div>
            ) : null}
            {body}
        </section>
    );
}
