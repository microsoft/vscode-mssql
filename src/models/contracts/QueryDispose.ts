import { RequestType, ResponseError } from 'vscode-languageclient';

export namespace QueryDisposeRequest {
    export const type: RequestType<QueryDisposeParams, QueryDisposeResult, ResponseError<void>, void> =
        new RequestType<QueryDisposeParams, QueryDisposeResult, ResponseError<void>, void>('query/dispose');
}

/**
 * Parameters to provide when disposing of a query
 */
export class QueryDisposeParams {
    ownerUri: string;
}

/**
 * Result received upon successful disposal of a query
 */
export class QueryDisposeResult {
}
