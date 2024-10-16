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

export enum QueryResultLoadState {
    Loading = "Loading",
    Loaded = "Loaded",
    Error = "Error",
}

export interface QueryResultReactProvider
    extends Omit<ExecutionPlanProvider, "getExecutionPlan"> {
    setResultTab: (tabId: QueryResultPaneTabs) => void;
    /**
     * Gets the execution plan graph from the provider for a given plan file
     * @param planFile file that contains the execution plan
     */
    getExecutionPlan(xmlPlans: string[]): void;

    /**
     * Gets the execution plan graph from the provider for a given plan file
     * @param plan the xml plan contents to be added
     */
    addXmlPlan(plan: string): void;
}

export enum QueryResultPaneTabs {
    Results = "results",
    Messages = "messages",
    ExecutionPlan = "executionPlan",
}

export interface QueryResultTabStates {
    resultPaneTab: QueryResultPaneTabs;
}

export interface QueryResultWebviewState extends ExecutionPlanWebviewState {
    uri?: string;
    resultSetSummaries: Record<number, Record<number, ResultSetSummary>>;
    messages: IMessage[];
    tabStates?: QueryResultTabStates;
    isExecutionPlan?: boolean;
    executionPlanState: ExecutionPlanState & {
        xmlPlans?: string[];
    };
}

export interface QueryResultReducers
    extends Omit<ExecutionPlanReducers, "getExecutionPlan"> {
    setResultTab: {
        tabId: QueryResultPaneTabs;
    };
    getExecutionPlan: {
        xmlPlans: string[];
    };
    addXmlPlan: {
        xmlPlan: string;
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
