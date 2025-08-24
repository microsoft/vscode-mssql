/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType, NotificationType } from "vscode-languageclient";
import { IDbColumn, ISelectionData, IResultMessage } from "./../interfaces";

export class ResultSetSummary {
    id: number;
    batchId: number;
    rowCount: number;
    columnInfo: IDbColumn[];
}

export class BatchSummary {
    hasError: boolean;
    id: number;
    selection: ISelectionData;
    resultSetSummaries: ResultSetSummary[];
    executionElapsed: string;
    executionEnd: string;
    executionStart: string;
}

// ------------------------------- < Query Execution Complete Notification > ------------------------------------
export namespace QueryExecuteCompleteNotification {
    export const type = new NotificationType<QueryExecuteCompleteNotificationResult, void>(
        "query/complete",
    );
}

export class QueryExecuteCompleteNotificationResult {
    ownerUri: string;
    batchSummaries: BatchSummary[];
}

// Query Batch Notification -----------------------------------------------------------------------
export class QueryExecuteBatchNotificationParams {
    batchSummary: BatchSummary;
    ownerUri: string;
}

// ------------------------------- < Query Batch Start  Notification > ------------------------------------
export namespace QueryExecuteBatchStartNotification {
    export const type = new NotificationType<QueryExecuteBatchNotificationParams, void>(
        "query/batchStart",
    );
}

// ------------------------------- < Query Batch Complete Notification > ------------------------------------
export namespace QueryExecuteBatchCompleteNotification {
    export const type = new NotificationType<QueryExecuteBatchNotificationParams, void>(
        "query/batchComplete",
    );
}

// Query ResultSet Available Notification -----------------------------------------------------------
export namespace QueryExecuteResultSetAvailableNotification {
    export const type = new NotificationType<
        QueryExecuteResultSetAvailableNotificationParams,
        void
    >("query/resultSetAvailable");
}

export class QueryExecuteResultSetAvailableNotificationParams {
    resultSetSummary: ResultSetSummary;
    ownerUri: string;
}

// Query ResultSet Updated Notification -----------------------------------------------------------
export namespace QueryExecuteResultSetUpdatedNotification {
    export const type = new NotificationType<QueryExecuteResultSetUpdatedNotificationParams, void>(
        "query/resultSetUpdated",
    );
}

export class QueryExecuteResultSetUpdatedNotificationParams {
    resultSetSummary: ResultSetSummary;
    ownerUri: string;
}

// Query ResultSet Complete Notification -----------------------------------------------------------
export namespace QueryExecuteResultSetCompleteNotification {
    export const type = new NotificationType<QueryExecuteResultSetCompleteNotificationParams, void>(
        "query/resultSetComplete",
    );
}

export class QueryExecuteResultSetCompleteNotificationParams {
    resultSetSummary: ResultSetSummary;
    ownerUri: string;
}

// ------------------------------- < Query Message Notification > ------------------------------------
export namespace QueryExecuteMessageNotification {
    export const type = new NotificationType<QueryExecuteMessageParams, void>("query/message");
}

export class QueryExecuteMessageParams {
    message: IResultMessage;
    ownerUri: string;
}

// ------------------------------- < Query Execution Request > ------------------------------------
export namespace QueryExecuteRequest {
    export const type = new RequestType<QueryExecuteParams, QueryExecuteResult, void, void>(
        "query/executeDocumentSelection",
    );
}

export namespace QueryExecuteStatementRequest {
    export const type = new RequestType<
        QueryExecuteStatementParams,
        QueryExecuteResult,
        void,
        void
    >("query/executedocumentstatement");
}

export class QueryExecuteParams {
    ownerUri: string;
    executionPlanOptions?: ExecutionPlanOptions;
    querySelection: ISelectionData;
}

export class QueryExecuteStatementParams {
    ownerUri: string;
    line: number;
    column: number;
}

export class QueryExecuteResult {}

export class ExecutionPlanOptions {
    includeActualExecutionPlanXml?: boolean;
    includeEstimatedExecutionPlanXml?: boolean;
}

// ------------------------------- < Query Results Request > ------------------------------------
export namespace QueryExecuteSubsetRequest {
    export const type = new RequestType<
        QueryExecuteSubsetParams,
        QueryExecuteSubsetResult,
        void,
        void
    >("query/subset");
}

export class QueryExecuteSubsetParams {
    ownerUri: string;
    batchIndex: number;
    resultSetIndex: number;
    rowsStartIndex: number;
    rowsCount: number;
}

export class DbCellValue {
    displayValue: string;
    isNull: boolean;
    rowId?: number;
}

export class ResultSetSubset {
    rowCount: number;
    rows: DbCellValue[][];
}

export class QueryExecuteSubsetResult {
    resultSubset: ResultSetSubset;
}

// ------------------------------- < Query Execution Options Request > ------------------------------------
export namespace QueryExecuteOptionsRequest {
    export const type = new RequestType<QueryExecutionOptionsParams, boolean, void, void>(
        "query/setexecutionoptions",
    );
}

export class QueryExecutionOptionsParams {
    ownerUri: string;
    options: QueryExecutionOptions;
}

// tslint:disable-next-line:interface-name
export interface QueryExecutionOptions {
    [option: string]: any;
}

// ------------------------------- < Query Connection URI Change Request > ------------------------------------

export namespace QueryConnectionUriChangeRequest {
    export const type = new NotificationType<QueryConnectionUriChangeParams, boolean>(
        "query/connectionUriChanged",
    );
}

export class QueryConnectionUriChangeParams {
    newOwnerUri: string;
    originalOwnerUri: string;
}
