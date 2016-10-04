import {RequestType} from 'vscode-languageclient';

// Query Cancellation Request
export namespace QueryCancelRequest {
    export const type: RequestType<QueryCancelParams, QueryCancelResult, void> = {
        get method(): string { return 'query/cancel'; }
    };
}

export class QueryCancelParams {
    ownerUri: string;
}

export class QueryCancelResult {
    messages: string;
}
