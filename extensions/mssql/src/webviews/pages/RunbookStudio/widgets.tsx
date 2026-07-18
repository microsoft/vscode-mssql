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
 * switcher is an ephemeral client-side override ("this run only"); pinning
 * and persistence are Plan-page concerns.
 */

import { useEffect, useState } from "react";
import { locConstants } from "../../common/locConstants";
import {
    compatibleViews,
    ResolvedWidget,
    ViewKind,
} from "../../../sharedInterfaces/runbookPresentation";
import { RbsFetchOutputPageRequest } from "../../../sharedInterfaces/runbookStudio";
import { useRbs } from "./state";

const PAGE_ROWS = 100;
/** Bar chart shows at most this many rows (with an honest truncation note). */
const BAR_MAX_ROWS = 30;
/** Timeseries draws per-point dots only up to this many points. */
const TS_DOT_MAX_POINTS = 50;
const TS_VIEW_WIDTH = 600;
const TS_VIEW_HEIGHT = 200;
const TS_PAD = 10;

type CellValue = string | number | boolean | null;

interface FetchedPage {
    columns?: string[];
    rows?: Array<Array<CellValue>>;
    totalRows?: number;
    errorCode?: string;
}

function usePage(handleId: string | undefined): FetchedPage | undefined {
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
    }, [handleId]);
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

function GridView({ page }: { page: FetchedPage }) {
    const loc = locConstants.runbookStudio;
    const rows = page.rows ?? [];
    return (
        <div className="rbs-widget-scroll">
            <table className="rbs-table">
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
            {page.totalRows !== undefined && page.totalRows > rows.length ? (
                <div className="rbs-muted">{loc.showingRows(rows.length, page.totalRows)}</div>
            ) : null}
        </div>
    );
}

function ScalarCardsView({ page }: { page: FetchedPage }) {
    // scalarSet pages arrive as name/value rows.
    const entries = (page.rows ?? []).map((row) => ({
        label: String(row[0] ?? ""),
        value: row[1] === null ? "NULL" : String(row[1]),
    }));
    return (
        <div className="rbs-cards">
            {entries.map((entry) => (
                <div className="rbs-card" key={entry.label}>
                    <div className="rbs-card-label">{entry.label}</div>
                    <div className="rbs-card-value">{entry.value}</div>
                </div>
            ))}
        </div>
    );
}

function TextView({ page, mono }: { page: FetchedPage; mono: boolean }) {
    const text = (page.rows ?? [])
        .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join(" "))
        .join("\n");
    return <pre className={`rbs-text-block ${mono ? "rbs-mono" : ""}`}>{text}</pre>;
}

function JsonView({ page }: { page: FetchedPage }) {
    return (
        <pre className="rbs-text-block rbs-mono">
            {JSON.stringify({ columns: page.columns, rows: page.rows }, undefined, 2)}
        </pre>
    );
}

/** Horizontal bar chart for rowset pages: category = first non-numeric
 *  column (row index when every column is numeric), value = first numeric
 *  column. Degrades honestly to the grid when no numeric column exists. */
