/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio ⇄ FluentResultGrid adapter (issue C/D/E — grid reuse).
 *
 * The classic results webview's react grid (webviews/common/FluentResultGrid,
 * slickgrid-react underneath) already provides windowed server-side row
 * fetch, rectangular cell selection, keyboard navigation, header sort/filter,
 * column resize/freeze/hide, and copy commands. This module mounts it over
 * the QS data plane:
 *
 * - dataSource "windowed" → QsGetRows cell windows (null bitmap decoded,
 *   display text clamped at QS_CELL_DISPLAY_CLAMP — bounded windows, never
 *   an unbounded fetch).
 * - copy commands → chunked QsGetRows over the selection (SOURCE row space —
 *   the grid converts sorted/filtered display rows back before emitting) →
 *   TSV on the clipboard.
 * - XML/JSON cell links → qs/openCellDocument with the SOURCE row (cell
 *   rowId rides the adapter rows through sort/filter).
 * - sort/filter engage only for COMPLETE result sets at or under
 *   mssql.resultsGrid.inMemoryDataProcessingThreshold (threshold 0 while
 *   streaming keeps the fetch windowed).
 */

import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from "react";
import {
    FluentResultGrid,
    FluentResultGridCommand,
    FluentResultGridCommandPlacement,
    FluentResultGridProvider,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandEvent,
    type FluentResultGridColumnWindow,
    type FluentResultGridKeyBindingMap,
    type FluentResultGridHandle,
    type FluentResultGridStrings,
    type FluentResultGridState,
    type FluentResultGridTheme,
} from "../../common/FluentResultGrid";
import "../../common/FluentResultGrid/FluentResultGrid.vscode.css";
import "../../media/table.css";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    ColorThemeKind,
    WebviewAction,
    type WebviewKeyBindings,
} from "../../../sharedInterfaces/webview";
import type {
    GridSettings,
    IDbColumn,
    ISlickRange,
    ResultSetSummary,
} from "../../../sharedInterfaces/queryResult";
import {
    QsCellWindow,
    QsGetRowsRequest,
    type QsGetRowsParams,
    QsGridStyle,
    QsOpenCellDocumentRequest,
    QsResultColumn,
    QsSaveResultRequest,
    QsSetViewModeRequest,
    QsResultSetSummary,
    QsState,
    QsUpdateGridSelectionRequest,
} from "../../../sharedInterfaces/queryStudio";
import { cellTextForPurpose } from "../../../sharedInterfaces/queryStudioGridOps";
import {
    queryStudioWindowNullFlags,
    queryStudioWindowToGridRows,
} from "../../../sharedInterfaces/queryStudioGridWindow";
import {
    planQueryStudioGridCopy,
    queryStudioGridCopyColumnRuns,
    type QueryStudioGridCopyInterval,
} from "../../../sharedInterfaces/queryStudioGridCopy";
import { perfMark, perfMarkAfterNextPaint, perfMarksEnabled } from "../../common/perfMarks";
import { countFluentResultGridSelectedRows } from "../../common/FluentResultGrid/internal/fluentResultGridSelection";
import {
    queryStudioPerfScrollOffset,
    registerQueryStudioPerfGridController,
} from "./queryStudioPerfInteraction";

// BOOT-2: light shell-facing pieces live in resultsGridShared (the entry
// chunk must never pull this module's slickgrid stack); re-exported here so
// heavy-side consumers keep one import site.
export { qsGridRowHeight, type Rpc } from "./resultsGridShared";
import { qsGridRowHeight, Rpc } from "./resultsGridShared";

/** Large narrow copies may amortize RPC overhead, but never request more rows. */
const COPY_MAX_ROWS_PER_WINDOW = 8_192;
/** Responsive work quantum: decoded cell objects retained/processed per turn. */
const COPY_TARGET_DECODED_CELLS_PER_WINDOW = 8_192;
/** Approx. 16 MiB UTF-16 payload, before the browser clipboard's own copy. */
const COPY_MAX_TSV_CHARACTERS = 8_000_000;
const DEFAULT_FONT_SIZE = 12;
const GRID_COLUMN_WINDOWING = {
    minimumColumnCount: 64,
    overscanColumnCount: 8,
} as const;

export const COPY_TOO_LARGE_NOTICE =
    "Selection is too large to copy to the clipboard — use a smaller selection.";
export const PROCESSING_DISABLED_NOTICE =
    "Sorting and filtering are disabled for result sets larger than the in-memory processing " +
    "threshold (mssql.resultsGrid.inMemoryDataProcessingThreshold).";
export const PROCESSING_STREAMING_NOTICE =
    "Sorting and filtering become available when the result set finishes streaming.";
const QUERY_STUDIO_GRID_INITIAL_STATE = {
    frozenColumnIndex: -1,
} satisfies FluentResultGridState;

