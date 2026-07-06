/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio results region (doc 01 §4.4–4.6): tab strip (Results |
 * Messages), stacked virtualized grids (24px rows) pulling cell windows via
 * QsGetRows (rows NEVER ride notifications — counts only trigger refetch),
 * follow-tail with a "rows added" chip when unpinned, NULL styling from the
 * null bitmap, and a Messages tab whose error blocks navigate the editor.
 *
 * Classic-parity additions: per-column sort/filter over an in-memory
 * "materialized" copy of complete result sets at or under
 * mssql.resultsGrid.inMemoryDataProcessingThreshold (all rows pulled via
 * chunked QsGetRows, then sorted/filtered/rendered locally with the same
 * windowed-render math); lazy grid mounting (ResultGridBlock) so many result
 * sets only mount near the viewport; and display clamping for huge cells,
 * which link out to a plaintext document via qs/openCellDocument.
 */

import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    QsCellWindow,
    QsGetRowsRequest,
    QsGridStyle,
    QsMessageRow,
    QsNavigateToLineRequest,
    QsOpenCellDocumentRequest,
    QsOpenPlanRequest,
    QsResultSetSummary,
} from "../../../sharedInterfaces/queryStudio";
import {
    QS_CELL_DISPLAY_CLAMP,
    QS_CELL_TITLE_CLAMP,
    QS_DISTINCT_VALUES_CAP,
    QsColumnFilter,
    QsSortSpec,
    applyFilterSort,
    cellDisplayText,
    clampDisplay,
    distinctValues,
    isTruncatedCellMarker,
} from "../../../sharedInterfaces/queryStudioGridOps";
import { isJson } from "../../common/jsonUtils";
import { isXmlCell } from "../../common/xmlUtils";

const BASE_ROW_HEIGHT = 24;
const HEADER_HEIGHT = 24;
const OVERSCAN_ROWS = 10;
const MAX_GRID_ROWS_VISIBLE = 14;
/** Chunk size for materializing a full result set (sequential QsGetRows). */
const MATERIALIZE_CHUNK = 512;
/** Fallback when gridStyle hasn't arrived (matches readGridStyle's default). */
const DEFAULT_IN_MEMORY_THRESHOLD = 5000;
const NOTICE_DISMISS_MS = 6000;
const FILTER_POPUP_WIDTH = 240;

/** Classic inMemoryDataProcessingThresholdExceeded intent. */
const PROCESSING_DISABLED_NOTICE =
    "Sorting and filtering are disabled for result sets larger than the in-memory processing " +
    "threshold (mssql.resultsGrid.inMemoryDataProcessingThreshold).";

interface Rpc {
    sendRequest<P, R>(type: { method: string }, params: P): Promise<R>;
}

type CellLinkFormat = "xml" | "json" | "text";

/**
 * XML/JSON link detection (classic hyperLinkFormatter parity): a cell links
 * when its column is XML-typed on the wire, or its content sniffs as
 * XML/JSON — plus "text" links for cells longer than the display clamp so
 * the full value stays reachable. NULL cells never link. Sniffing runs once
 * per rendered window (~34 rows), memoized by the caller.
 */
function cellLinkFormat(
    value: unknown,
    typeHint: string | undefined,
    sqlType: string | undefined,
): CellLinkFormat | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeHint === "xml" || sqlType?.toLowerCase() === "xml") {
        return "xml";
    }
    const text = cellDisplayText(value);
    if (isXmlCell(text)) {
        return "xml";
    }
    if (isJson(text)) {
        return "json";
    }
    if (text.length > QS_CELL_DISPLAY_CLAMP || isTruncatedCellMarker(value)) {
        // Display-clamped OR byte-capped (maxCellBytes) cell — the link
        // opens the raw text so the full received prefix stays reachable.
        return "text";
    }
    return undefined;
}

/** All rows of one result set held client-side for sort/filter. */
interface MaterializedRows {
    /** Null-decoded rows (bitmap nulls become real nulls), by ORIGINAL index. */
    rows: unknown[][];
    columns: QsCellWindow["columns"];
    typeHints?: string[];
}

