/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc";
import {
    ExecutionPlanReducers,
    ExecutionPlanState,
    ExecutionPlanWebviewState,
} from "./executionPlan";

export interface ISlickRange {
    fromCell: number;
    fromRow: number;
    toCell: number;
    toRow: number;
}

export enum QueryResultLoadState {
    Loading = "Loading",
    Loaded = "Loaded",
    Error = "Error",
}

export enum QueryResultSaveAsTrigger {
    ContextMenu = "ContextMenu",
    Toolbar = "Toolbar",
}

export enum QueryResultPaneTabs {
    Results = "results",
    Messages = "messages",
    ExecutionPlan = "executionPlan",
}

export enum QueryResultViewMode {
    Grid = "grid",
    Text = "text",
}

export enum ResultsGridAutoSizeStyle {
    HeadersAndData = "headersAndData",
    DataOnly = "dataOnly",
    HeaderOnly = "headerOnly",
    Off = "off",
}

export enum QueryResultWebviewLocation {
    Panel = "panel", // VSCode panel area (Terminal, Debug Console, etc.), it's not related to the webview panel.
    Document = "document", // VSCode document area (editor area)
}

/**
 * Status of a query result session shown in the query results list.
 */
export enum QueryResultSessionStatus {
    Executing = "executing",
    Success = "success",
    Error = "error",
}

/**
 * Lightweight descriptor for a single query result session rendered as an entry in the
 * query results list. The full result state is fetched lazily for the selected session
 * only; this roster is intentionally small so it can be pushed on every update.
 */
export interface QueryResultSession {
    /** The document URI the results belong to. */
    uri: string;
    /** Display label for the list entry (typically the document file name). */
    title: string;
    /** Execution status used to render the entry's status indicator. */
    status: QueryResultSessionStatus;
    /** Whether this session corresponds to the currently active editor. */
    isActiveEditor: boolean;
    /** Whether this session's results are currently popped out to their own editor tab. */
    isOpenInTab: boolean;
}

export interface QueryResultTabStates {
    resultPaneTab: QueryResultPaneTabs;
    resultViewMode?: QueryResultViewMode;
}

export interface FontSettings {
    fontSize?: number;
    fontFamily?: string;
}

export type GridLinesMode = "both" | "horizontal" | "vertical" | "none";

export interface GridSettings {
    alternatingRowColors?: boolean;
    showGridLines?: GridLinesMode;
    rowPadding?: number | null;
}

export interface QueryResultWebviewState extends ExecutionPlanWebviewState {
    uri?: string;
    title?: string;
    resultSetSummaries: Record<number, Record<number, ResultSetSummary>>;
    messages: IMessage[];
    tabStates?: QueryResultTabStates;
    isExecutionPlan?: boolean;
    selection?: ISlickRange[];
    gridSelections?: Record<string, ISlickRange[]>;
    executionPlanState: ExecutionPlanState;
    fontSettings: FontSettings;
    gridSettings?: GridSettings;
    autoSizeColumnsMode?: ResultsGridAutoSizeStyle;
    inMemoryDataProcessingThreshold?: number;
    isBetaResultsGridEnabled?: boolean;
    initializationError?: string;
    selectionSummary?: SelectionSummary;
    isExecuting?: boolean;
    executionStartTime?: number;
    executionElapsedMilliseconds?: number;
    rowsAffected?: number;
    /**
     * Roster of all query result sessions shown in the query results list.
     * Only populated for the panel results view when the query results list preview is enabled.
     */
    sessions?: QueryResultSession[];
    /** Whether the query results list is enabled. */
    isQueryResultsListEnabled?: boolean;
    /**
     * Whether the panel is currently following the active editor (auto-sync). When false the user
     * has pinned a specific session and the "Follow active editor" affordance is shown.
     */
    isFollowingActiveEditor?: boolean;
    /**
     * Whether the selected session's results are currently shown in a separate editor tab.
     * When true the panel shows an "open in a new tab" placeholder instead of the results grid.
     */
    isSelectedSessionInTab?: boolean;
}

export interface SelectionSummaryMetrics {
    average?: number;
    count: number;
    distinctCount: number;
    max?: number;
    min?: number;
    nullCount: number;
    sum?: number;
}

export interface SelectionSummary {
    stats?: SelectionSummaryMetrics;
    text?: string;
    displayText?: string;
    command?: {
        title: string;
        command: string;
        arguments: unknown[];
    };
    tooltip?: string;
    batchId?: number;
    resultId?: number;
}

export interface QueryResultReducers extends Omit<ExecutionPlanReducers, "getExecutionPlan"> {
    setResultTab: {
        tabId: QueryResultPaneTabs;
    };
    setResultViewMode: {
        viewMode: QueryResultViewMode;
    };
    /**
     * Selects a query result session in the query results list, switching the shown results
     * without changing the active editor.
     */
    selectResultSession: {
        uri: string;
    };
    /**
     * Resumes following the active editor (auto-sync) after the user has pinned a session.
     */
    followActiveEditor: Record<string, never>;
    /**
     * Reveals the editor tab that holds a popped-out session's results.
     */
    revealResultTab: {
        uri: string;
    };
    /**
     * Gets the execution plan graph from the provider for given uri
     * @param uri  the uri for which to get graphs for
     */
    getExecutionPlan: {
        uri: string;
    };
    /**
     * Opens a file of type with with specified content
     * @param content the content of the file
     * @param type the type of file to open
     */
    openFileThroughLink: {
        content: string;
        type: string;
    };
}