function fabricateColumnInfo(
    columnNames: readonly string[],
    columns?: readonly QsResultColumn[],
): IDbColumn[] {
    return columnNames.map((name, i) => {
        const column = columns?.[i];
        const sqlType = column?.sqlType ?? "";
        const typeName = sqlType.trim().toLowerCase();
        return {
            columnName: name || `(col ${i + 1})`,
            baseCatalogName: "",
            baseColumnName: "",
            baseSchemaName: "",
            baseServerName: "",
            baseTableName: "",
            dataType: sqlType,
            dataTypeName: sqlType,
            isXml: column?.isXml === true || typeName === "xml",
            isJson: column?.isJson === true || typeName === "json",
            udtAssemblyQualifiedName: "",
        };
    });
}

/** Numeric set ordinal parsed from a "b0r0s0"-shaped result set id. */
function resultSetOrdinal(resultSetId: string): number {
    const ordinal = Number(resultSetId.split("s").pop());
    return Number.isFinite(ordinal) ? ordinal : 0;
}

// ---------------------------------------------------------------------------
// Copy (issue C): selection ranges → chunked QsGetRows → TSV
// ---------------------------------------------------------------------------

/** Decode a projected copy window directly to exact TSV field text. */
function windowToCopyRows(window: QsCellWindow, columnCount: number): string[][] {
    const isNull = queryStudioWindowNullFlags(window);
    return window.values.map((row, rowIndex) => {
        const fields: string[] = [];
        for (let column = 0; column < columnCount; column++) {
            fields.push(
                isNull(rowIndex, column) ? "NULL" : cellTextForPurpose(row[column], "copy"),
            );
        }
        return fields;
    });
}

async function fetchCopyRowsWindow(
    rpc: Rpc,
    resultSetId: string,
    start: number,
    count: number,
    columns: { start: number; count: number },
): Promise<string[][]> {
    // Projected fetch (QO-7b): only selected contiguous column runs cross
    // the RPC. Two distant columns never pull the intervening wide payload.
    const window = await rpc.sendRequest<
        {
            resultSetId: string;
            start: number;
            count: number;
            columnStart: number;
            columnCount: number;
        },
        QsCellWindow
    >(QsGetRowsRequest.type, {
        resultSetId,
        start,
        count,
        columnStart: columns.start,
        columnCount: columns.count,
    });
    return windowToCopyRows(window, columns.count);
}

function columnCount(interval: QueryStudioGridCopyInterval): number {
    return interval.to - interval.from + 1;
}

function copyHeaderLine(
    summary: QsResultSetSummary,
    columnRuns: readonly QueryStudioGridCopyInterval[],
): string {
    const headers: string[] = [];
    for (const run of columnRuns) {
        for (let column = run.from; column <= run.to; column++) {
            headers.push(summary.columnNames[column] ?? "");
        }
    }
    return headers.join("\t");
}

/**
 * Build the clipboard TSV for the selection. Ranges arrive in SOURCE row
 * space and DATA column space (the grid strips the row-number column and
 * un-sorts display rows before emitting copy commands).
 *
 * Multi-range (ctrl-click / ctrl+shift-click) selections copy with SSMS
 * union semantics: the output covers every row and column touched by ANY
 * range — one coherent table — and cells inside that union that are not
 * actually selected emit as empty fields. Headers are the union columns'.
 */
