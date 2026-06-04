/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    HeadlessBatchResult,
    HeadlessQueryExecutor,
    HeadlessQueryResult,
    HeadlessResultSetData,
} from "../queryExecution/headlessQueryExecutor";

export type NotebookResultSetData = HeadlessResultSetData;
export type NotebookBatchResult = HeadlessBatchResult;
export type NotebookQueryResult = HeadlessQueryResult;

// Keep the notebook-facing type name stable while sharing the headless STS
// query/executeString pipeline with non-editor consumers.
export class NotebookQueryExecutor extends HeadlessQueryExecutor {}
