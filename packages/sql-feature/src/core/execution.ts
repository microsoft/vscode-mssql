/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Execution failure retained across host/domain boundaries, including uncertain side effects. */
export class SqlExecutionError extends Error {
    constructor(
        message: string,
        public readonly status: string,
        public readonly outcomeCertainty: "known" | "unknown",
    ) {
        super(message);
        this.name = "SqlExecutionError";
    }
}