/** Decode one window's null bitmap into real nulls while materializing. */
function decodeWindowRows(window: QsCellWindow): unknown[][] {
    const bytes = window.nullBitmap ? atob(window.nullBitmap) : undefined;
    const colCount = window.columns.length;
    return window.values.map((row, r) =>
        row.map((cell, c) => {
            if (cell === undefined || cell === null) {
                return null;
            }
            if (bytes) {
                const index = r * colCount + c;
                const byteIndex = index >> 3;
                if (
                    byteIndex < bytes.length &&
                    (bytes.charCodeAt(byteIndex) & (1 << (index & 7))) !== 0
                ) {
                    return null;
                }
            }
            return cell;
        }),
    );
}

/** Caption row shared by the live grid and the lazy placeholder. */
function GridCaption(props: { rpc: Rpc; summary: QsResultSetSummary; children?: ReactNode }) {
    const { rpc, summary, children } = props;
    return (
        <div className="qs-grid-caption">
            <span className="qs-grid-caption-title">
                Result {summary.batchOrdinal + 1}.{summary.resultSetId.split("s").pop()}
            </span>
            <span className="qs-muted">
                {summary.rowCount.toLocaleString()} row{summary.rowCount === 1 ? "" : "s"}
                {summary.truncatedReason ? ` · truncated (${summary.truncatedReason})` : ""}
                {!summary.complete && !summary.truncatedReason ? " · streaming…" : ""}
            </span>
            {summary.isPlanResult ? (
                // QS-1: plan-flagged sets link out to the execution plan
                // viewer. The host answers {opened:false} silently on failure.
                <a
                    className="qs-cell-link qs-plan-link"
                    role="button"
                    title="Open in the execution plan viewer"
                    onClick={() => {
                        void rpc.sendRequest(QsOpenPlanRequest.type, {
                            resultSetId: summary.resultSetId,
                        });
                    }}>
                    Open execution plan
                </a>
            ) : null}
            {children}
        </div>
    );
}

/**
 * Compact per-column filter popup (classic headerFilter parity): sort
 * buttons, a case-insensitive "contains" input, and a distinct-values
 * checkbox list capped at QS_DISTINCT_VALUES_CAP entries.
 */
function FilterPopup(props: {
    column: number;
    columnName: string;
    filter: QsColumnFilter | undefined;
    materialized: MaterializedRows | undefined;
    anchor: { left: number; top: number };
    onSort: (direction: "asc" | "desc") => void;
    onApply: (filter: { contains?: string; values?: string[] } | undefined) => void;
    onClose: () => void;
}) {
    const { column, columnName, filter, materialized, anchor, onSort, onApply, onClose } = props;
    const [contains, setContains] = useState(filter?.contains ?? "");
    // undefined = all values selected (no distinct-values filter).
    const [checked, setChecked] = useState<Set<string> | undefined>(
        filter?.values ? new Set(filter.values) : undefined,
    );
    const rootRef = useRef<HTMLDivElement | null>(null);

    const distinct = useMemo(
        () => (materialized ? distinctValues(materialized.rows, column) : undefined),
        [materialized, column],
    );

    // Dismiss on outside click / Escape.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (
                rootRef.current &&
                e.target instanceof Node &&
                !rootRef.current.contains(e.target)
            ) {
                onClose();
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    const isChecked = (value: string) => (checked ? checked.has(value) : true);
    const allChecked =
        checked === undefined ||
        (distinct !== undefined && distinct.values.every((value) => checked.has(value)));
    const toggleValue = (value: string) => {
        setChecked((prev) => {
            const next = new Set(prev ?? distinct?.values ?? []);
            if (next.has(value)) {
                next.delete(value);
            } else {
                next.add(value);
            }
            return next;
        });
    };

    const apply = () => {
        const values = checked !== undefined && !allChecked ? [...checked] : undefined;
        const trimmed = contains.trim();
        if (trimmed.length === 0 && values === undefined) {
            onApply(undefined);
        } else {
            onApply({
                ...(trimmed.length > 0 ? { contains: trimmed } : {}),
                ...(values ? { values } : {}),
            });
        }
    };

    return (
        <div
            ref={rootRef}
            className="qs-filter-popup"
            role="dialog"
            aria-label={`Filter ${columnName}`}
            style={{ left: anchor.left, top: anchor.top, width: FILTER_POPUP_WIDTH }}>
            <div className="qs-filter-title">{columnName}</div>
            <div className="qs-filter-sort-row">
                <button className="qs-btn" onClick={() => onSort("asc")}>
                    <span className="codicon codicon-arrow-up" /> Sort Ascending
                </button>
                <button className="qs-btn" onClick={() => onSort("desc")}>
                    <span className="codicon codicon-arrow-down" /> Sort Descending
                </button>
            </div>
            <input
                className="qs-filter-input"
                type="text"
                placeholder="Contains…"
                value={contains}
                onChange={(e) => setContains(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        apply();
                    }
                }}
            />
            <div className="qs-filter-values">
                {distinct ? (
                    <>
                        <label className="qs-filter-value">
                            <input
                                type="checkbox"
                                checked={allChecked}
                                onChange={() => setChecked(allChecked ? new Set() : undefined)}
                            />
                            <span>(Select All)</span>
                        </label>
                        {distinct.values.map((value) => (
                            <label key={value} className="qs-filter-value">
                                <input
                                    type="checkbox"
                                    checked={isChecked(value)}
                                    onChange={() => toggleValue(value)}
                                />
                                <span title={clampDisplay(value, QS_CELL_TITLE_CLAMP)}>
                                    {clampDisplay(value, 64)}
                                </span>
                            </label>
                        ))}
                        {distinct.hasMore ? (
                            <div className="qs-muted qs-filter-more">
                                …more (first {QS_DISTINCT_VALUES_CAP} distinct values shown)
                            </div>
                        ) : null}
                    </>
                ) : (
                    <div className="qs-muted">Loading values…</div>
                )}
            </div>
            <div className="qs-filter-actions">
                <button className="qs-btn primary" onClick={apply}>
                    Apply
                </button>
                <button className="qs-btn" onClick={() => onApply(undefined)}>
                    Clear
                </button>
            </div>
        </div>
    );
}

