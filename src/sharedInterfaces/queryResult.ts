/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "../sharedInterfaces/webview";
import {
    ExecutionPlanGraph,
    ExecutionPlanGraphInfo,
    GetExecutionPlanResult,
} from "../reactviews/pages/ExecutionPlan/executionPlanInterfaces";

export enum QueryResultLoadState {
    Loading = "Loading",
    Loaded = "Loaded",
    Error = "Error",
}

export interface QueryResultReactProvider {
    setResultTab: (tabId: QueryResultPaneTabs) => void;
    /**
     * Gets the execution plan graph from the provider for a given plan file
     * @param planFile file that contains the execution plan
     */
    getExecutionPlan(planFile: ExecutionPlanGraphInfo): void;

    /**
     * Gets the execution plan graph from the provider for a given plan file
     * @param plan the xml plan contents to be added
     */
    addXmlPlan(plan: string): void;

    /**
     * Handles saving the execution plan file through the vscode extension api
     * @param sqlPlanContent the xml file content of the execution plan
     */
    saveExecutionPlan(sqlPlanContent: string): void;

    /**
     * Opens the execution plan xml content in another window
     * @param sqlPlanContent the xml file content of the execution plan
     */
    showPlanXml(sqlPlanContent: string): void;

    /**
     * Opens the execution plan query in another window
     * @param sqlPlanContent the query of the execution plan
     */
    showQuery(query: string): void;

    /**
     * Adds the specified cost to the total cost of the execution plan script
     * @param addedCost the cost of the current execution plan graph
     */
    updateTotalCost(addedCost: number): void;
}

export enum QueryResultPaneTabs {
    Results = "results",
    Messages = "messages",
    ExecutionPlan = "executionPlan",
}

export interface QueryResultTabStates {
    resultPaneTab: QueryResultPaneTabs;
}

export interface QueryResultWebviewState {
    uri?: string;
    resultSetSummaries: { [key: number]: ResultSetSummary };
    messages: IMessage[];
    tabStates?: QueryResultTabStates;
    isExecutionPlan?: boolean;
    executionPlanState: {
        xmlPlans?: string[];
        sqlPlanContent?: string;
        executionPlan?: GetExecutionPlanResult;
        executionPlanGraphs?: ExecutionPlanGraph[];
        theme?: string;
        totalCost?: number;
        loadState?: ApiStatus;
        errorMessage?: string;
    };
}

export interface QueryResultReducers {
    setResultTab: {
        tabId: QueryResultPaneTabs;
    };
    getExecutionPlan: {
        sqlPlanContent: string;
    };
    addXmlPlan: {
        xmlPlan: string;
    };
    saveExecutionPlan: {
        sqlPlanContent: string;
    };
    showPlanXml: {
        sqlPlanContent: string;
    };
    showQuery: {
        query: string;
    };
    updateTotalCost: {
        addedCost: number;
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
