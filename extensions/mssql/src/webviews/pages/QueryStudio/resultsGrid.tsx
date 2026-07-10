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

import { useCallback, useMemo, useRef, type PointerEvent } from "react";
import {
    FluentResultGrid,
    FluentResultGridCommand,
    FluentResultGridCommandPlacement,
    FluentResultGridProvider,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandEvent,
    type FluentResultGridKeyBindingMap,
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
    DbCellValue,
    GridSettings,
    IDbColumn,
    ISlickRange,
    ResultSetSummary,
} from "../../../sharedInterfaces/queryResult";
import {
    QsCellWindow,
    QsGetRowsRequest,
    QsGridStyle,
    QsOpenCellDocumentRequest,
    QsResultColumn,
    QsSaveResultRequest,
    QsSetViewModeRequest,
    QsResultSetSummary,
    QsState,
} from "../../../sharedInterfaces/queryStudio";
import {
    QS_CELL_DISPLAY_CLAMP,
    cellDocumentLanguage,
    cellDisplayText,
    clampDisplay,
} from "../../../sharedInterfaces/queryStudioGridOps";
import { perfMark, perfMarkAfterNextPaint, perfMarksEnabled } from "../../common/perfMarks";

export interface Rpc {
    sendRequest<P, R>(type: { method: string }, params: P): Promise<R>;
}

/** Chunk size for copy fetches (same bounded window scale as materialize). */
const COPY_CHUNK = 512;
/** Copy guard: refuse silently-unbounded clipboard payloads. */
const COPY_MAX_ROWS = 100_000;
const DEFAULT_FONT_SIZE = 12;
// Compact vertical chrome around the text (SSMS-like density). Users who
// want airier rows raise mssql.resultsGrid.rowPadding.
const BASE_ROW_PADDING = 6;

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

/** Grid row height: fontSize + compact base chrome + 2·padding. */
export function qsGridRowHeight(gridStyle: QsGridStyle | undefined): number {
    const padding = Math.max(0, gridStyle?.rowPadding ?? 0);
    return (gridStyle?.fontSize ?? DEFAULT_FONT_SIZE) + BASE_ROW_PADDING + padding * 2;
}

/** Decode one window's null bitmap into per-cell null flags. */
function windowNullFlags(window: QsCellWindow): (row: number, col: number) => boolean {
    const bytes = window.nullBitmap ? atob(window.nullBitmap) : undefined;
    const colCount = window.columns.length;
    return (row, col) => {
        const value = window.values[row]?.[col];
        if (value === undefined || value === null) {
            return true;
        }
        if (!bytes) {
            return false;
        }
        const index = row * colCount + col;
        const byteIndex = index >> 3;
        return byteIndex < bytes.length && (bytes.charCodeAt(byteIndex) & (1 << (index & 7))) !== 0;
    };
}

/**
 * QsCellWindow → grid rows (DbCellValue with the SOURCE row id). Rendered
 * windows clamp display text (huge cells would bog the DOM); the copy path
 * passes clamp=false so the clipboard carries the full received value.
 */
function windowToGridRows(
    window: QsCellWindow,
    columnCount: number,
    clamp: boolean = true,
): DbCellValue[][] {
    const isNull = windowNullFlags(window);
    return window.values.map((row, r) => {
        const cells: DbCellValue[] = [];
        for (let c = 0; c < columnCount; c++) {
            const nulled = isNull(r, c);
            const text = nulled ? "" : cellDisplayText(row[c]);
            const languageId = nulled
                ? undefined
                : cellDocumentLanguage(row[c], {
                      sqlType: window.columns[c]?.sqlType,
                      typeHint: window.typeHints?.[c],
                      isXml: window.columns[c]?.isXml,
                      isJson: window.columns[c]?.isJson,
                  });
            cells.push({
                displayValue: clamp ? clampDisplay(text, QS_CELL_DISPLAY_CLAMP) : text,
                isNull: nulled,
                rowId: window.start + r,
                ...(languageId ? { languageId } : {}),
            });
        }
        return cells;
    });
}

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

