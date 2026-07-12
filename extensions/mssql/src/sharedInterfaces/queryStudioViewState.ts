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

export const QS_PANEL_VIEW_STATE_VERSION = 3;

export type QueryStudioTabId = "results" | "messages" | "vector" | "spatial" | "queryPlan";

/** Results is the only tab allowed before Messages; contributed tabs follow it. */
export const QUERY_STUDIO_TAB_ORDER: readonly QueryStudioTabId[] = [
    "results",
    "messages",
    "vector",
    "spatial",
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

export interface QsVectorSearchViewState {
    source: "selectedRow" | "generatedVector" | "pastedVector" | "expression";
    selectedRowOrdinal: number;
    /** Safe grammar text only; evaluated vector components never enter panel state. */
    expression?: string;
    targetId?: string;
    lastRunId?: string;
    metric: "cosine" | "euclidean" | "dot";
    k: number;
    includeApprox: boolean;
    filters: Array<{
        column: string;
        op: "eq" | "ne" | "gt" | "lt" | "ge" | "le";
        /** Always blank in retained state; live filter values stay renderer-local. */
        value: string;
    }>;
    sqlOpen: boolean;
    sqlTab: "exact" | "approx";
    sqlScrollPositions: Record<"exact" | "approx", { scrollTop: number; scrollLeft: number }>;
    selectedRankIndex?: number;
    rankScrollTop: number;
}

export interface QsVectorCompareViewState {
    ordinalInput: string;
    lastSubmittedOrdinals?: number[];
    metric: "cosine" | "euclidean" | "negativeDot";
}

export interface QsVectorProjectionViewState {
    fitted: boolean;
    centerX: number;
    centerY: number;
    scale: number;
    selectedOrdinal?: number;
    listScrollTop: number;
}

export interface QsVectorIndexViewState {
    selectedScriptId?: string;
    scriptScrollTop?: number;
}

export interface QsVectorPipelineViewState {
    modelName?: string;
    sourceColumnOrdinal?: number;
    rowOrdinal: number;
    showSql: boolean;
    chunkSize: number;
    overlapPct: number;
    lastRunId?: string;
}

export interface QsVectorPanelViewState {
    workspace: QsVectorWorkspaceId;
    selectedColumn?: { resultSetId: string; columnOrdinal: number };
    profileNorm: "l2" | "l1" | "linf";
    workspaceScrollTop: Partial<Record<QsVectorWorkspaceId, number>>;
    profileFinding?: string;
    profileDrawerScrollTop?: number;
    search: QsVectorSearchViewState;
    compare: QsVectorCompareViewState;
    projection: QsVectorProjectionViewState;
    index: QsVectorIndexViewState;
    pipeline: QsVectorPipelineViewState;
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

export interface QsSpatialPanelViewState {
    selectedColumn?: { resultSetId: string; columnOrdinal: number };
    labelColumnOrdinal?: number;
    colorColumnOrdinal?: number;
    groupBy: "none" | "srid" | "geometryType";
    renderer: "auto" | "canvas" | "gpuPoints";
    sidebarOpen: boolean;
    listOpen: boolean;
    detailsOpen: boolean;
    filters: {
        showNull: boolean;
        showEmpty: boolean;
        showUnsupported: boolean;
        geometryType?: string;
        srid?: number;
    };
    selectedRowOrdinal?: number;
    camera?: { centerX: number; centerY: number; zoom: number; rotation: number };
    listScrollTop: number;
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
    spatial: QsSpatialPanelViewState;
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
        vector: {
            workspace: "profile",
            profileNorm: "l2",
            workspaceScrollTop: {},
            search: {
                source: "selectedRow",
                selectedRowOrdinal: 0,
                expression: "normalize(A + B)",
                metric: "cosine",
                k: 20,
                includeApprox: true,
                filters: [],
                sqlOpen: false,
                sqlTab: "exact",
                sqlScrollPositions: {
                    exact: { scrollTop: 0, scrollLeft: 0 },
                    approx: { scrollTop: 0, scrollLeft: 0 },
                },
                rankScrollTop: 0,
            },
            compare: { ordinalInput: "", metric: "cosine" },
            projection: {
                fitted: false,
                centerX: 0,
                centerY: 0,
                scale: 60,
                listScrollTop: 0,
            },
            index: {},
            pipeline: {
                rowOrdinal: 0,
                showSql: false,
                chunkSize: 800,
                overlapPct: 15,
            },
        },
        spatial: {
            groupBy: "none",
            renderer: "auto",
            sidebarOpen: true,
            listOpen: true,
            detailsOpen: true,
            filters: { showNull: true, showEmpty: true, showUnsupported: true },
            listScrollTop: 0,
        },
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
    next.vector.search.metric = previous.vector.search.metric;
    next.vector.search.k = previous.vector.search.k;
    next.vector.search.includeApprox = previous.vector.search.includeApprox;
    next.vector.pipeline.chunkSize = previous.vector.pipeline.chunkSize;
    next.vector.pipeline.overlapPct = previous.vector.pipeline.overlapPct;
    next.spatial.groupBy = previous.spatial.groupBy;
    next.spatial.renderer = previous.spatial.renderer;
    next.spatial.sidebarOpen = previous.spatial.sidebarOpen;
    next.spatial.listOpen = previous.spatial.listOpen;
    next.spatial.detailsOpen = previous.spatial.detailsOpen;
    next.spatial.filters = { ...previous.spatial.filters };
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
 * retains it. Result-derived filter values may contain keys or secrets, so
 * they are removed after validation. The detached state is bounded in memory
 * and never logged, persisted, replayed, or telemetered.
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
        !isSpatialState(candidate.spatial) ||
        !isExecutionPlanState(candidate.queryPlan)
    ) {
        return undefined;
    }
    const detached = JSON.parse(serialized) as QueryStudioPanelViewState;
    detached.vector.search.filters = detached.vector.search.filters.map((filter) => ({
        ...filter,
        value: "",
    }));
    return detached;
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

function isAnyFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && isFiniteNumber(value);
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
        hasOnlyKeys(value, [
            "workspace",
            "selectedColumn",
            "profileNorm",
            "workspaceScrollTop",
            "profileFinding",
            "profileDrawerScrollTop",
            "search",
            "compare",
            "projection",
            "index",
            "pipeline",
        ]) &&
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
        ) &&
        (value.profileFinding === undefined || isBoundedString(value.profileFinding)) &&
        (value.profileDrawerScrollTop === undefined ||
            isFiniteNumber(value.profileDrawerScrollTop, 0)) &&
        isVectorSearchState(value.search) &&
        isVectorCompareState(value.compare) &&
        isVectorProjectionState(value.projection) &&
        isVectorIndexState(value.index) &&
        isVectorPipelineState(value.pipeline)
    );
}

