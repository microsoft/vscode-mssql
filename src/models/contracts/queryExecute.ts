import {RequestType, NotificationType, ResponseError} from 'vscode-languageclient';
import { IDbColumn, ISelectionData, IResultMessage } from './../interfaces';


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

// Query Execution Complete Notification ----------------------------------------------------------
export namespace QueryExecuteCompleteNotification {
    export const type: NotificationType<QueryExecuteCompleteNotificationResult, void> =
        new NotificationType<QueryExecuteCompleteNotificationResult, void>('query/complete');
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

// Query Batch Start Notification -----------------------------------------------------------------
export namespace QueryExecuteBatchStartNotification {
    export const type: NotificationType<QueryExecuteBatchNotificationParams, void> =
        new NotificationType<QueryExecuteBatchNotificationParams, void>('query/batchStart');
}

// Query Batch Complete Notification --------------------------------------------------------------
export namespace QueryExecuteBatchCompleteNotification {
    export const type: NotificationType<QueryExecuteBatchNotificationParams, void> =
        new NotificationType<QueryExecuteBatchNotificationParams, void>('query/batchComplete');
}

// Query ResultSet Complete Notification -----------------------------------------------------------
export namespace QueryExecuteResultSetCompleteNotification {
    export const type: NotificationType<QueryExecuteResultSetCompleteNotificationParams, void> =
        new NotificationType<QueryExecuteResultSetCompleteNotificationParams, void>('query/resultSetComplete');
}

export class QueryExecuteResultSetCompleteNotificationParams {
    resultSetSummary: ResultSetSummary;
    ownerUri: string;
}


// Query Message Notification ---------------------------------------------------------------------
export namespace QueryExecuteMessageNotification {
    export const type: NotificationType<QueryExecuteMessageParams, void> =
        new NotificationType<QueryExecuteMessageParams, void>('query/message');
}

export class QueryExecuteMessageParams {
    message: IResultMessage;
    ownerUri: string;
}

// Query Execution Request ------------------------------------------------------------------------
export namespace QueryExecuteRequest {
    export const type: RequestType<QueryExecuteParams, QueryExecuteResult, ResponseError<void>, void> =
        new RequestType<QueryExecuteParams, QueryExecuteResult, ResponseError<void>, void>('query/executeDocumentSelection');
}

export class QueryExecuteParams {
    ownerUri: string;
    querySelection: ISelectionData;
}

export class QueryExecuteResult {}

// --------------------------------- < Query Results Request > ------------------------------------------
export namespace QueryExecuteSubsetRequest {
    export const type: RequestType<QueryExecuteSubsetParams, QueryExecuteSubsetResult, ResponseError<void>, void> =
        new RequestType<QueryExecuteSubsetParams, QueryExecuteSubsetResult, ResponseError<void>, void>('query/subset');
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
}

export class ResultSetSubset {
    rowCount: number;
    rows: DbCellValue[][];
}

export class QueryExecuteSubsetResult {
    resultSubset: ResultSetSubset;
}

// --------------------------------- </ Query Results Request > ------------------------------------------