async function fetchDecodedRows(
    rpc: Rpc,
    resultSetId: string,
    fromRow: number,
    toRow: number,
    columns: { start: number; count: number },
): Promise<DbCellValue[][]> {
    const rows: DbCellValue[][] = [];
    for (let start = fromRow; start <= toRow; start += COPY_CHUNK) {
        const count = Math.min(COPY_CHUNK, toRow - start + 1);
        // Projected fetch (QO-7b): only the selection's columns cross the
        // RPC — copying 3 columns of a 300-column grid no longer drags the
        // other 297 through serialization.
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
        const decoded = windowToGridRows(window, columns.count, /* clamp */ false);
        rows.push(...decoded);
        if (decoded.length === 0) {
            break; // defensive: host returned short
        }
    }
    return rows;
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
    if (selection.length === 0) {
        return "empty";
    }
    if (selection.length === 1) {
        const range = selection[0];
        if (range.toRow - range.fromRow + 1 > COPY_MAX_ROWS) {
            return "tooLarge";
        }
        const lines: string[] = [];
        if (includeHeaders) {
            lines.push(summary.columnNames.slice(range.fromCell, range.toCell + 1).join("\t"));
        }
        // The window arrives already projected to the selection's columns.
        const rows = await fetchDecodedRows(rpc, summary.resultSetId, range.fromRow, range.toRow, {
            start: range.fromCell,
            count: range.toCell - range.fromCell + 1,
        });
        for (const row of rows) {
            lines.push(row.map((cell) => (cell.isNull ? "NULL" : cell.displayValue)).join("\t"));
        }
        await navigator.clipboard.writeText(lines.join("\n"));
        return "copied";
    }

    const rowSet = new Set<number>();
    const colSet = new Set<number>();
    for (const range of selection) {
        for (let row = range.fromRow; row <= range.toRow; row++) {
            rowSet.add(row);
        }
        for (let col = range.fromCell; col <= range.toCell; col++) {
            colSet.add(col);
        }
    }
    if (rowSet.size > COPY_MAX_ROWS) {
        return "tooLarge";
    }
    const unionRows = [...rowSet].sort((a, b) => a - b);
    const unionCols = [...colSet].sort((a, b) => a - b);
    const isSelected = (row: number, col: number) =>
        selection.some(
            (range) =>
                row >= range.fromRow &&
                row <= range.toRow &&
                col >= range.fromCell &&
                col <= range.toCell,
        );

    // One projected fetch per contiguous row run over the union column span.
    const colStart = unionCols[0];
    const colCount = unionCols[unionCols.length - 1] - colStart + 1;
    const valuesByRow = new Map<number, DbCellValue[]>();
    let runStart = 0;
    while (runStart < unionRows.length) {
        let runEnd = runStart;
        while (runEnd + 1 < unionRows.length && unionRows[runEnd + 1] === unionRows[runEnd] + 1) {
            runEnd++;
        }
        const fetched = await fetchDecodedRows(
            rpc,
            summary.resultSetId,
            unionRows[runStart],
            unionRows[runEnd],
            { start: colStart, count: colCount },
        );
        fetched.forEach((rowValues, i) => valuesByRow.set(unionRows[runStart] + i, rowValues));
        runStart = runEnd + 1;
    }

    const lines: string[] = [];
    if (includeHeaders) {
        lines.push(unionCols.map((col) => summary.columnNames[col] ?? "").join("\t"));
    }
    for (const row of unionRows) {
        const rowValues = valuesByRow.get(row);
        lines.push(
            unionCols
                .map((col) => {
                    if (!isSelected(row, col)) {
                        return "";
                    }
                    const cell = rowValues?.[col - colStart];
                    return cell ? (cell.isNull ? "NULL" : cell.displayValue) : "";
                })
                .join("\t"),
        );
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    return "copied";
}

function copyHeaders(summary: QsResultSetSummary, selection: readonly ISlickRange[]): void {
    const ranges =
        selection.length > 0
            ? selection
            : [{ fromCell: 0, toCell: summary.columnNames.length - 1, fromRow: 0, toRow: 0 }];
    // Union of selected columns, one header line (multi-range parity with copy).
    const cols = new Set<number>();
    for (const range of ranges) {
        for (let col = range.fromCell; col <= range.toCell; col++) {
            cols.add(col);
        }
    }
    const text = [...cols]
        .sort((a, b) => a - b)
        .map((col) => summary.columnNames[col] ?? "")
        .join("\t");
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
}) {
    const { rpc, summary, rowCount, gridStyle, notify } = props;
    const shellRef = useRef<HTMLDivElement | null>(null);
    const columnCount = summary.columnNames.length;

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

    const dataSource = useMemo(
        () => ({
            kind: "windowed" as const,
            rowCount,
            getRows: async (offset: number, count: number) => {
                const perfEnabled = perfMarksEnabled();
                const requestedAt = perfEnabled ? performance.now() : 0;
                if (perfEnabled) {
                    perfMark("mssql.queryStudio.grid.window.request", {
                        resultSetId: summary.resultSetId,
                        start: offset,
                        count,
                    });
                }
                const window = await rpc.sendRequest<
                    { resultSetId: string; start: number; count: number },
                    QsCellWindow
                >(QsGetRowsRequest.type, {
                    resultSetId: summary.resultSetId,
                    start: offset,
                    count,
                });
                if (perfEnabled) {
                    perfMark("mssql.queryStudio.grid.window.received", {
                        resultSetId: summary.resultSetId,
                        start: offset,
                        count,
                        ms: Math.round((performance.now() - requestedAt) * 100) / 100,
                    });
                    if (!firstRowsPaintedRef.current && window.rowCount > 0) {
                        firstRowsPaintedRef.current = true;
                        perfMarkAfterNextPaint("mssql.queryStudio.grid.firstVisibleRowsPainted", {
                            resultSetId: summary.resultSetId,
                            rows: window.rowCount,
                            columns: columnCount,
                        });
                    }
                }
                return windowToGridRows(window, columnCount);
            },
        }),
        [rpc, summary.resultSetId, columnCount, rowCount],
    );

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
                gridId={summary.resultSetId}
                resultSetSummary={classicSummary}
                dataSource={dataSource}
                heightMode={{ kind: "fill" }}
                showRowNumberColumn
                initialState={QUERY_STUDIO_GRID_INITIAL_STATE}
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
                onInMemoryDataProcessingThresholdExceeded={handleThresholdExceeded}
            />
        </div>
    );
}
