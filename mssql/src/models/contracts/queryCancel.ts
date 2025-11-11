/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

// Query Cancellation Request
export namespace QueryCancelRequest {
    export const type = new RequestType<QueryCancelParams, QueryCancelResult, void, void>(
        "query/cancel",
    );
}

export class QueryCancelParams {
    ownerUri: string;
}

export class QueryCancelResult {
    messages: string;
}
