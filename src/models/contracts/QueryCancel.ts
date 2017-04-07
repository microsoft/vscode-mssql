import {RequestType, ResponseError} from 'vscode-languageclient';

// Query Cancellation Request
export namespace QueryCancelRequest {
    export const type: RequestType<QueryCancelParams, QueryCancelResult, ResponseError<void>, void> =
        new RequestType<QueryCancelParams, QueryCancelResult, ResponseError<void>, void>('query/cancel');
}

export class QueryCancelParams {
    ownerUri: string;
}

export class QueryCancelResult {
    messages: string;
}