export async function copySelectionAsTsv(
    rpc: Rpc,
    summary: QsResultSetSummary,
    selection: readonly ISlickRange[],
    includeHeaders: boolean,
): Promise<"copied" | "tooLarge" | "empty"> {
    const started = performance.now();
    perfMark("mssql.queryStudio.grid.copy.begin", {
        resultSetId: summary.resultSetId,
        ranges: selection.length,
        resultRows: summary.rowCount,
        resultColumns: summary.columnNames.length,
        includeHeaders,
    });
    const planned = planQueryStudioGridCopy(
        selection,
        summary.rowCount,
        summary.columnNames.length,
    );
    const planMs = Math.max(0, performance.now() - started);
    let rpcRequests = 0;
    let characters = 0;
    let fetchDecodeMs = 0;
    let formatMs = 0;
    let clipboardMs = 0;
    let windowRows = 0;
    const finish = (
        outcome: "copied" | "tooLarge" | "empty" | "error",
        details?: { rows?: number; columns?: number; cells?: number; reason?: string },
    ) => {
        perfMark("mssql.queryStudio.grid.copy.end", {
            resultSetId: summary.resultSetId,
            outcome,
            rpcRequests,
            characters,
            planMs,
            fetchDecodeMs,
            formatMs,
            clipboardMs,
            windowRows,
            durationMs: Math.max(0, performance.now() - started),
            ...details,
        });
    };
    if (planned.kind !== "ok") {
        finish(planned.kind, planned.kind === "tooLarge" ? { reason: planned.reason } : undefined);
        return planned.kind;
    }

    const { plan } = planned;
    const details = {
        rows: plan.rowCount,
        columns: plan.columnCount,
        cells: plan.outputCellCount,
    };
    // Keep line strings until the Clipboard API call, but do not retain a
    // second decoded matrix. Newline segments avoid another lines.join("\n")
    // traversal and let the exact character budget include separators.
    const textSegments: string[] = [];
    let lineCount = 0;
    const appendLine = (line: string): boolean => {
        const added = line.length + (lineCount > 0 ? 1 : 0);
        if (characters + added > COPY_MAX_TSV_CHARACTERS) {
            return false;
        }
        if (lineCount > 0) {
            textSegments.push("\n");
        }
        textSegments.push(line);
        characters += added;
        lineCount++;
        return true;
    };

    try {
        if (includeHeaders) {
            const formatStarted = performance.now();
            const appended = appendLine(copyHeaderLine(summary, plan.columnRuns));
            formatMs += Math.max(0, performance.now() - formatStarted);
            if (!appended) {
                finish("tooLarge", { ...details, reason: "characters" });
                return "tooLarge";
            }
        }

        // Bound the sum of decoded objects across all projected column runs.
        // Wide selections therefore use fewer rows per request window.
        windowRows = Math.max(
            1,
            Math.min(
                COPY_MAX_ROWS_PER_WINDOW,
                Math.floor(COPY_TARGET_DECODED_CELLS_PER_WINDOW / plan.columnCount),
            ),
        );
        let rowBandIndex = 0;
        for (const rowRun of plan.rowRuns) {
            let start = rowRun.from;
            while (start <= rowRun.to) {
                const requestedRows = Math.min(windowRows, rowRun.to - start + 1);
                const fetchedRuns: string[][][] = [];
                let returnedRows = requestedRows;
                for (const run of plan.columnRuns) {
                    const fetchStarted = performance.now();
                    const decoded = await fetchCopyRowsWindow(
                        rpc,
                        summary.resultSetId,
                        start,
                        requestedRows,
                        { start: run.from, count: columnCount(run) },
                    );
                    fetchDecodeMs += Math.max(0, performance.now() - fetchStarted);
                    rpcRequests++;
                    fetchedRuns.push(decoded);
                    returnedRows = Math.min(returnedRows, decoded.length);
                }
                if (returnedRows === 0) {
                    break; // Defensive: the host returned a short/empty window.
                }

                const formatStarted = performance.now();
                for (let rowOffset = 0; rowOffset < returnedRows; rowOffset++) {
                    const sourceRow = start + rowOffset;
                    while (
                        rowBandIndex + 1 < plan.rowBands.length &&
                        plan.rowBands[rowBandIndex].toRow < sourceRow
                    ) {
                        rowBandIndex++;
                    }
                    const selectedColumns = plan.rowBands[rowBandIndex]?.columnRuns ?? [];
                    let selectedRunIndex = 0;
                    const fields: string[] = [];
                    let prospectiveCharacters = characters + (lineCount > 0 ? 1 : 0);
                    for (let runIndex = 0; runIndex < plan.columnRuns.length; runIndex++) {
                        const run = plan.columnRuns[runIndex];
                        const rowValues = fetchedRuns[runIndex]?.[rowOffset];
                        for (let column = run.from; column <= run.to; column++) {
                            while (
                                selectedRunIndex < selectedColumns.length &&
                                selectedColumns[selectedRunIndex].to < column
                            ) {
                                selectedRunIndex++;
                            }
                            const selected =
                                selectedRunIndex < selectedColumns.length &&
                                selectedColumns[selectedRunIndex].from <= column;
                            const value = selected ? (rowValues?.[column - run.from] ?? "") : "";
                            prospectiveCharacters += value.length + (fields.length > 0 ? 1 : 0);
                            if (prospectiveCharacters > COPY_MAX_TSV_CHARACTERS) {
                                formatMs += Math.max(0, performance.now() - formatStarted);
                                finish("tooLarge", { ...details, reason: "characters" });
                                return "tooLarge";
                            }
                            fields.push(value);
                        }
                    }
                    // The prospective check above makes this false only if a
                    // future separator-accounting change drifts.
                    if (!appendLine(fields.join("\t"))) {
                        formatMs += Math.max(0, performance.now() - formatStarted);
                        finish("tooLarge", { ...details, reason: "characters" });
                        return "tooLarge";
                    }
                }
                formatMs += Math.max(0, performance.now() - formatStarted);
                start += returnedRows;
            }
        }
        const finalFormatStarted = performance.now();
        const text = textSegments.join("");
        formatMs += Math.max(0, performance.now() - finalFormatStarted);
        const clipboardStarted = performance.now();
        try {
            await navigator.clipboard.writeText(text);
        } finally {
            clipboardMs += Math.max(0, performance.now() - clipboardStarted);
        }
        finish("copied", details);
        return "copied";
    } catch (error) {
        finish("error", details);
        throw error;
    }
}

function copyHeaders(summary: QsResultSetSummary, selection: readonly ISlickRange[]): void {
    const ranges =
        selection.length > 0
            ? selection
            : [{ fromCell: 0, toCell: summary.columnNames.length - 1, fromRow: 0, toRow: 0 }];
    // Union of selected columns, one header line (multi-range parity with
    // copy), planned without expanding duplicate/overlapping ranges.
    const text = copyHeaderLine(
        summary,
        queryStudioGridCopyColumnRuns(ranges, summary.columnNames.length),
    );
    void navigator.clipboard.writeText(text);
}

// ---------------------------------------------------------------------------
// Provider (strings / keybindings / theme / command surface)
// ---------------------------------------------------------------------------