export interface ISelectionData {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface IMessageLink {
    uri?: string;
    text: string;
}

export interface IMessage {
    batchId?: number;
    time?: string;
    message: string;
    isError: boolean;
    link?: IMessageLink;
    selection?: ISelectionData;
    rowsAffected?: number;
}

export interface ResultSetSummary {
    id: number;
    batchId: number;
    rowCount: number;
    columnInfo: IDbColumn[];
}

export interface IDbColumn {
    allowDBNull?: boolean;
    baseCatalogName: string;
    baseColumnName: string;
    baseSchemaName: string;
    baseServerName: string;
    baseTableName: string;
    columnName: string;
    columnOrdinal?: number;
    columnSize?: number;
    isAliased?: boolean;
    isAutoIncrement?: boolean;
    isExpression?: boolean;
    isHidden?: boolean;
    isIdentity?: boolean;
    isKey?: boolean;
    isBytes?: boolean;
    isChars?: boolean;
    isSqlVariant?: boolean;
    isUdt?: boolean;
    dataType: string;
    isXml?: boolean;
    isJson?: boolean;
    isVector?: boolean;
    isLong?: boolean;
    isReadOnly?: boolean;
    isUnique?: boolean;
    numericPrecision?: number;
    numericScale?: number;
    udtAssemblyQualifiedName: string;
    dataTypeName: string;
}

export interface DbCellValue {
    displayValue: string;
    isNull: boolean;
    rowId?: number;
}

export interface ResultSetSubset {
    rowCount: number;
    rows: DbCellValue[][];
}

export interface SelectionSummaryStats {
    average?: string;
    count: number;
    distinctCount: number;
    max?: number;
    min?: number;
    nullCount: number;
    sum?: number;
    removeSelectionStats: boolean;
}

export enum SortProperties {
    ASC = "ASC",
    DESC = "DESC",
    NONE = "NONE", // no sort
}

export interface ColumnFilterState {
    filterValues: string[];
    sorted?: SortProperties;
    seachText?: string;
    columnDef: string;
}

/**
 * Maps the column filter state for a specific column
 */
export type ColumnFilterMap = Record<string, ColumnFilterState>;

export interface GetFiltersParams {
    uri: string;
    gridId: string;
}
export namespace GetFiltersRequest {
    export const type = new RequestType<GetFiltersParams, ColumnFilterMap, void>("getFilters");
}

export interface SetFiltersParams {
    uri: string;
    gridId: string;
    filters: ColumnFilterMap;
}

export namespace SetFiltersRequest {
    export const type = new RequestType<SetFiltersParams, void, void>("setFilters");
}

export interface GetColumnWidthsParams {
    uri: string;
    gridId: string;
}

export namespace GetColumnWidthsRequest {
    export const type = new RequestType<GetColumnWidthsParams, number[], void>("getColumnWidths");
}

export interface SetColumnWidthsParams {
    uri: string;
    gridId: string;
    columnWidths: number[];
}

export namespace SetColumnWidthsRequest {
    export const type = new RequestType<SetColumnWidthsParams, void, void>("setColumnWidths");
}

export interface GridViewState {
    hiddenColumnIds?: string[];
    frozenColumnIndex?: number;
    selection?: ISlickRange[];
}

export interface GetGridViewStateParams {
    uri: string;
    gridId: string;
}

export namespace GetGridViewStateRequest {
    export const type = new RequestType<GetGridViewStateParams, GridViewState | undefined, void>(
        "getGridViewState",
    );
}

export interface SetGridViewStateParams {
    uri: string;
    gridId: string;
    gridViewState: GridViewState;
}

export namespace SetGridViewStateRequest {
    export const type = new RequestType<SetGridViewStateParams, void, void>("setGridViewState");
}

export namespace ShowFilterDisabledMessageRequest {
    export const type = new RequestType<void, void, void>("showFilterDisabledMessage");
}

export interface CopySelectionRequestParams {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
    includeHeaders?: boolean;
}

export namespace CopySelectionRequest {
    export const type = new RequestType<CopySelectionRequestParams, void, void>("copySelection");
}

export interface CopyHeadersParams {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
}
export namespace CopyHeadersRequest {
    export const type = new RequestType<CopyHeadersParams, void, void>("copyHeaders");
}

export interface CopyAsCsvRequest {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
}

export namespace CopyAsCsvRequest {
    export const type = new RequestType<CopyAsCsvRequest, void, void>("copyAsCsv");
}

export interface CopyAsJsonRequest {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
    includeHeaders: boolean;
}

export namespace CopyAsJsonRequest {
    export const type = new RequestType<CopyAsJsonRequest, void, void>("copyAsJson");
}

export interface CopyAsInClauseRequest {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
}

export namespace CopyAsInClauseRequest {
    export const type = new RequestType<CopyAsInClauseRequest, void, void>("copyAsInClause");
}

export interface CopyAsInsertIntoRequest {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
}

export namespace CopyAsInsertIntoRequest {
    export const type = new RequestType<CopyAsInsertIntoRequest, void, void>("copyAsInsertInto");
}

export interface CopyColumnNameRequestParams {
    columnName: string;
}

export namespace CopyColumnNameRequest {
    export const type = new RequestType<CopyColumnNameRequestParams, void, void>("copyColumnName");
}

export interface SetSelectionSummary {
    uri: string;
    gridId: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
    displaySelection: ISlickRange[];
}
export namespace SetSelectionSummaryRequest {
    export const type = new NotificationType<SetSelectionSummary>("setSelectionSummary");
}

export interface OpenInNewTabParams {
    uri: string;
}
export namespace OpenInNewTabRequest {
    export const type = new RequestType<OpenInNewTabParams, void, void>("openInNewTab");
}

export interface GetWebviewLocationParams {
    uri: string;
}
export namespace GetWebviewLocationRequest {
    export const type = new RequestType<GetWebviewLocationParams, QueryResultWebviewLocation, void>(
        "getWebviewLocation",
    );
}

export interface SetEditorSelectionParams {
    uri: string;
    selectionData: ISelectionData;
}
export namespace SetEditorSelectionRequest {
    export const type = new RequestType<SetEditorSelectionParams, void, void>("setEditorSelection");
}

export interface SaveResultsWebviewParams {
    uri: string;
    batchId?: number;
    resultId?: number;
    format: string;
    selection?: ISlickRange[];
    origin: QueryResultSaveAsTrigger;
}
export namespace SaveResultsWebviewRequest {
    export const type = new RequestType<SaveResultsWebviewParams, void, void>("saveResults");
}

export interface GetRowsParams {
    uri: string;
    batchId: number;
    resultId: number;
    rowStart: number;
    numberOfRows: number;
}
export namespace GetRowsRequest {
    export const type = new RequestType<GetRowsParams, ResultSetSubset, void>("getRows");
}

/**
 * Sets the scroll position for a grid in the webview
 */
export interface SetGridScrollPositionParams {
    uri: string;
    gridId: string;
    scrollTop: number;
    scrollLeft: number;
}

/**
 * Sets the scroll position for a grid in the webview
 * @param uri The URI of the query result state this request is associated with
 */
export namespace SetGridScrollPositionNotification {
    export const type = new NotificationType<SetGridScrollPositionParams>("setGridScrollPosition");
}

export interface GetGridScrollPositionParams {
    uri: string;
    gridId: string;
}

export interface GetGridScrollPositionResponse {
    scrollTop: number;
    scrollLeft: number;
}

export namespace GetGridScrollPositionRequest {
    export const type = new RequestType<
        GetGridScrollPositionParams,
        GetGridScrollPositionResponse,
        void
    >("getGridScrollPosition");
}

export interface SetGridPaneScrollPositionParams {
    uri: string;
    scrollTop: number;
}

export namespace SetGridPaneScrollPositionNotification {
    export const type = new NotificationType<SetGridPaneScrollPositionParams>(
        "setPaneScrollPosition",
    );
}

export interface GetGridPaneScrollPositionParams {
    uri: string;
}

export interface GetGridPaneScrollPositionResponse {
    scrollTop: number;
}

export namespace GetGridPaneScrollPositionRequest {
    export const type = new RequestType<
        GetGridPaneScrollPositionParams,
        GetGridPaneScrollPositionResponse,
        void
    >("getGridPaneScrollPosition");
}

export namespace SetMessagesTabScrollPositionNotification {
    export const type = new NotificationType<{ uri: string; scrollTop: number }>(
        "setMessagesTabScrollPosition",
    );
}

export namespace GetMessagesTabScrollPositionRequest {
    export const type = new RequestType<{ uri: string }, { scrollTop: number }, void>(
        "getMessagesTabScrollPosition",
    );
}

export namespace SetMaximizedGridNotification {
    export const type = new NotificationType<{ uri: string; gridId: string }>("setMaximizedGrid");
}

export namespace GetMaximizedGridRequest {
    export const type = new RequestType<{ uri: string }, { gridId: string | null }, void>(
        "getMaximizedGrid",
    );
}

export enum GridContextMenuAction {
    SelectAll = "select-all",
    CopySelection = "copy-selection",
    CopyHeaders = "copy-headers",
    CopyWithHeaders = "copy-with-headers",
    CopyAsCsv = "copy-as-csv",
    CopyAsJson = "copy-as-json",
    CopyAsInClause = "copy-as-in-clause",
    CopyAsInsertInto = "copy-as-insert-into",
}
