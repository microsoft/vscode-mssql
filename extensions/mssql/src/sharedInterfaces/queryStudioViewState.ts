/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio's panel-local view state. This state belongs to one webview
 * controller, never to the shared document model: split editors can have
 * different tabs, selections, and scroll positions over the same result run.
 *
 * The controller keeps this object in memory so a recreated webview can
 * restore its UI without writing result-derived filters or selections to
 * workspace storage. It must never be added to diagnostics, replay, or
 * telemetry payloads.
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";
import { SortProperties, type ColumnFilterMap, type GridViewState } from "./queryResult";

export const QS_PANEL_VIEW_STATE_VERSION = 1;

export type QueryStudioTabId = "results" | "messages" | "vector" | "queryPlan";

/** Results is the only tab allowed before Messages; contributed tabs follow it. */
export const QUERY_STUDIO_TAB_ORDER: readonly QueryStudioTabId[] = [
    "results",
    "messages",
    "vector",
    "queryPlan",
];

export interface QsGridPanelViewState extends GridViewState {
    columnWidths?: number[];
    filters?: ColumnFilterMap;
    sort?: { columnId: string; direction: SortProperties };
    scrollPosition?: { scrollTop: number; scrollLeft: number };
}

export interface QsResultsTextViewState {
    selection: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
    scrollTop: number;
    scrollLeft: number;
}

export interface QsMessageSelectionPoint {
    /** Absolute index in the run's message array. */
    messageIndex: number;
    /** UTF-16 character offset within the formatted message row. */
    offset: number;
}

export interface QsMessageSelection {
    anchor: QsMessageSelectionPoint;
    focus: QsMessageSelectionPoint;
}

export interface QsMessagesPanelViewState {
    scrollTop: number;
    selection?: QsMessageSelection;
}

export type QsVectorWorkspaceId =
    | "profile"
    | "search"
    | "compare"
    | "projection"
    | "index"
    | "pipeline";

export interface QsVectorPanelViewState {
    workspace: QsVectorWorkspaceId;
    selectedColumn?: { resultSetId: string; columnOrdinal: number };
    profileNorm: "l2" | "l1" | "linf";
    workspaceScrollTop: Partial<Record<QsVectorWorkspaceId, number>>;
}

export interface QsExecutionPlanGraphViewState {
    zoomPercent: number;
    scrollTop: number;
    scrollLeft: number;
    selectedElementId?: string;
    propertiesPaneOpen: boolean;
    propertiesPaneWidth: number;
}

export interface QsExecutionPlanViewState {
    pageScrollTop: number;
    graphs: Record<string, QsExecutionPlanGraphViewState>;
}

export interface QueryStudioPanelViewState {
    version: typeof QS_PANEL_VIEW_STATE_VERSION;
    /** Run start epoch as a string, or "idle" before the first run. */
    generation: string;
    shell: {
        activeTab: QueryStudioTabId;
        resultsHeightPct: number;
        resultsCollapsed: boolean;
        resultsPaneMaximized: boolean;
        maximizedGridId?: string;
    };
    results: {
        stackScrollTop: number;
        grids: Record<string, QsGridPanelViewState>;
        textView?: QsResultsTextViewState;
    };
    messages: QsMessagesPanelViewState;
    vector: QsVectorPanelViewState;
    queryPlan: QsExecutionPlanViewState;
}

export function createQueryStudioPanelViewState(generation: string): QueryStudioPanelViewState {
    return {
        version: QS_PANEL_VIEW_STATE_VERSION,
        generation,
        shell: {
            activeTab: "results",
            resultsHeightPct: 50,
            resultsCollapsed: false,
            resultsPaneMaximized: false,
        },
        results: { stackScrollTop: 0, grids: {} },
        messages: { scrollTop: 0 },
        vector: { workspace: "profile", profileNorm: "l2", workspaceScrollTop: {} },
        queryPlan: { pageScrollTop: 0, graphs: {} },
    };
}