function isVectorSearchState(value: unknown): boolean {
    if (!isRecord(value) || !Array.isArray(value.filters) || value.filters.length > 8) {
        return false;
    }
    return (
        hasOnlyKeys(value, [
            "source",
            "selectedRowOrdinal",
            "expression",
            "targetId",
            "lastRunId",
            "metric",
            "k",
            "includeApprox",
            "lastRunId",
            "filters",
            "sqlOpen",
            "sqlTab",
            "sqlScrollPositions",
            "selectedRankIndex",
            "rankScrollTop",
        ]) &&
        ["selectedRow", "generatedVector", "pastedVector", "expression"].includes(
            value.source as string,
        ) &&
        Number.isInteger(value.selectedRowOrdinal) &&
        isFiniteNumber(value.selectedRowOrdinal) &&
        (value.expression === undefined || isBoundedString(value.expression, 2_048)) &&
        (value.targetId === undefined || isBoundedString(value.targetId, 256)) &&
        (value.lastRunId === undefined || isBoundedString(value.lastRunId, 256)) &&
        ["cosine", "euclidean", "dot"].includes(value.metric as string) &&
        Number.isInteger(value.k) &&
        isFiniteNumber(value.k, 1, 1_000) &&
        typeof value.includeApprox === "boolean" &&
        value.filters.every(
            (filter) =>
                isRecord(filter) &&
                hasOnlyKeys(filter, ["column", "op", "value"]) &&
                isBoundedString(filter.column, 128) &&
                ["eq", "ne", "gt", "lt", "ge", "le"].includes(filter.op as string) &&
                isBoundedString(filter.value, MAX_SHORT_STRING_LENGTH),
        ) &&
        typeof value.sqlOpen === "boolean" &&
        ["exact", "approx"].includes(value.sqlTab as string) &&
        isRecord(value.sqlScrollPositions) &&
        hasOnlyKeys(value.sqlScrollPositions, ["exact", "approx"]) &&
        isScrollPosition(value.sqlScrollPositions.exact) &&
        isScrollPosition(value.sqlScrollPositions.approx) &&
        (value.selectedRankIndex === undefined ||
            (Number.isInteger(value.selectedRankIndex) &&
                isFiniteNumber(value.selectedRankIndex, 0, 1_999))) &&
        isFiniteNumber(value.rankScrollTop)
    );
}

function isVectorCompareState(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ["ordinalInput", "lastSubmittedOrdinals", "metric"]) &&
        isBoundedString(value.ordinalInput, MAX_SHORT_STRING_LENGTH) &&
        (value.lastSubmittedOrdinals === undefined ||
            (Array.isArray(value.lastSubmittedOrdinals) &&
                value.lastSubmittedOrdinals.length >= 2 &&
                value.lastSubmittedOrdinals.length <= 8 &&
                value.lastSubmittedOrdinals.every(
                    (ordinal) => Number.isInteger(ordinal) && isFiniteNumber(ordinal),
                ) &&
                new Set(value.lastSubmittedOrdinals).size ===
                    value.lastSubmittedOrdinals.length)) &&
        ["cosine", "euclidean", "negativeDot"].includes(value.metric as string)
    );
}