function qsGridStrings(): FluentResultGridStrings {
    const command = (label: string) => ({ label, tooltip: label, ariaLabel: label });
    return {
        commands: {
            [FluentResultGridCommand.SelectAll]: command(locConstants.queryResult.selectAll),
            [FluentResultGridCommand.CopySelection]: command(locConstants.queryResult.copy),
            [FluentResultGridCommand.CopyWithHeaders]: command(
                locConstants.queryResult.copyWithHeaders,
            ),
            [FluentResultGridCommand.CopyHeaders]: command(locConstants.queryResult.copyHeaders),
            [FluentResultGridCommand.SaveAsCsv]: command(locConstants.queryResult.saveAsCSV),
            [FluentResultGridCommand.SaveAsJson]: command(locConstants.queryResult.saveAsJSON),
            [FluentResultGridCommand.SaveAsInsert]: command(
                locConstants.queryResult.saveAsInsert(""),
            ),
            [FluentResultGridCommand.SwitchToTextView]: command(
                locConstants.queryResult.toggleToTextView(""),
            ),
            [FluentResultGridCommand.ToggleSort]: command(locConstants.queryResult.sort),
            [FluentResultGridCommand.OpenFilter]: command(locConstants.queryResult.filter),
            [FluentResultGridCommand.OpenResizeDialog]: command(locConstants.queryResult.resize),
            [FluentResultGridCommand.FreezeColumn]: command(locConstants.slickGrid.freezeColumns),
            [FluentResultGridCommand.UnfreezeColumn]: command(
                locConstants.slickGrid.unfreezeColumns,
            ),
            [FluentResultGridCommand.ClearAllFilters]: command(
                locConstants.slickGrid.clearAllFilters,
            ),
            [FluentResultGridCommand.ClearSort]: command(locConstants.queryResult.clearSort),
            [FluentResultGridCommand.ShowAllColumns]: command(
                locConstants.slickGrid.showAllColumns,
            ),
        },
        menus: {
            copyAs: locConstants.queryResult.copyAs,
            moreActions: locConstants.queryResult.moreQueryActions,
            filterOptions: locConstants.queryResult.filterOptions,
        },
        filter: {
            nullValue: locConstants.queryResult.null,
            blankValue: locConstants.queryResult.blankString,
            search: locConstants.queryResult.search,
            apply: locConstants.queryResult.apply,
            clear: locConstants.queryResult.clear,
            close: locConstants.queryResult.close,
            noResultsToDisplay: locConstants.queryResult.noResultsToDisplay,
        },
        resizeDialog: {
            title: locConstants.queryResult.resizeColumn,
            widthLabel: locConstants.queryResult.enterDesiredColumnWidth,
            validationError: (minWidth) => locConstants.queryResult.resizeValidationError(minWidth),
            submit: locConstants.queryResult.resize,
            cancel: locConstants.common.cancel,
        },
        accessibility: {
            selectedCount: locConstants.queryResult.selectedCount,
            gridAriaLabel: locConstants.queryResult.resultSet,
            toolbarAriaLabel: locConstants.queryResult.moreQueryActions,
        },
    };
}

function qsGridKeyBindings(keyBindings: WebviewKeyBindings): FluentResultGridKeyBindingMap {
    const map = (command: string, action: WebviewAction) => [command, keyBindings[action]] as const;
    return Object.fromEntries([
        map(FluentResultGridCommand.SelectAll, WebviewAction.ResultGridSelectAll),
        map(FluentResultGridCommand.CopySelection, WebviewAction.ResultGridCopySelection),
        map(FluentResultGridCommand.CopyWithHeaders, WebviewAction.ResultGridCopyWithHeaders),
        map(FluentResultGridCommand.CopyHeaders, WebviewAction.ResultGridCopyAllHeaders),
        map(FluentResultGridCommand.SaveAsCsv, WebviewAction.QueryResultSaveAsCsv),
        map(FluentResultGridCommand.SaveAsJson, WebviewAction.QueryResultSaveAsJson),
        map(FluentResultGridCommand.SaveAsInsert, WebviewAction.QueryResultSaveAsInsert),
        map(FluentResultGridCommand.SwitchToTextView, WebviewAction.QueryResultSwitchToTextView),
        map(FluentResultGridCommand.ToggleSort, WebviewAction.ResultGridToggleSort),
        map(FluentResultGridCommand.OpenFilter, WebviewAction.ResultGridOpenFilterMenu),
        map(FluentResultGridCommand.OpenResizeDialog, WebviewAction.ResultGridChangeColumnWidth),
        map(
            FluentResultGridCommand.ExpandSelectionLeft,
            WebviewAction.ResultGridExpandSelectionLeft,
        ),
        map(
            FluentResultGridCommand.ExpandSelectionRight,
            WebviewAction.ResultGridExpandSelectionRight,
        ),
        map(FluentResultGridCommand.ExpandSelectionUp, WebviewAction.ResultGridExpandSelectionUp),
        map(
            FluentResultGridCommand.ExpandSelectionDown,
            WebviewAction.ResultGridExpandSelectionDown,
        ),
        map(FluentResultGridCommand.OpenColumnMenu, WebviewAction.ResultGridOpenColumnMenu),
        map(FluentResultGridCommand.MoveToRowStart, WebviewAction.ResultGridMoveToRowStart),
        map(FluentResultGridCommand.MoveToRowEnd, WebviewAction.ResultGridMoveToRowEnd),
        map(FluentResultGridCommand.SelectColumn, WebviewAction.ResultGridSelectColumn),
        map(FluentResultGridCommand.SelectRow, WebviewAction.ResultGridSelectRow),
    ]) as FluentResultGridKeyBindingMap;
}