/** Clear result-bound state for a new run while retaining panel preferences. */
export function resetQueryStudioPanelViewState(
    previous: QueryStudioPanelViewState,
    generation: string,
): QueryStudioPanelViewState {
    const next = createQueryStudioPanelViewState(generation);
    next.shell.resultsHeightPct = previous.shell.resultsHeightPct;
    next.shell.resultsPaneMaximized = previous.shell.resultsPaneMaximized;
    next.vector.workspace = previous.vector.workspace;
    next.vector.profileNorm = previous.vector.profileNorm;
    return next;
}

export function isQueryStudioPanelViewState(value: unknown): value is QueryStudioPanelViewState {
    return normalizeQueryStudioPanelViewState(value) !== undefined;
}

const MAX_SERIALIZED_STATE_LENGTH = 1_000_000;
const MAX_RESULT_SETS = 256;
const MAX_COLUMNS = 4_096;
const MAX_SELECTION_RANGES = 1_024;
const MAX_FILTER_VALUES = 10_000;
const MAX_PLAN_GRAPHS = 256;
const MAX_SHORT_STRING_LENGTH = 4_096;
const MAX_FILTER_STRING_LENGTH = 65_536;

/**
 * Validate and detach renderer-owned panel state before the extension host
 * retains it. The payload can contain result-derived filter strings, so it is
 * bounded in memory and never logged, persisted, replayed, or telemetered.
 */
export function normalizeQueryStudioPanelViewState(
    value: unknown,
    expectedGeneration?: string,
): QueryStudioPanelViewState | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    let serialized: string;
    try {
        serialized = JSON.stringify(value);
    } catch {
        return undefined;
    }
    if (serialized.length > MAX_SERIALIZED_STATE_LENGTH) {
        return undefined;
    }

    const candidate = value as unknown as QueryStudioPanelViewState;
    if (
        candidate.version !== QS_PANEL_VIEW_STATE_VERSION ||
        !isBoundedString(candidate.generation) ||
        (expectedGeneration !== undefined && candidate.generation !== expectedGeneration) ||
        !isShellState(candidate.shell) ||
        !isResultsState(candidate.results) ||
        !isMessagesState(candidate.messages) ||
        !isVectorState(candidate.vector) ||
        !isExecutionPlanState(candidate.queryPlan)
    ) {
        return undefined;
    }
    return JSON.parse(serialized) as QueryStudioPanelViewState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength = MAX_SHORT_STRING_LENGTH): value is string {
    return typeof value === "string" && value.length <= maxLength;
}

function isFiniteNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
    const allowedKeys = new Set(allowed);
    return Object.keys(record).every((key) => allowedKeys.has(key));
}

function isShellState(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    return (
        hasOnlyKeys(value, [
            "activeTab",
            "resultsHeightPct",
            "resultsCollapsed",
            "resultsPaneMaximized",
            "maximizedGridId",
        ]) &&
        QUERY_STUDIO_TAB_ORDER.includes(value.activeTab as QueryStudioTabId) &&
        isFiniteNumber(value.resultsHeightPct, 0, 100) &&
        typeof value.resultsCollapsed === "boolean" &&
        typeof value.resultsPaneMaximized === "boolean" &&
        (value.maximizedGridId === undefined || isBoundedString(value.maximizedGridId))
    );
}

function isResultsState(value: unknown): boolean {
    if (!isRecord(value) || !isFiniteNumber(value.stackScrollTop) || !isRecord(value.grids)) {
        return false;
    }
    const grids = Object.entries(value.grids);
    return (
        hasOnlyKeys(value, ["stackScrollTop", "grids", "textView"]) &&
        grids.length <= MAX_RESULT_SETS &&
        grids.every(([resultSetId, state]) => isBoundedString(resultSetId) && isGridState(state)) &&
        (value.textView === undefined || isResultsTextViewState(value.textView))
    );
}