/** One virtualized grid over a single result set. */
export function ResultGrid(props: {
    rpc: Rpc;
    summary: QsResultSetSummary;
    /** Bumped by QsRowsAppended for this set — triggers window refresh. */
    version: number;
    /** Grid styling from QsState (classic mssql.resultsGrid.* parity). */
    gridStyle?: QsGridStyle;
}) {
    const { rpc, summary, version, gridStyle } = props;
    const blockRef = useRef<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [window_, setWindow] = useState<QsCellWindow | undefined>(undefined);
    const [scrollTop, setScrollTop] = useState(0);
    const [pinned, setPinned] = useState(true);
    const [unseenRows, setUnseenRows] = useState(0);
    /** Selection rides SOURCE (original) row indices, stable across sort. */
    const [selected, setSelected] = useState<{ row: number; col: number } | undefined>(undefined);
    const lastCountRef = useRef(summary.rowCount);
    const fetchSeqRef = useRef(0);

    // --- materialized mode (classic in-memory sort/filter) -----------------
    const [sort, setSort] = useState<QsSortSpec | undefined>(undefined);
    const [filters, setFilters] = useState<QsColumnFilter[]>([]);
    const [materialized, setMaterialized] = useState<MaterializedRows | undefined>(undefined);
    const [materializing, setMaterializing] = useState(false);
    const [notice, setNotice] = useState<string | undefined>(undefined);
    const [filterPopup, setFilterPopup] = useState<
        { column: number; left: number; top: number } | undefined
    >(undefined);
    const materializePromiseRef = useRef<Promise<MaterializedRows | undefined> | undefined>(
        undefined,
    );
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const inMemoryThreshold =
        gridStyle?.inMemoryDataProcessingThreshold ?? DEFAULT_IN_MEMORY_THRESHOLD;
    // Sort/filter only over COMPLETE result sets at or under the threshold.
    const canProcessInMemory = summary.complete && summary.rowCount <= inMemoryThreshold;

    // Row height drives BOTH the virtualization math and the CSS custom
    // property — they must stay the same value (rowPadding parity).
    const rowHeight = BASE_ROW_HEIGHT + Math.max(0, gridStyle?.rowPadding ?? 0);
    const viewportRows = Math.min(summary.rowCount, MAX_GRID_ROWS_VISIBLE);
    const viewportHeight = viewportRows * rowHeight + HEADER_HEIGHT + 2;

    const showNotice = useCallback((text: string) => {
        setNotice(text);
        if (noticeTimerRef.current) {
            clearTimeout(noticeTimerRef.current);
        }
        noticeTimerRef.current = setTimeout(() => setNotice(undefined), NOTICE_DISMISS_MS);
    }, []);
    useEffect(
        () => () => {
            if (noticeTimerRef.current) {
                clearTimeout(noticeTimerRef.current);
            }
        },
        [],
    );

    /** Pull ALL rows via sequential chunked QsGetRows (once per grid). */
    const ensureMaterialized = useCallback((): Promise<MaterializedRows | undefined> => {
        if (materializePromiseRef.current) {
            return materializePromiseRef.current;
        }
        setMaterializing(true);
        const total = summary.rowCount;
        const promise = (async () => {
            try {
                const rows: unknown[][] = [];
                let columns: QsCellWindow["columns"] = [];
                let typeHints: string[] | undefined;
                for (let start = 0; start < total; start += MATERIALIZE_CHUNK) {
                    const win = await rpc.sendRequest<
                        { resultSetId: string; start: number; count: number },
                        QsCellWindow
                    >(QsGetRowsRequest.type, {
                        resultSetId: summary.resultSetId,
                        start,
                        count: Math.min(MATERIALIZE_CHUNK, total - start),
                    });
                    if (columns.length === 0) {
                        columns = win.columns;
                    }
                    typeHints ??= win.typeHints;
                    const decoded = decodeWindowRows(win);
                    rows.push(...decoded);
                    if (decoded.length === 0) {
                        break; // defensive: host returned short
                    }
                }
                const data: MaterializedRows = {
                    rows,
                    columns,
                    ...(typeHints ? { typeHints } : {}),
                };
                setMaterialized(data);
                return data;
            } catch {
                materializePromiseRef.current = undefined; // allow retry
                return undefined;
            } finally {
                setMaterializing(false);
            }
        })();
        materializePromiseRef.current = promise;
        return promise;
    }, [rpc, summary.resultSetId, summary.rowCount]);

    /** Gate sort/filter engagement; false = blocked (note shown). */
    const engageProcessing = useCallback((): boolean => {
        if (materialized) {
            return true;
        }
        if (!canProcessInMemory) {
            showNotice(PROCESSING_DISABLED_NOTICE);
            return false;
        }
        void ensureMaterialized();
        return true;
    }, [materialized, canProcessInMemory, ensureMaterialized, showNotice]);

    // Header text click: asc → desc → none.
    const toggleSort = useCallback(
        (column: number) => {
            if (!engageProcessing()) {
                return;
            }
            setSort((prev) =>
                prev?.column !== column
                    ? { column, direction: "asc" }
                    : prev.direction === "asc"
                      ? { column, direction: "desc" }
                      : undefined,
            );
        },
        [engageProcessing],
    );

    const openFilterPopup = useCallback(
        (column: number, e: React.MouseEvent) => {
            e.stopPropagation(); // do not also toggle the header sort
            if (filterPopup?.column === column) {
                setFilterPopup(undefined);
                return;
            }
            if (!engageProcessing()) {
                return;
            }
            const block = blockRef.current;
            const th = (e.currentTarget as HTMLElement).closest("th");
            if (!block || !th) {
                return;
            }
            const blockRect = block.getBoundingClientRect();
            const thRect = th.getBoundingClientRect();
            const left = Math.max(
                0,
                Math.min(thRect.left - blockRect.left, blockRect.width - FILTER_POPUP_WIDTH),
            );
            setFilterPopup({ column, left, top: thRect.bottom - blockRect.top });
        },
        [engageProcessing, filterPopup],
    );

    const applyColumnFilter = useCallback(
        (column: number, filter: { contains?: string; values?: string[] } | undefined) => {
            setFilters((prev) => {
                const rest = prev.filter((f) => f.column !== column);
                return filter ? [...rest, { column, ...filter }] : rest;
            });
            setFilterPopup(undefined);
        },
        [],
    );

    // View order: ORIGINAL row indices after filter + sort. Identity order
    // while unsorted/unfiltered — materialized grids always render locally.
    const viewIndices = useMemo(
        () =>
            materialized
                ? applyFilterSort(materialized.rows, sort, filters, materialized.typeHints)
                : undefined,
        [materialized, sort, filters],
    );
    const displayRowCount = viewIndices ? viewIndices.length : summary.rowCount;

    const fetchWindow = useCallback(
        (top: number) => {
            const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN_ROWS);
            const count = viewportRows + OVERSCAN_ROWS * 2;
            const seq = ++fetchSeqRef.current;
            void rpc
                .sendRequest<
                    { resultSetId: string; start: number; count: number },
                    QsCellWindow
                >(QsGetRowsRequest.type, { resultSetId: summary.resultSetId, start: first, count })
                .then((result) => {
                    if (seq === fetchSeqRef.current) {
                        setWindow(result);
                    }
                });
        },
        [rpc, summary.resultSetId, viewportRows, rowHeight],
    );

    // Refetch when rows arrive: follow-tail if pinned, else count unseen.
    // Materialized grids are complete — render locally, never refetch.
    useEffect(() => {
        if (materialized) {
            return;
        }
        const container = containerRef.current;
        const added = summary.rowCount - lastCountRef.current;
        lastCountRef.current = summary.rowCount;
        if (pinned && container) {
            const bottom = Math.max(0, summary.rowCount * rowHeight - viewportRows * rowHeight);
            container.scrollTop = bottom;
            fetchWindow(bottom);
        } else {
            if (added > 0) {
                setUnseenRows((n) => n + added);
            }
            fetchWindow(scrollTop);
        }
    }, [version, summary.rowCount, materialized]);

    const onScroll = useCallback(
        (e: React.UIEvent<HTMLDivElement>) => {
            const top = e.currentTarget.scrollTop;
            setScrollTop(top);
            const atBottom =
                top + e.currentTarget.clientHeight >= e.currentTarget.scrollHeight - rowHeight;
            setPinned(atBottom);
            if (atBottom) {
                setUnseenRows(0);
            }
            if (!materialized) {
                // Materialized mode slices the local array off scrollTop state.
                requestAnimationFrame(() => fetchWindow(top));
            }
        },
        [fetchWindow, rowHeight, materialized],
    );

    const jumpToTail = useCallback(() => {
        setPinned(true);
        setUnseenRows(0);
        const container = containerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            if (!materialized) {
                fetchWindow(container.scrollTop);
            }
        }
    }, [fetchWindow, materialized]);

    /**
     * Unified render window: the RPC-fetched window, or a slice of the
     * materialized view (same windowed-render math, RPC short-circuited).
     * `sourceIndices` carries ORIGINAL row numbers alongside each row.
     */
    const renderWindow = useMemo(() => {
        if (materialized && viewIndices) {
            const count = viewportRows + OVERSCAN_ROWS * 2;
            const first = Math.max(
                0,
                Math.min(
                    Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS,
                    viewIndices.length - count,
                ),
            );
            const slice = viewIndices.slice(first, first + count);
            return {
                start: first,
                sourceIndices: slice,
                values: slice.map((i) => materialized.rows[i]),
                columns: materialized.columns,
                typeHints: materialized.typeHints,
            };
        }
        if (window_) {
            const start = window_.start ?? 0;
            return {
                start,
                sourceIndices: window_.values.map((_row, r) => start + r),
                values: window_.values,
                columns: window_.columns,
                typeHints: window_.typeHints,
            };
        }
        return undefined;
    }, [materialized, viewIndices, window_, scrollTop, rowHeight, viewportRows]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!selected || !renderWindow || !(e.ctrlKey || e.metaKey)) {
                return;
            }
            if (e.key.toLowerCase() !== "c") {
                return;
            }
            const rowInWindow = renderWindow.sourceIndices.indexOf(selected.row);
            const row = rowInWindow >= 0 ? renderWindow.values[rowInWindow] : undefined;
            if (!row) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const text = e.shiftKey
                ? summary.columnNames.join("\t") +
                  "\n" +
                  row.map((c) => cellDisplayText(c)).join("\t")
                : cellDisplayText(row[selected.col]);
            void navigator.clipboard.writeText(text);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [selected, renderWindow, summary.columnNames]);

    // XML/JSON/huge-text link formats, sniffed once per rendered window.
    const linkFormats = useMemo(
        () =>
            renderWindow?.values.map((row) =>
                row.map((cell, c) =>
                    cellLinkFormat(
                        cell,
                        renderWindow.typeHints?.[c],
                        renderWindow.columns[c]?.sqlType,
                    ),
                ),
            ),
        [renderWindow],
    );

    const openCellDocument = useCallback(
        (row: number, column: number, format: CellLinkFormat) => {
            void rpc.sendRequest(QsOpenCellDocumentRequest.type, {
                resultSetId: summary.resultSetId,
                row,
                column,
                format,
            });
        },
        [rpc, summary.resultSetId],
    );

    // Grid styling → CSS custom properties + mode classes (classic parity).
    const gridBlockStyle = {
        ...(gridStyle?.fontFamily ? { "--qs-grid-font-family": gridStyle.fontFamily } : {}),
        ...(gridStyle?.fontSize ? { "--qs-grid-font-size": `${gridStyle.fontSize}px` } : {}),
        "--qs-grid-row-height": `${rowHeight}px`,
    } as CSSProperties;
    const gridBlockClass =
        `qs-grid-block qs-gridlines-${gridStyle?.showGridLines ?? "both"}` +
        (gridStyle?.alternatingRowColors ? " qs-grid-alt-rows" : "");

    const headerTitle =
        canProcessInMemory || materialized ? "Click to sort" : PROCESSING_DISABLED_NOTICE;

    return (
        <div className={gridBlockClass} style={gridBlockStyle} ref={blockRef}>
            <GridCaption rpc={rpc} summary={summary}>
                {materializing ? <span className="qs-muted">loading all rows…</span> : null}
                {viewIndices && viewIndices.length !== summary.rowCount ? (
                    <span className="qs-muted">
                        {viewIndices.length.toLocaleString()} of {summary.rowCount.toLocaleString()}{" "}
                        shown
                    </span>
                ) : null}
                {unseenRows > 0 ? (
                    <button className="qs-chip" onClick={jumpToTail}>
                        ↓ {unseenRows.toLocaleString()} new rows
                    </button>
                ) : null}
            </GridCaption>
            {notice ? (
                <div className="qs-grid-notice" role="alert">
                    {notice}
                </div>
            ) : null}
            <div
                ref={containerRef}
                className="qs-grid-viewport"
                style={{ height: viewportHeight }}
                onScroll={onScroll}>
                <table
                    className="qs-grid-table"
                    style={{ height: HEADER_HEIGHT + displayRowCount * rowHeight }}>
                    <thead>
                        <tr>
                            <th className="qs-grid-rownum" />
                            {summary.columnNames.map((name, i) => {
                                const sorted = sort?.column === i ? sort.direction : undefined;
                                const filtered = filters.some((f) => f.column === i);
                                return (
                                    <th
                                        key={i}
                                        className="qs-col-header"
                                        title={headerTitle}
                                        onClick={() => toggleSort(i)}>
                                        <span className="qs-col-header-inner">
                                            <span className="qs-col-name">
                                                {name || `(col ${i + 1})`}
                                            </span>
                                            {sorted ? (
                                                <span
                                                    className={`codicon codicon-arrow-${sorted === "asc" ? "up" : "down"}`}
                                                />
                                            ) : null}
                                            <span
                                                className={`codicon codicon-filter${filtered ? "-filled" : ""} qs-col-filter${filtered ? " qs-col-filter-active" : ""}`}
                                                role="button"
                                                aria-label={`Filter ${name || `column ${i + 1}`}`}
                                                title="Filter"
                                                // Keep the popup's outside-click
                                                // dismisser from seeing this press.
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => openFilterPopup(i, e)}
                                            />
                                        </span>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {renderWindow ? (
                            <>
                                {/* Spacer row positions the rendered window. */}
                                {renderWindow.start > 0 ? (
                                    <tr style={{ height: renderWindow.start * rowHeight }}>
                                        <td colSpan={summary.columnNames.length + 1} />
                                    </tr>
                                ) : null}
                                {renderWindow.values.map((row, r) => {
                                    const sourceIndex = renderWindow.sourceIndices[r];
                                    const displayIndex = renderWindow.start + r;
                                    return (
                                        <tr
                                            key={displayIndex}
                                            // Alternation by ABSOLUTE display index —
                                            // DOM nth-child parity shifts with the
                                            // spacer row.
                                            className={`qs-grid-row${displayIndex % 2 === 1 ? " qs-row-alt" : ""}`}>
                                            <td className="qs-grid-rownum">{sourceIndex + 1}</td>
                                            {row.map((cell, c) => {
                                                const isNull = cell === undefined || cell === null;
                                                const isSelected =
                                                    selected?.row === sourceIndex &&
                                                    selected?.col === c;
                                                const linkFormat = isNull
                                                    ? undefined
                                                    : linkFormats?.[r]?.[c];
                                                const text = isNull
                                                    ? "NULL"
                                                    : cellDisplayText(cell);
                                                const display = clampDisplay(
                                                    text,
                                                    QS_CELL_DISPLAY_CLAMP,
                                                );
                                                return (
                                                    <td
                                                        key={c}
                                                        className={`${isNull ? "qs-cell-null" : ""}${isSelected ? " qs-cell-selected" : ""}`}
                                                        onClick={() =>
                                                            setSelected({
                                                                row: sourceIndex,
                                                                col: c,
                                                            })
                                                        }
                                                        title={clampDisplay(
                                                            text,
                                                            QS_CELL_TITLE_CLAMP,
                                                        )}>
                                                        {linkFormat ? (
                                                            <a
                                                                className="qs-cell-link"
                                                                onClick={(e) => {
                                                                    // Selection still runs via
                                                                    // the td onClick (bubbles).
                                                                    e.preventDefault();
                                                                    openCellDocument(
                                                                        sourceIndex,
                                                                        c,
                                                                        linkFormat,
                                                                    );
                                                                }}>
                                                                {display}
                                                            </a>
                                                        ) : (
                                                            display
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </>
                        ) : null}
                    </tbody>
                </table>
            </div>
            {filterPopup ? (
                <FilterPopup
                    key={filterPopup.column}
                    column={filterPopup.column}
                    columnName={
                        summary.columnNames[filterPopup.column] || `(col ${filterPopup.column + 1})`
                    }
                    filter={filters.find((f) => f.column === filterPopup.column)}
                    materialized={materialized}
                    anchor={filterPopup}
                    onSort={(direction) => {
                        setSort({ column: filterPopup.column, direction });
                        setFilterPopup(undefined);
                    }}
                    onApply={(filter) => applyColumnFilter(filterPopup.column, filter)}
                    onClose={() => setFilterPopup(undefined)}
                />
            ) : null}
        </div>
    );
}

/**
 * Lazy-mount wrapper for many-result-sets runs: the caption always renders,
 * but the grid body only mounts once the block comes within ~1.5 viewports
 * of the results scroll container (IntersectionObserver, rootMargin
 * "150% 0px") — and never unmounts again. The placeholder reserves the same
 * height as the mounted viewport so scroll geometry stays stable.
 */
export function ResultGridBlock(props: {
    rpc: Rpc;
    summary: QsResultSetSummary;
    version: number;
    gridStyle?: QsGridStyle;
}) {
    const { rpc, summary, gridStyle } = props;
    const [mounted, setMounted] = useState(false);
    const placeholderRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (mounted) {
            return;
        }
        const el = placeholderRef.current;
        if (!el) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setMounted(true); // never unmounts once mounted
                }
            },
            { root: el.closest(".qs-results-body"), rootMargin: "150% 0px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [mounted]);

    if (mounted) {
        return <ResultGrid {...props} />;
    }
    const rowHeight = BASE_ROW_HEIGHT + Math.max(0, gridStyle?.rowPadding ?? 0);
    const height =
        Math.min(summary.rowCount, MAX_GRID_ROWS_VISIBLE) * rowHeight + HEADER_HEIGHT + 2;
    return (
        <div className="qs-grid-block" ref={placeholderRef}>
            <GridCaption rpc={rpc} summary={summary} />
            <div className="qs-grid-placeholder" style={{ height }}>
                {summary.rowCount.toLocaleString()} row{summary.rowCount === 1 ? "" : "s"} — scroll
                to load
            </div>
        </div>
    );
}

/** Messages tab: monospace log; error blocks navigate to the document line. */
export function MessagesView(props: { rpc: Rpc; messages: QsMessageRow[] }) {
    const { rpc, messages } = props;
    const navigate = useCallback(
        (message: QsMessageRow) => {
            if (message.navigable) {
                void rpc.sendRequest(QsNavigateToLineRequest.type, {
                    line: message.navigable.line,
                    column: message.navigable.column,
                });
            }
        },
        [rpc],
    );
    return (
        <div className="qs-messages" role="log">
            {messages.map((message, i) => (
                <div
                    key={i}
                    className={`qs-message qs-message-${message.kind}${message.navigable ? " qs-message-nav" : ""}`}
                    onClick={() => navigate(message)}
                    title={message.navigable ? "Go to line" : undefined}>
                    {message.server?.number !== undefined ? (
                        <span className="qs-message-server">
                            Msg {message.server.number}, Level {message.server.severity ?? 0}
                            {message.server.line !== undefined
                                ? `, Line ${message.server.line}`
                                : ""}
                            {": "}
                        </span>
                    ) : null}
                    {message.text}
                </div>
            ))}
            {messages.length === 0 ? <div className="qs-muted qs-message">No messages.</div> : null}
        </div>
    );
}