/** Cell context menu: select all + the copy family (host-command surface). */
function qsGridCommands(): FluentResultGridCommandConfiguration {
    const placement = FluentResultGridCommandPlacement;
    return {
        contributions: [
            {
                id: FluentResultGridCommand.SelectAll,
                label: "",
                placements: [placement.CellContextMenu, placement.Keyboard],
                groupId: "selection",
                order: 100,
            },
            {
                id: FluentResultGridCommand.CopySelection,
                label: "",
                placements: [placement.CellContextMenu, placement.Keyboard],
                groupId: "clipboard",
                order: 200,
            },
            {
                id: FluentResultGridCommand.CopyWithHeaders,
                label: "",
                placements: [placement.CellContextMenu, placement.Keyboard],
                groupId: "clipboard",
                order: 210,
            },
            {
                id: FluentResultGridCommand.CopyHeaders,
                label: "",
                placements: [placement.CellContextMenu],
                groupId: "clipboard",
                order: 220,
            },
            {
                id: FluentResultGridCommand.SwitchToTextView,
                label: "",
                placements: [placement.Keyboard],
                groupId: "view",
                order: 100,
                isVisible: (context) => context.viewMode !== "text",
            },
            {
                id: FluentResultGridCommand.SaveAsCsv,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 300,
            },
            {
                id: FluentResultGridCommand.SaveAsJson,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 310,
            },
            {
                id: FluentResultGridCommand.SaveAsInsert,
                label: "",
                placements: [placement.Toolbar, placement.Keyboard],
                groupId: "export",
                order: 330,
            },
        ],
    };
}

function toFluentThemeKind(themeKind: ColorThemeKind): FluentResultGridTheme["kind"] {
    switch (themeKind) {
        case ColorThemeKind.Dark:
            return "dark";
        case ColorThemeKind.HighContrast:
            return "highContrast";
        case ColorThemeKind.HighContrastLight:
            return "highContrastLight";
        default:
            return "light";
    }
}

const vscodeOverlayRootProps = {
    "data-vscode-context": JSON.stringify({ preventDefaultContextMenuItems: true }),
};

/** Shared provider for every QS result grid (strings/keybindings/overlays). */
export function QsResultsGridProvider(props: { children: React.ReactNode }) {
    const { keyBindings, themeKind } = useVscodeWebview<QsState, void>();
    const strings = useMemo(() => qsGridStrings(), []);
    const providerKeyBindings = useMemo(() => qsGridKeyBindings(keyBindings), [keyBindings]);
    const defaultCommands = useMemo(() => qsGridCommands(), []);
    const theme = useMemo<FluentResultGridTheme>(
        () => ({ kind: toFluentThemeKind(themeKind) }),
        [themeKind],
    );
    return (
        <FluentResultGridProvider
            strings={strings}
            keyBindings={providerKeyBindings}
            theme={theme}
            overlayRootProps={vscodeOverlayRootProps}
            defaultCommands={defaultCommands}>
            {props.children}
        </FluentResultGridProvider>
    );
}

// ---------------------------------------------------------------------------
// The grid surface
// ---------------------------------------------------------------------------

