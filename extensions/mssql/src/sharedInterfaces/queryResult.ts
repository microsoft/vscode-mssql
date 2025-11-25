/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
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
    Off = "off",
}

export enum QueryResultWebviewLocation {
    Panel = "panel", // VSCode panel area (Terminal, Debug Console, etc.), it's not related to the webview panel.
    Document = "document", // VSCode document area (editor area)
}

export interface QueryResultTabStates {
    resultPaneTab: QueryResultPaneTabs;
    resultViewMode?: QueryResultViewMode;
}

export interface FontSettings {
    fontSize?: number;
    fontFamily?: string;
}

export interface QueryResultWebviewState extends ExecutionPlanWebviewState {
    uri?: string;
    title?: string;
    resultSetSummaries: Record<number, Record<number, ResultSetSummary>>;
    messages: IMessage[];
    tabStates?: QueryResultTabStates;
    isExecutionPlan?: boolean;
    selection?: ISlickRange[];
    executionPlanState: ExecutionPlanState;
    fontSettings: FontSettings;
    autoSizeColumnsMode?: ResultsGridAutoSizeStyle;
    inMemoryDataProcessingThreshold?: number;
    initializationError?: string;
    selectionSummary?: SelectionSummary;
}

export interface SelectionSummary {
    text: string;
    command: {
        title: string;
        command: string;
        arguments: any[];
    };
    tooltip: string;
    continue?: any;
}

export interface QueryResultReducers extends Omit<ExecutionPlanReducers, "getExecutionPlan"> {
    setResultTab: {
        tabId: QueryResultPaneTabs;
    };
    setResultViewMode: {
        viewMode: QueryResultViewMode;
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

export interface SetSelectionSummary {
    uri: string;
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
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
