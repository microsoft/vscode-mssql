/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class StaleTsqlDocumentError extends Error {
    public constructor(
        public readonly uri: string,
        public readonly version: number,
    ) {
        super(`T-SQL document ${uri} version ${version} is stale`);
        this.name = "StaleTsqlDocumentError";
    }
}

export class TsqlOperationCancelledError extends Error {
    public constructor() {
        super("T-SQL document operation was cancelled");
        this.name = "TsqlOperationCancelledError";
    }
}

export function isTsqlCancellationError(error: unknown): boolean {
    return error instanceof TsqlOperationCancelledError;
}