function isVectorProjectionState(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, [
            "centerX",
            "centerY",
            "scale",
            "fitted",
            "selectedOrdinal",
            "listScrollTop",
        ]) &&
        typeof value.fitted === "boolean" &&
        isFiniteNumber(value.centerX, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
        isFiniteNumber(value.centerY, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
        isFiniteNumber(value.scale, 1, 10_000) &&
        (value.selectedOrdinal === undefined ||
            (Number.isInteger(value.selectedOrdinal) && isFiniteNumber(value.selectedOrdinal))) &&
        isFiniteNumber(value.listScrollTop)
    );
}

function isVectorIndexState(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ["selectedScriptId", "scriptScrollTop"]) &&
        (value.selectedScriptId === undefined || isBoundedString(value.selectedScriptId, 256)) &&
        (value.scriptScrollTop === undefined || isFiniteNumber(value.scriptScrollTop, 0))
    );
}

function isVectorPipelineState(value: unknown): boolean {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, [
            "modelName",
            "sourceColumnOrdinal",
            "rowOrdinal",
            "showSql",
            "chunkSize",
            "overlapPct",
            "lastRunId",
        ]) &&
        (value.modelName === undefined || isBoundedString(value.modelName, 256)) &&
        (value.sourceColumnOrdinal === undefined ||
            (Number.isInteger(value.sourceColumnOrdinal) &&
                isFiniteNumber(value.sourceColumnOrdinal, 0, MAX_COLUMNS))) &&
        Number.isInteger(value.rowOrdinal) &&
        isFiniteNumber(value.rowOrdinal) &&
        typeof value.showSql === "boolean" &&
        Number.isInteger(value.chunkSize) &&
        isFiniteNumber(value.chunkSize, 1, 100_000) &&
        Number.isInteger(value.overlapPct) &&
        isFiniteNumber(value.overlapPct, 0, 99) &&
        (value.lastRunId === undefined || isBoundedString(value.lastRunId, 256))
    );
}

function isSpatialState(value: unknown): boolean {
    if (!isRecord(value) || !isRecord(value.filters)) {
        return false;
    }
    const selectedColumn = value.selectedColumn;
    const camera = value.camera;
    return (
        hasOnlyKeys(value, [
            "selectedColumn",
            "labelColumnOrdinal",
            "colorColumnOrdinal",
            "groupBy",
            "renderer",
            "sidebarOpen",
            "listOpen",
            "detailsOpen",
            "filters",
            "selectedRowOrdinal",
            "camera",
            "listScrollTop",
        ]) &&
        (selectedColumn === undefined ||
            (isRecord(selectedColumn) &&
                hasOnlyKeys(selectedColumn, ["resultSetId", "columnOrdinal"]) &&
                isBoundedString(selectedColumn.resultSetId) &&
                isNonNegativeInteger(selectedColumn.columnOrdinal))) &&
        (value.labelColumnOrdinal === undefined ||
            isNonNegativeInteger(value.labelColumnOrdinal)) &&
        (value.colorColumnOrdinal === undefined ||
            isNonNegativeInteger(value.colorColumnOrdinal)) &&
        ["none", "srid", "geometryType"].includes(value.groupBy as string) &&
        ["auto", "canvas", "gpuPoints"].includes(value.renderer as string) &&
        typeof value.sidebarOpen === "boolean" &&
        typeof value.listOpen === "boolean" &&
        typeof value.detailsOpen === "boolean" &&
        hasOnlyKeys(value.filters, ["showNull", "showEmpty", "showUnsupported"]) &&
        typeof value.filters.showNull === "boolean" &&
        typeof value.filters.showEmpty === "boolean" &&
        typeof value.filters.showUnsupported === "boolean" &&
        (value.selectedRowOrdinal === undefined ||
            isNonNegativeInteger(value.selectedRowOrdinal)) &&
        (camera === undefined ||
            (isRecord(camera) &&
                hasOnlyKeys(camera, ["centerX", "centerY", "zoom", "rotation"]) &&
                isAnyFiniteNumber(camera.centerX) &&
                isAnyFiniteNumber(camera.centerY) &&
                isFiniteNumber(camera.zoom, 0, 30) &&
                isAnyFiniteNumber(camera.rotation))) &&
        isFiniteNumber(value.listScrollTop)
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
    spatial?: boolean;
    queryPlan: boolean;
}): QueryStudioTabId[] {
    const applies: Record<QueryStudioTabId, boolean> = {
        results: options.results,
        messages: options.messages !== false,
        vector: options.vector,
        spatial: options.spatial === true,
        queryPlan: options.queryPlan,
    };
    return QUERY_STUDIO_TAB_ORDER.filter((tab) => applies[tab]);
}

export function isSpatialTabEligible(
    featureEnabled: boolean,
    columns: readonly { spatial?: { encoding: "wkb-v1" } }[],
): boolean {
    return featureEnabled && columns.some((column) => column.spatial?.encoding === "wkb-v1");
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