export function QsResultGridSurface(props: {
    rpc: Rpc;
    summary: QsResultSetSummary;
    /** Effective row count (state summary vs. QsRowsAppended accumulation). */
    rowCount: number;
    gridStyle: QsGridStyle | undefined;
    /** Transient user-facing notice (copy guard / threshold gating). */
    notify: (text: string) => void;
    initialState?: FluentResultGridState;
    onStateChange?: (state: FluentResultGridState) => void;
}) {
    const { rpc, summary, rowCount, gridStyle, notify } = props;
    const shellRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<FluentResultGridHandle | null>(null);
    const perfSelectionSettledRef = useRef<(() => void) | undefined>(undefined);
    const rowCountRef = useRef(rowCount);
    rowCountRef.current = rowCount;
    const summaryRef = useRef(summary);
    summaryRef.current = summary;
    const columnCount = summary.columnNames.length;

    useEffect(
        () =>
            registerQueryStudioPerfGridController(summary.resultSetId, {
                scroll: (axis, target) => {
                    const itemCount = axis === "vertical" ? rowCountRef.current : columnCount;
                    if (itemCount <= 1) {
                        return "notScrollable";
                    }
                    const itemIndex = queryStudioPerfScrollOffset(itemCount, 1, target);
                    const applied =
                        axis === "vertical"
                            ? gridRef.current?.scrollToRow(itemIndex)
                            : gridRef.current?.scrollToColumn(itemIndex);
                    return applied ? "applied" : "viewportUnavailable";
                },
                selectAll: async () => {
                    perfSelectionSettledRef.current?.();
                    let settle!: () => void;
                    const settled = new Promise<void>((resolve) => {
                        settle = resolve;
                    });
                    perfSelectionSettledRef.current = settle;
                    if (!gridRef.current?.selectAll()) {
                        if (perfSelectionSettledRef.current === settle) {
                            perfSelectionSettledRef.current = undefined;
                        }
                        settle();
                        return "selectionUnavailable";
                    }
                    await settled;
                    return "applied";
                },
                copyAll: async (includeHeaders) => {
                    const currentSummary = {
                        ...summaryRef.current,
                        rowCount: rowCountRef.current,
                    };
                    if (currentSummary.rowCount <= 0 || columnCount <= 0) {
                        return "copyEmpty";
                    }
                    const outcome = await copySelectionAsTsv(
                        rpc,
                        currentSummary,
                        [
                            {
                                fromRow: 0,
                                toRow: currentSummary.rowCount - 1,
                                fromCell: 0,
                                toCell: columnCount - 1,
                            },
                        ],
                        includeHeaders,
                    );
                    return outcome === "copied"
                        ? "applied"
                        : outcome === "tooLarge"
                          ? "copyTooLarge"
                          : "copyEmpty";
                },
            }),
        [columnCount, rpc, summary.resultSetId],
    );

    // Column identity must stay STABLE across the coarse state pushes while
    // rows stream (each push rebuilds columnNames) — otherwise the grid
    // re-derives its column set on every push. Cache on the joined names.
    const columnsKey = JSON.stringify(summary.columns ?? summary.columnNames);
    const columnInfoRef = useRef<{ key: string; value: IDbColumn[] } | undefined>(undefined);
    if (columnInfoRef.current?.key !== columnsKey) {
        columnInfoRef.current = {
            key: columnsKey,
            value: fabricateColumnInfo(summary.columnNames, summary.columns),
        };
    }
    const columnInfo = columnInfoRef.current.value;

    const classicSummary = useMemo<ResultSetSummary>(
        () => ({
            id: resultSetOrdinal(summary.resultSetId),
            batchId: summary.batchOrdinal,
            rowCount,
            columnInfo,
        }),
        [summary.resultSetId, summary.batchOrdinal, rowCount, columnInfo],
    );

    // First REAL rows painted for this grid (QO-2): the user-perceived
    // "results are here" moment, tighter than the terminal resultsRendered.
    const firstRowsPaintedRef = useRef(false);
    const pendingRenderedWindowRef = useRef<
        { receivedAt: number; rows: number; columns: number; projected: boolean } | undefined
    >(undefined);

    const dataSource = useMemo(
        () => ({
            kind: "windowed" as const,
            rowCount,
            columnWindowing: GRID_COLUMN_WINDOWING,
            getRows: async (
                offset: number,
                count: number,
                columnWindow?: FluentResultGridColumnWindow,
            ) => {
                const perfEnabled = perfMarksEnabled();
                const requestedAt = perfEnabled ? performance.now() : 0;
                const requestedColumns = columnWindow?.count ?? columnCount;
                const projected = columnWindow !== undefined;
                if (perfEnabled) {
                    perfMark("mssql.queryStudio.grid.window.request", {
                        resultSetId: summary.resultSetId,
                        start: offset,
                        count,
                        columnStart: columnWindow?.start ?? 0,
                        columnCount: requestedColumns,
                        totalColumns: columnCount,
                        requestedCells: count * requestedColumns,
                        projected,
                    });
                }
                const window = await rpc.sendRequest<QsGetRowsParams, QsCellWindow>(
                    QsGetRowsRequest.type,
                    {
                        resultSetId: summary.resultSetId,
                        start: offset,
                        count,
                        ...(columnWindow
                            ? {
                                  columnStart: columnWindow.start,
                                  columnCount: columnWindow.count,
                              }
                            : {}),
                    },
                );
                if (perfEnabled) {
                    perfMark("mssql.queryStudio.grid.window.received", {
                        resultSetId: summary.resultSetId,
                        start: offset,
                        count,
                        columnStart: columnWindow?.start ?? 0,
                        columnCount: requestedColumns,
                        totalColumns: columnCount,
                        returnedRows: window.rowCount,
                        returnedColumns: window.columns.length,
                        returnedCells: window.rowCount * window.columns.length,
                        projected,
                        ms: Math.round((performance.now() - requestedAt) * 100) / 100,
                    });
                    pendingRenderedWindowRef.current = {
                        receivedAt: performance.now(),
                        rows: window.rowCount,
                        columns: window.columns.length,
                        projected,
                    };
                }
                return queryStudioWindowToGridRows(window, columnCount, columnWindow?.start ?? 0);
            },
        }),
        [rpc, summary.resultSetId, columnCount, rowCount],
    );

    const handleGridCreated = useCallback(() => {
        perfMark("mssql.queryStudio.grid.instance.created", {
            resultSetId: summary.resultSetId,
            rows: rowCount,
            columns: columnCount,
        });
    }, [columnCount, rowCount, summary.resultSetId]);
    const handleGridDisposed = useCallback(() => {
        perfMark("mssql.queryStudio.grid.instance.disposed", {
            resultSetId: summary.resultSetId,
        });
    }, [summary.resultSetId]);
    const handleGridRendered = useCallback(() => {
        const pending = pendingRenderedWindowRef.current;
        if (!pending) {
            return;
        }
        pendingRenderedWindowRef.current = undefined;
        perfMark("mssql.queryStudio.grid.render.complete", {
            resultSetId: summary.resultSetId,
            rows: pending.rows,
            columns: columnCount,
            fetchedColumns: pending.columns,
            projected: pending.projected,
            msFromWindowReceived: Math.round((performance.now() - pending.receivedAt) * 100) / 100,
        });
        if (!firstRowsPaintedRef.current && pending.rows > 0) {
            firstRowsPaintedRef.current = true;
            perfMarkAfterNextPaint("mssql.queryStudio.grid.firstVisibleRowsPainted", {
                resultSetId: summary.resultSetId,
                rows: pending.rows,
                columns: columnCount,
                fetchedColumns: pending.columns,
                projected: pending.projected,
            });
        }
    }, [columnCount, summary.resultSetId]);

    const gridSettings = useMemo<GridSettings>(
        () => ({
            alternatingRowColors: gridStyle?.alternatingRowColors ?? false,
            showGridLines: gridStyle?.showGridLines ?? "both",
            rowPadding: gridStyle?.rowPadding ?? 0,
        }),
        [gridStyle],
    );

    // Sort/filter engage only over COMPLETE sets ≤ the in-memory threshold —
    // threshold 0 while streaming routes every attempt to the notice below.
    const inMemoryThreshold = summary.complete
        ? (gridStyle?.inMemoryDataProcessingThreshold ?? 5000)
        : 0;
    const handleThresholdExceeded = useCallback(() => {
        notify(summary.complete ? PROCESSING_DISABLED_NOTICE : PROCESSING_STREAMING_NOTICE);
    }, [notify, summary.complete]);

    // Active-result context (C2D-4): selection SHAPE rides to the host,
    // throttled (trailing edge) so drag-selects do not flood the RPC channel.
    // Values never leave the grid on this path.
    const selectionUpdateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const handleSelectionSummaryChange = useCallback(
        (selection: readonly ISlickRange[]) => {
            if (selectionUpdateTimer.current) {
                clearTimeout(selectionUpdateTimer.current);
            }
            selectionUpdateTimer.current = setTimeout(() => {
                const capped = selection.slice(0, 64);
                let cells = 0;
                for (const range of selection) {
                    cells +=
                        (range.toRow - range.fromRow + 1) * (range.toCell - range.fromCell + 1);
                }
                const request = rpc.sendRequest(QsUpdateGridSelectionRequest.type, {
                    resultSetId: summary.resultSetId,
                    ranges: capped.map((range) => ({
                        fromRow: range.fromRow,
                        toRow: range.toRow,
                        fromCell: range.fromCell,
                        toCell: range.toCell,
                    })),
                    selectedCellCount: cells,
                    selectedRowCount: countFluentResultGridSelectedRows(selection),
                    displayedRowCount: rowCount,
                    reason: "selection",
                });
                const settle = perfSelectionSettledRef.current;
                if (settle) {
                    void request.then(
                        () => {
                            if (perfSelectionSettledRef.current === settle) {
                                perfSelectionSettledRef.current = undefined;
                            }
                            settle();
                        },
                        () => {
                            if (perfSelectionSettledRef.current === settle) {
                                perfSelectionSettledRef.current = undefined;
                            }
                            settle();
                        },
                    );
                } else {
                    void request;
                }
            }, 200);
        },
        [rpc, summary.resultSetId, rowCount],
    );
    useEffect(
        () => () => {
            if (selectionUpdateTimer.current) {
                clearTimeout(selectionUpdateTimer.current);
            }
            perfSelectionSettledRef.current?.();
            perfSelectionSettledRef.current = undefined;
        },
        [],
    );

    const handleCommand = useCallback(
        async (event: FluentResultGridCommandEvent) => {
            const selection = event.selection ?? [];
            switch (event.commandId) {
                case FluentResultGridCommand.CopySelection:
                case FluentResultGridCommand.CopyWithHeaders: {
                    const outcome = await copySelectionAsTsv(
                        rpc,
                        summary,
                        selection,
                        event.commandId === FluentResultGridCommand.CopyWithHeaders,
                    );
                    if (outcome === "tooLarge") {
                        notify(COPY_TOO_LARGE_NOTICE);
                    }
                    break;
                }
                case FluentResultGridCommand.CopyHeaders:
                    copyHeaders(summary, selection);
                    break;
                case FluentResultGridCommand.SaveAsCsv:
                case FluentResultGridCommand.SaveAsJson:
                case FluentResultGridCommand.SaveAsInsert:
                    void rpc.sendRequest(QsSaveResultRequest.type, {
                        resultSetId: summary.resultSetId,
                        format:
                            event.commandId === FluentResultGridCommand.SaveAsJson
                                ? "json"
                                : event.commandId === FluentResultGridCommand.SaveAsInsert
                                  ? "insert"
                                  : "csv",
                        ...(selection.length > 0 ? { selection: [...selection] } : {}),
                    });
                    break;
                case FluentResultGridCommand.SwitchToTextView:
                    void rpc.sendRequest(QsSetViewModeRequest.type, { viewMode: "text" });
                    break;
                case FluentResultGridCommand.OpenCell:
                    // XML/JSON cells (content-sniffed by the grid) open in a
                    // side document via the host — the cell's rowId carries
                    // the SOURCE row through sort/filter reorders.
                    if (event.cell) {
                        void rpc.sendRequest(QsOpenCellDocumentRequest.type, {
                            resultSetId: summary.resultSetId,
                            row: event.cell.value.rowId ?? event.cell.rowIndex,
                            column: event.cell.columnIndex,
                            format: event.cell.languageId === "xml" ? "xml" : "json",
                        });
                    }
                    break;
                default:
                    break;
            }
        },
        [rpc, summary, notify],
    );

    const style = useMemo(
        () => ({
            // SSMS-density default: the grid uses the proportional UI font —
            // monospace (editor font) renders the same text nearly 2× wider.
            // mssql.resultsFontFamily overrides for users who want monospace.
            fontFamily: gridStyle?.fontFamily || "var(--vscode-font-family)",
            fontSize: `${gridStyle?.fontSize ?? DEFAULT_FONT_SIZE}px`,
        }),
        [gridStyle],
    );

    // Effective fetch window (QO-7): fixed = gridWindowRows; adaptive derives
    // from the surface height (viewport rows × prefetch factor per direction),
    // clamped to [gridWindowRows, gridMaxWindowRows]. Computed once per mount
    // — result-set identity remounts the surface.
    const windowSize = useMemo(() => {
        const baseRows = gridStyle?.gridWindowRows ?? 50;
        if (gridStyle?.gridWindowMode !== "adaptive") {
            return baseRows;
        }
        const paneHeight = shellRef.current?.clientHeight || window.innerHeight;
        const visibleRows = Math.max(1, Math.ceil(paneHeight / qsGridRowHeight(gridStyle)));
        const prefetch = Math.max(1, gridStyle.gridPrefetchFactor ?? 2);
        const maxRows = gridStyle.gridMaxWindowRows ?? 1000;
        return Math.min(maxRows, Math.max(baseRows, visibleRows * (1 + prefetch)));
        // shellRef height is deliberately sampled once per identity, not reactive.
    }, [
        gridStyle?.gridWindowMode,
        gridStyle?.gridWindowRows,
        gridStyle?.gridPrefetchFactor,
        gridStyle?.gridMaxWindowRows,
    ]);

    const stopSelectionDragClass = useCallback(() => {
        shellRef.current?.classList.remove("qs-grid-selecting");
    }, []);

    // This is a mount-time restore snapshot. Feeding later persisted
    // callbacks back through `initialState` would make unrelated shell
    // renders reapply selection/scroll while the user is interacting.
    const initialGridStateRef = useRef(props.initialState);
    const restoredGridState = useMemo<FluentResultGridState>(
        () => ({
            ...QUERY_STUDIO_GRID_INITIAL_STATE,
            ...(initialGridStateRef.current ?? {}),
        }),
        [],
    );
    const handlePointerDownCapture = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (!(event.target instanceof Element) || !event.target.closest(".slick-cell")) {
                return;
            }
            shellRef.current?.classList.add("qs-grid-selecting");
            window.addEventListener("pointerup", stopSelectionDragClass, { once: true });
            window.addEventListener("pointercancel", stopSelectionDragClass, { once: true });
            window.addEventListener("blur", stopSelectionDragClass, { once: true });
        },
        [stopSelectionDragClass],
    );

    return (
        <div
            ref={shellRef}
            className="qs-grid-surface"
            onPointerDownCapture={handlePointerDownCapture}>
            <FluentResultGrid
                ref={gridRef}
                gridId={summary.resultSetId}
                resultSetSummary={classicSummary}
                dataSource={dataSource}
                heightMode={{ kind: "fill" }}
                showRowNumberColumn
                initialState={restoredGridState}
                enableColumnReorder={false}
                inMemoryDataProcessingThreshold={inMemoryThreshold}
                gridSettings={gridSettings}
                rowHeight={qsGridRowHeight(gridStyle)}
                windowSize={windowSize}
                autosizeSampleRows={gridStyle?.autosizeSampleRows}
                autosizeMaxColumnWidth={gridStyle?.gridMaxColumnWidthPx}
                style={style}
                toolbar={{ visible: true }}
                viewMode="grid"
                canToggleViewMode
                onCommand={handleCommand}
                onGridCreated={handleGridCreated}
                onGridDisposed={handleGridDisposed}
                onGridRendered={handleGridRendered}
                onStateChange={props.onStateChange}
                onSelectionSummaryChange={handleSelectionSummaryChange}
                onInMemoryDataProcessingThresholdExceeded={handleThresholdExceeded}
            />
        </div>
    );
}
