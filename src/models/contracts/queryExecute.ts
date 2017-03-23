import {RequestType, NotificationType} from 'vscode-languageclient';
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
    export const type: NotificationType<QueryExecuteCompleteNotificationResult> = {
        get method(): string {
            return 'query/complete';
        }
    };
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
    export const type: NotificationType<QueryExecuteBatchNotificationParams> = {
        get method(): string {
            return 'query/batchStart';
        }
    };
}

// Query Batch Complete Notification --------------------------------------------------------------
export namespace QueryExecuteBatchCompleteNotification {
    export const type: NotificationType<QueryExecuteBatchNotificationParams> = {
        get method(): string {
            return 'query/batchComplete';
        }
    };
}

// Query ResultSet Complete Notification -----------------------------------------------------------
export namespace QueryExecuteResultSetCompleteNotification {
    export const type: NotificationType<QueryExecuteResultSetCompleteNotificationParams> = {
        get method(): string {
            return 'query/resultSetComplete';
        }
    };
}

export class QueryExecuteResultSetCompleteNotificationParams {
    resultSetSummary: ResultSetSummary;
    ownerUri: string;
}


// Query Message Notification ---------------------------------------------------------------------
export namespace QueryExecuteMessageNotification {
    export const type: NotificationType<QueryExecuteMessageParams> = {
        get method(): string {
            return 'query/message';
        }
    };
}

export class QueryExecuteMessageParams {
    message: IResultMessage;
    ownerUri: string;
}

// Query Execution Request ------------------------------------------------------------------------
export namespace QueryExecuteRequest {
    export const type: RequestType<QueryExecuteParams, QueryExecuteResult, void> = {
        get method(): string {
            return 'query/executeDocumentSelection';
        }
    };
}

export class QueryExecuteParams {
    ownerUri: string;
    querySelection: ISelectionData;
}

export class QueryExecuteResult {}

// --------------------------------- < Query Results Request > ------------------------------------------
export namespace QueryExecuteSubsetRequest {
    export const type: RequestType<QueryExecuteSubsetParams, QueryExecuteSubsetResult, void> = {
                                                                                        get method(): string {
                                                                                            return 'query/subset';
                                                                                        }
                                                                                    };
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
