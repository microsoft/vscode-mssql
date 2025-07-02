/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";
import {
    ExecutionPlanProvider,
    ExecutionPlanReducers,
    ExecutionPlanState,
    ExecutionPlanWebviewState,
} from "./executionPlanInterfaces";

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

export interface QueryResultReactProvider extends Omit<ExecutionPlanProvider, "getExecutionPlan"> {
    setResultTab: (tabId: QueryResultPaneTabs) => void;
    /**
     * Gets the execution plan graph from the provider for a result set
     * @param uri the uri of the query result state this request is associated with
     */
    getExecutionPlan(uri: string): void;

    /**
     * Opens a file of type with with specified content
     * @param content the content of the file
     * @param type the type of file to open
     */
    openFileThroughLink(content: string, type: string): void;
}

export enum QueryResultPaneTabs {
    Results = "results",
    Messages = "messages",
    ExecutionPlan = "executionPlan",
}

export enum QueryResultWebviewLocation {
    Panel = "panel", // VSCode panel area (Terminal, Debug Console, etc.), it's not related to the webview panel.
    Document = "document", // VSCode document area (editor area)
}

export interface QueryResultTabStates {
    resultPaneTab: QueryResultPaneTabs;
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
    actualPlanEnabled?: boolean;
    selection?: ISlickRange[];
    executionPlanState: ExecutionPlanState;
    fontSettings: FontSettings;
    autoSizeColumns?: boolean;
    inMemoryDataProcessingThreshold?: number;
}

export interface QueryResultReducers extends Omit<ExecutionPlanReducers, "getExecutionPlan"> {
    setResultTab: {
        tabId: QueryResultPaneTabs;
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
export type ColumnFilterMap = Record<string, ColumnFilterState[]>;

/**
 * Maps all the column filters for a specific grid ID
 */
export type GridColumnMap = Record<string, ColumnFilterMap[]>;

export interface GetFiltersParams {
    uri: string;
}
export namespace GetFiltersRequest {
    export const type = new RequestType<GetFiltersParams, GridColumnMap[], void>("getFilters");
}

export interface SetFiltersParams {
    uri: string;
    filters: GridColumnMap[];
}

export namespace SetFiltersRequest {
    export const type = new RequestType<SetFiltersParams, void, void>("setFilters");
}

export interface getColumnWidthsParams {
    uri: string;
}

export namespace GetColumnWidthsRequest {
    export const type = new RequestType<getColumnWidthsParams, number[], void>("getColumnWidths");
}

export interface SetColumnWidthsParams {
    uri: string;
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
}
export namespace CopySelectionRequest {
    export const type = new RequestType<CopySelectionRequestParams, void, void>("copySelection");
}

export interface SendToClipboardParams {
    uri: string;
    data: DbCellValue[][];
    batchId: number;
    resultId: number;
    selection: ISlickRange[];
    headersFlag?: boolean;
}
export namespace SendToClipboardRequest {
    export const type = new RequestType<SendToClipboardParams, void, void>("sendToClipboard");
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

export interface CopyWithHeadersParams extends CopyHeadersParams {}
export namespace CopyWithHeadersRequest {
    export const type = new RequestType<CopyWithHeadersParams, void, void>("copyWithHeaders");
}

export interface SetSelectionSummary {
    summary: SelectionSummaryStats;
}
export namespace SetSelectionSummaryRequest {
    export const type = new RequestType<SetSelectionSummary, void, void>("setSelectionSummary");
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
