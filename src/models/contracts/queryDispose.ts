import { RequestType } from 'vscode-languageclient';

export namespace QueryDisposeRequest {
    export const type: RequestType<QueryDisposeParams, QueryDisposeResult, void> = {
        get method(): string {
            return 'query/dispose';
        }
    };
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
