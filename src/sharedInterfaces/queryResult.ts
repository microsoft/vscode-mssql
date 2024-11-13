/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExecutionPlanProvider,
    ExecutionPlanReducers,
    ExecutionPlanState,
    ExecutionPlanWebviewState,
} from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { ISlickRange } from "../reactviews/pages/QueryResult/table/utils";

export enum QueryResultLoadState {
    Loading = "Loading",
    Loaded = "Loaded",
    Error = "Error",
}

export enum QueryResultSaveAsTrigger {
    ContextMenu = "ContextMenu",
    Toolbar = "Toolbar",
}

export interface QueryResultReactProvider
    extends Omit<ExecutionPlanProvider, "getExecutionPlan"> {
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
}

export interface QueryResultReducers
    extends Omit<ExecutionPlanReducers, "getExecutionPlan"> {
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