function isResultsTextViewState(value: unknown): boolean {
    if (!isRecord(value) || !isRecord(value.selection)) {
        return false;
    }
    return (
        hasOnlyKeys(value, ["selection", "scrollTop", "scrollLeft"]) &&
        hasOnlyKeys(value.selection, [
            "startLineNumber",
            "startColumn",
            "endLineNumber",
            "endColumn",
        ]) &&
        [
            value.selection.startLineNumber,
            value.selection.startColumn,
            value.selection.endLineNumber,
            value.selection.endColumn,
        ].every((part) => Number.isInteger(part) && isFiniteNumber(part, 1)) &&
        isFiniteNumber(value.scrollTop) &&
        isFiniteNumber(value.scrollLeft)
    );
}

function isGridState(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    if (
        !hasOnlyKeys(value, [
            "hiddenColumnIds",
            "frozenColumnIndex",
            "selection",
            "columnWidths",
            "filters",
            "sort",
            "scrollPosition",
        ]) ||
        (value.hiddenColumnIds !== undefined &&
            (!Array.isArray(value.hiddenColumnIds) ||
                value.hiddenColumnIds.length > MAX_COLUMNS ||
                !value.hiddenColumnIds.every((id) => isBoundedString(id)))) ||
        (value.frozenColumnIndex !== undefined &&
            (!Number.isInteger(value.frozenColumnIndex) ||
                !isFiniteNumber(value.frozenColumnIndex, -1, MAX_COLUMNS))) ||
        (value.columnWidths !== undefined &&
            (!Array.isArray(value.columnWidths) ||
                value.columnWidths.length > MAX_COLUMNS ||
                !value.columnWidths.every((width) => isFiniteNumber(width, 0, 100_000)))) ||
        (value.selection !== undefined &&
            (!Array.isArray(value.selection) ||
                value.selection.length > MAX_SELECTION_RANGES ||
                !value.selection.every(isSelectionRange))) ||
        (value.filters !== undefined && !isFilters(value.filters)) ||
        (value.sort !== undefined && !isSort(value.sort)) ||
        (value.scrollPosition !== undefined && !isScrollPosition(value.scrollPosition))
    ) {
        return false;
    }
    return true;
}

function isSelectionRange(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    return (
        hasOnlyKeys(value, ["fromRow", "toRow", "fromCell", "toCell"]) &&
        [value.fromRow, value.toRow, value.fromCell, value.toCell].every(
            (part) => Number.isInteger(part) && isFiniteNumber(part, 0),
        )
    );
}

function isFilters(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const filters = Object.entries(value);
    return (
        filters.length <= MAX_COLUMNS &&
        filters.every(([columnId, filter]) => {
            if (!isBoundedString(columnId) || !isRecord(filter)) {
                return false;
            }
            return (
                hasOnlyKeys(filter, ["filterValues", "sorted", "seachText", "columnDef"]) &&
                Array.isArray(filter.filterValues) &&
                filter.filterValues.length <= MAX_FILTER_VALUES &&
                filter.filterValues.every(
                    (entry) => entry === null || isBoundedString(entry, MAX_FILTER_STRING_LENGTH),
                ) &&
                (filter.sorted === undefined || isSortDirection(filter.sorted)) &&
                (filter.seachText === undefined ||
                    isBoundedString(filter.seachText, MAX_FILTER_STRING_LENGTH)) &&
                isBoundedString(filter.columnDef, MAX_FILTER_STRING_LENGTH)
            );
        })
    );
}

function isSort(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ["columnId", "direction"]) &&
        isBoundedString(value.columnId) &&
        isSortDirection(value.direction)
    );
}

function isSortDirection(value: unknown): boolean {
    return (
        value === SortProperties.ASC ||
        value === SortProperties.DESC ||
        value === SortProperties.NONE
    );
}

function isScrollPosition(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ["scrollTop", "scrollLeft"]) &&
        isFiniteNumber(value.scrollTop) &&
        isFiniteNumber(value.scrollLeft)
    );
}