function BarChartView({ page }: { page: FetchedPage }) {
    const loc = locConstants.runbookStudio;
    const rows = page.rows ?? [];
    const columnCount = columnCountOf(page);
    let valueColumn = -1;
    let categoryColumn = -1;
    for (let i = 0; i < columnCount; i++) {
        if (isNumericColumn(rows, i)) {
            if (valueColumn === -1) {
                valueColumn = i;
            }
        } else if (categoryColumn === -1) {
            categoryColumn = i;
        }
    }
    if (valueColumn === -1) {
        return (
            <>
                <div className="rbs-muted">{loc.noNumericColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    const bars = rows.slice(0, BAR_MAX_ROWS).map((row, index) => {
        const categoryCell = categoryColumn >= 0 ? row[categoryColumn] : undefined;
        return {
            label:
                categoryColumn >= 0
                    ? categoryCell === null || categoryCell === undefined
                        ? "NULL"
                        : String(categoryCell)
                    : String(index + 1),
            value: numericCellValue(row[valueColumn]),
        };
    });
    const maxValue = Math.max(0, ...bars.map((bar) => bar.value ?? 0));
    const totalRows = page.totalRows ?? rows.length;
    const valueName = page.columns?.[valueColumn];
    const categoryName = categoryColumn >= 0 ? page.columns?.[categoryColumn] : undefined;
    return (
        <div
            className="rbs-bar-chart"
            role="group"
            aria-label={
                valueName !== undefined && categoryName !== undefined
                    ? loc.barChartLabel(valueName, categoryName)
                    : undefined
            }>
            {bars.map((bar, index) => {
                const fraction =
                    maxValue > 0 && bar.value !== undefined && bar.value > 0
                        ? bar.value / maxValue
                        : 0;
                const display = bar.value === undefined ? "NULL" : formatNumber(bar.value);
                return (
                    <div
                        className="rbs-bar-row"
                        key={index}
                        role="img"
                        aria-label={`${bar.label}: ${display}`}>
                        <span className="rbs-bar-label" title={bar.label}>
                            {bar.label}
                        </span>
                        <svg
                            className="rbs-bar-svg"
                            height="16"
                            aria-hidden="true"
                            focusable="false">
                            <rect
                                className="rbs-bar-fill"
                                x="0"
                                y="2"
                                rx="2"
                                height="12"
                                width={`${(fraction * 100).toFixed(2)}%`}
                            />
                        </svg>
                        <span className="rbs-bar-value rbs-mono">{display}</span>
                    </div>
                );
            })}
            {totalRows > bars.length ? (
                <div className="rbs-muted">{loc.showingFirstRows(bars.length, totalRows)}</div>
            ) : null}
        </div>
    );
}

/** Line chart for rowset pages: X = first date/time (or monotonic numeric)
 *  column, Y = first numeric column other than X. Degrades honestly to the
 *  grid when no usable axis exists. Fixed viewBox, min/max axis labels only. */
function TimeseriesView({ page }: { page: FetchedPage }) {
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
    let yColumn = -1;
    for (let i = 0; i < columnCount; i++) {
        if (i !== xColumn && isNumericColumn(rows, i)) {
            yColumn = i;
            break;
        }
    }
    if (yColumn === -1) {
        return (
            <>
                <div className="rbs-muted">{loc.noNumericColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    const axis = xAxis;
    const points = rows
        .map((row, index) => ({ x: axis.values[index], y: numericCellValue(row[yColumn]) }))
        .filter(
            (point): point is { x: number; y: number } =>
                point.x !== undefined && point.y !== undefined,
        )
        .sort((a, b) => a.x - b.x);
    if (points.length === 0) {
        return (
            <>
                <div className="rbs-muted">{loc.needsTimeColumn}</div>
                <GridView page={page} />
            </>
        );
    }
    const xMin = points[0].x;
    const xMax = points[points.length - 1].x;
    const yMin = Math.min(...points.map((point) => point.y));
    const yMax = Math.max(...points.map((point) => point.y));
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const px = (x: number) => TS_PAD + ((x - xMin) / xSpan) * (TS_VIEW_WIDTH - 2 * TS_PAD);
    const py = (y: number) =>
        TS_VIEW_HEIGHT - TS_PAD - ((y - yMin) / ySpan) * (TS_VIEW_HEIGHT - 2 * TS_PAD);
    const polylinePoints = points
        .map((point) => `${px(point.x).toFixed(1)},${py(point.y).toFixed(1)}`)
        .join(" ");
    const xName = page.columns?.[xColumn] ?? String(xColumn + 1);
    const yName = page.columns?.[yColumn] ?? String(yColumn + 1);
    const formatX = (value: number) =>
        axis.isTime ? new Date(value).toLocaleString() : formatNumber(value);
    return (
        <div className="rbs-ts-chart" role="img" aria-label={loc.timeseriesLabel(yName, xName)}>
            <div className="rbs-ts-y rbs-mono" aria-hidden="true">
                <span>{formatNumber(yMax)}</span>
                <span>{formatNumber(yMin)}</span>
            </div>
            <div className="rbs-ts-plot">
                <svg
                    className="rbs-ts-svg"
                    viewBox={`0 0 ${TS_VIEW_WIDTH} ${TS_VIEW_HEIGHT}`}
                    aria-hidden="true"
                    focusable="false">
                    <polyline className="rbs-ts-line" points={polylinePoints} />
                    {points.length <= TS_DOT_MAX_POINTS
                        ? points.map((point, index) => (
                              <circle
                                  className="rbs-ts-dot"
                                  key={index}
                                  cx={px(point.x).toFixed(1)}
                                  cy={py(point.y).toFixed(1)}
                                  r="3"
                              />
                          ))
                        : null}
                </svg>
            </div>
            <div className="rbs-ts-x rbs-mono" aria-hidden="true">
                <span>{formatX(xMin)}</span>
                <span>{formatX(xMax)}</span>
            </div>
        </div>
    );
}

export function ResolvedWidgetView({ widget }: { widget: ResolvedWidget }) {
    const loc = locConstants.runbookStudio;
    const page = usePage(widget.state === "ready" ? widget.handleId : undefined);
    // Ephemeral per-widget view override — "this run only": client-side state
    // keyed to the widget id, never persisted and never sent over RPC
    // (pinning is a Plan-page concern). Ignored automatically when the widget
    // identity changes or the override stops being contract-compatible.
    const [override, setOverride] = useState<{ id: string; view: ViewKind } | undefined>(undefined);

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

    let body: React.ReactNode;
    switch (widget.state) {
        case "pending":
            body = <div className="rbs-muted">{loc.widgetPending}</div>;
            break;
        case "noOutput":
            body = <div className="rbs-muted">{loc.noOutputsDetail}</div>;
            break;
        case "expired":
            body = <div className="rbs-muted">{loc.dataExpiredDetail}</div>;
            break;
        case "sourceMissing":
            body = <div className="rbs-muted">{loc.widgetSourceMissing}</div>;
            break;
        case "ready": {
            if (!page) {
                body = <div className="rbs-muted">{loc.loading}</div>;
            } else if (page.errorCode) {
                body = <div className="rbs-muted">{loc.dataExpiredDetail}</div>;
            } else {
                switch (view) {
                    case "grid":
                        body = <GridView page={page} />;
                        break;
                    case "scalar-cards":
                        body = <ScalarCardsView page={page} />;
                        break;
                    case "markdown":
                    case "log-view":
                        body = <TextView page={page} mono={view === "log-view"} />;
                        break;
                    case "json":
                        body = <JsonView page={page} />;
                        break;
                    case "bar":
                        body = <BarChartView page={page} />;
                        break;
                    case "timeseries":
                        body = <TimeseriesView page={page} />;
                        break;
                    default:
                        // Honest degrade: registered-but-unimplemented kinds
                        // say so rather than rendering a blank panel.
                        body = <div className="rbs-muted">{loc.unsupportedRenderer(view)}</div>;
                }
            }
            break;
        }
    }

    const viewOptions = candidates.includes(widget.view)
        ? candidates
        : [widget.view, ...candidates];

    return (
        <section className="rbs-widget" aria-label={widget.title}>
            <div className="rbs-widget-header">
                <span className="rbs-widget-title">{widget.title}</span>
                {candidates.length > 0 ? (
                    <>
                        <select
                            className="rbs-select rbs-view-switch"
                            value={view}
                            aria-label={loc.viewSwitcherLabel(widget.title)}
                            onChange={(e) => {
                                const next = e.target.value as ViewKind;
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
                ) : (
                    <span className="rbs-chip">{widget.view}</span>
                )}
                {widget.drift ? (
                    <span
                        className="rbs-chip rbs-chip-warn"
                        title={loc.driftDetail(widget.drift.requestedView)}>
                        {loc.driftBadge}
                    </span>
                ) : null}
                {widget.contract ? (
                    <span className="rbs-muted rbs-mono">{widget.contract}</span>
                ) : null}
            </div>
            {body}
        </section>
    );
}
