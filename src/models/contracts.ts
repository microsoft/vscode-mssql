import {RequestType, NotificationType} from 'vscode-languageclient';

// ------------------------------- < Query Dispose Request > ----------------------------------------
export namespace QueryDisposeRequest {
    export const type: RequestType<QueryDisposeParams, QueryDisposeResult, void> = {
                                                                                        get method(): string {
                                                                                            return 'query/dispose';
                                                                                        }
                                                                                   };
}

export class QueryDisposeParams {
    ownerUri: string;
}

export class QueryDisposeResult {
    messages: string;
}
// --------------------------------- </ Query Dispose Request > ----------------------------------------

// -------------------------- < Query Execution Complete Notification > -------------------------------
export namespace QueryExecuteCompleteNotification {
    export const type: NotificationType<QueryExecuteCompleteNotificationResult> = {
                                                                                        get method(): string {
                                                                                            return 'query/complete';
                                                                                        }
                                                                                  };
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
    isLong?: boolean;
    isReadOnly?: boolean;
    isUnique?: boolean;
    numericPrecision?: number;
    numericScale?: number;
    udtAssemblyQualifiedName: string;
    dataTypeName: string;
}

export class ResultSetSummary {
    id: number;
    rowCount: number;
    columnInfo: IDbColumn[];
}

export class QueryExecuteCompleteNotificationResult {
    ownerUri: string;
    messages: string[];
    hasError: boolean;
    resultSetSummaries: ResultSetSummary[];
}

// -------------------------- </ Query Execution Complete Notification > -------------------------------

// --------------------------------- < Query Execution Request > ---------------------------------------
export namespace QueryExecuteRequest {
    export const type: RequestType<QueryExecuteParams, QueryExecuteResult, void> = {
                                                                                        get method(): string {
                                                                                            return 'query/execute';
                                                                                        }
                                                                                    };
}

export interface ISelectionData {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
}

export class QueryExecuteParams {
    ownerUri: string;
    queryText: string;
}

export class QueryExecuteResult {
    messages: string;
}

// --------------------------------- </ Query Execution Request > ---------------------------------------

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
    resultSetIndex: number;
    rowsStartIndex: number;
    rowsCount: number;
}

export class ResultSetSubset {
    rowCount: number;
    rows: any[][];
}

export class QueryExecuteSubsetResult {
    message: string;
    resultSubset: ResultSetSubset;
}

// --------------------------------- </ Query Results Request > ------------------------------------------