function isMessagePoint(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ["messageIndex", "offset"]) &&
        Number.isInteger(value.messageIndex) &&
        isFiniteNumber(value.messageIndex) &&
        Number.isInteger(value.offset) &&
        isFiniteNumber(value.offset)
    );
}

function isMessagesState(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ["scrollTop", "selection"]) &&
        isFiniteNumber(value.scrollTop) &&
        (value.selection === undefined ||
            (isRecord(value.selection) &&
                hasOnlyKeys(value.selection, ["anchor", "focus"]) &&
                isMessagePoint(value.selection.anchor) &&
                isMessagePoint(value.selection.focus)))
    );
}

function isVectorState(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const workspace = value.workspace as QsVectorWorkspaceId;
    const scroll = value.workspaceScrollTop;
    return (
        hasOnlyKeys(value, ["workspace", "selectedColumn", "profileNorm", "workspaceScrollTop"]) &&
        ["profile", "search", "compare", "projection", "index", "pipeline"].includes(workspace) &&
        ["l2", "l1", "linf"].includes(value.profileNorm as string) &&
        (value.selectedColumn === undefined ||
            (isRecord(value.selectedColumn) &&
                hasOnlyKeys(value.selectedColumn, ["resultSetId", "columnOrdinal"]) &&
                isBoundedString(value.selectedColumn.resultSetId) &&
                Number.isInteger(value.selectedColumn.columnOrdinal) &&
                isFiniteNumber(value.selectedColumn.columnOrdinal, 0, MAX_COLUMNS))) &&
        isRecord(scroll) &&
        Object.entries(scroll).every(
            ([key, offset]) =>
                ["profile", "search", "compare", "projection", "index", "pipeline"].includes(key) &&
                isFiniteNumber(offset),
        )
    );
}

function isExecutionPlanState(value: unknown): boolean {
    if (!isRecord(value) || !isFiniteNumber(value.pageScrollTop) || !isRecord(value.graphs)) {
        return false;
    }
    const graphs = Object.entries(value.graphs);
    return (
        hasOnlyKeys(value, ["pageScrollTop", "graphs"]) &&
        graphs.length <= MAX_PLAN_GRAPHS &&
        graphs.every(([key, graph]) => isBoundedString(key) && isExecutionPlanGraphState(graph))
    );
}

function isExecutionPlanGraphState(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, [
            "zoomPercent",
            "scrollTop",
            "scrollLeft",
            "selectedElementId",
            "propertiesPaneOpen",
            "propertiesPaneWidth",
        ]) &&
        isFiniteNumber(value.zoomPercent, 1, 200) &&
        isFiniteNumber(value.scrollTop) &&
        isFiniteNumber(value.scrollLeft) &&
        (value.selectedElementId === undefined || isBoundedString(value.selectedElementId)) &&
        typeof value.propertiesPaneOpen === "boolean" &&
        isFiniteNumber(value.propertiesPaneWidth, 275, 100_000)
    );
}

export function orderedQueryStudioTabs(options: {
    results: boolean;
    messages?: boolean;
    vector: boolean;
    queryPlan: boolean;
}): QueryStudioTabId[] {
    const applies: Record<QueryStudioTabId, boolean> = {
        results: options.results,
        messages: options.messages !== false,
        vector: options.vector,
        queryPlan: options.queryPlan,
    };
    return QUERY_STUDIO_TAB_ORDER.filter((tab) => applies[tab]);
}

/** A fallback-text result must not expose a pane whose numeric tools cannot run. */
export function isVectorTabEligible(
    featureEnabled: boolean,
    transports: readonly ("binary-v1" | "textFallback")[],
): boolean {
    return featureEnabled && transports.some((transport) => transport === "binary-v1");
}

export namespace QsGetPanelViewStateRequest {
    export const type = new RequestType<void, QueryStudioPanelViewState, void>(
        "qs/panelViewState.get",
    );
}

export namespace QsUpdatePanelViewStateNotification {
    export const type = new NotificationType<QueryStudioPanelViewState>("qs/panelViewState.update");
}
