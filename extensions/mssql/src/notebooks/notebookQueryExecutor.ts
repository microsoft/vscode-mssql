/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    IQueryEventHandler,
    QueryNotificationHandler,
} from "../controllers/queryNotificationHandler";
import {
    BatchSummary,
    DbCellValue,
    QueryExecuteCompleteNotificationResult,
    QueryExecuteBatchNotificationParams,
    QueryExecuteResultSetAvailableNotificationParams,
    QueryExecuteResultSetUpdatedNotificationParams,
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteMessageParams,
    QueryExecuteStringRequest,
    QueryExecuteStringParams,
    QueryExecuteSubsetRequest,
    QueryExecuteSubsetParams,
} from "../models/contracts/queryExecute";
import { QueryDisposeRequest, QueryDisposeParams } from "../models/contracts/queryDispose";
import { QueryCancelRequest, QueryCancelParams } from "../models/contracts/queryCancel";
import { IDbColumn, IResultMessage } from "../models/interfaces";
import { Deferred } from "../protocol";

export interface NotebookResultSetData {
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    rowCount: number;
}

export interface NotebookBatchResult {
    batchSummary: BatchSummary;
    messages: IResultMessage[];
    resultSets: NotebookResultSetData[];
    hasError: boolean;
}

export interface NotebookQueryResult {
    batches: NotebookBatchResult[];
    canceled: boolean;
}

const SUBSET_PAGE_SIZE = 500;

// Why not reuse QueryRunner? QueryRunner is tightly coupled to the query
// editor: it requires StatusView/VscodeWrapper, fires TelemetryViews.QueryEditor
// events, manages a static runningQueries context for editor toolbar buttons,
// adjusts batch selections by editor line offsets, and exposes results via
// EventEmitters. Notebooks need none of that — just a promise that returns
// batches. Wrapping QueryRunner would mean passing fake dependencies and
// ignoring most of its behavior, for roughly the same amount of code.

/**
 * Lightweight executor that wraps the STS notification flow into a simple
 * promise-based API for notebooks.
 *
 * Usage:
 *   const executor = new NotebookQueryExecutor(client, notificationHandler);
 *   const result = await executor.execute(ownerUri, query, token);
 */
export class NotebookQueryExecutor {
    constructor(
        private readonly client: SqlToolsServiceClient,
        private readonly notificationHandler: QueryNotificationHandler,
        private readonly log?: vscode.LogOutputChannel,
    ) {}

    async execute(
        ownerUri: string,
        query: string,
        cancellationToken?: vscode.CancellationToken,
    ): Promise<NotebookQueryResult> {
        this.log?.info(
            `[QueryExecutor.execute] begin ownerUri=${ownerUri} queryLen=${query.length}`,
        );
        const batchResults = new Map<number, NotebookBatchResult>();
        let canceled = false;
        // Tracks the most recently started batch so that messages with
        // batchId=-1 or undefined (e.g. parse/syntax errors) can be attached
        // to the batch they logically belong to.
        let lastStartedBatchId = -1;

        // Promise that resolves when query/complete arrives
        const completion = new Deferred<QueryExecuteCompleteNotificationResult>();

        const handler: IQueryEventHandler = {
            handleQueryComplete(result: QueryExecuteCompleteNotificationResult): void {
                completion.resolve(result);
            },
            handleBatchStart(result: QueryExecuteBatchNotificationParams): void {
                const batch = result.batchSummary;
                lastStartedBatchId = batch.id;
                batchResults.set(batch.id, {
                    batchSummary: batch,
                    messages: [],
                    resultSets: [],
                    hasError: false,
                });
            },
            handleBatchComplete(result: QueryExecuteBatchNotificationParams): void {
                const entry = batchResults.get(result.batchSummary.id);
                if (entry) {
                    entry.batchSummary = result.batchSummary;
                    entry.hasError = result.batchSummary.hasError;
                }
            },
            handleResultSetAvailable(
                result: QueryExecuteResultSetAvailableNotificationParams,
            ): void {
                // Result set metadata will be captured in handleResultSetComplete
                void result;
            },
            handleResultSetUpdated(result: QueryExecuteResultSetUpdatedNotificationParams): void {
                void result;
            },
            handleResultSetComplete(result: QueryExecuteResultSetCompleteNotificationParams): void {
                // We'll fetch row data after query/complete; just store the summary
                const batchEntry = batchResults.get(result.resultSetSummary.batchId);
                if (batchEntry) {
                    // Initialize the result set slot
                    while (batchEntry.resultSets.length <= result.resultSetSummary.id) {
                        batchEntry.resultSets.push({
                            columnInfo: [],
                            rows: [],
                            rowCount: 0,
                        });
                    }
                    batchEntry.resultSets[result.resultSetSummary.id] = {
                        columnInfo: result.resultSetSummary.columnInfo,
                        rows: [], // will be filled after completion
                        rowCount: result.resultSetSummary.rowCount,
                    };
                }
            },
            handleMessage(result: QueryExecuteMessageParams): void {
                const batchId = result.message.batchId;
                // batchId can be -1 or undefined for query-level messages such
                // as parse/syntax errors that aren't tied to a specific batch.
                // Fall back to the most recently started batch so these errors
                // are surfaced in cell output rather than silently dropped.
                const effectiveBatchId =
                    batchId !== undefined && batchId >= 0 ? batchId : lastStartedBatchId;
                const batchEntry =
                    effectiveBatchId >= 0 ? batchResults.get(effectiveBatchId) : undefined;
                if (batchEntry) {
                    batchEntry.messages.push(result.message);
                }
            },
        };

        // Register handler and set up cancellation
        this.notificationHandler.registerRunner(handler, ownerUri);
        this.log?.info(`[QueryExecutor.execute] handler registered ownerUri=${ownerUri}`);

        const cancelDisposable = cancellationToken?.onCancellationRequested(async () => {
            canceled = true;
            this.log?.info(`[QueryExecutor.execute] cancel requested ownerUri=${ownerUri}`);
            try {
                const cancelParams: QueryCancelParams = { ownerUri };
                await this.client.sendRequest(QueryCancelRequest.type, cancelParams);
            } catch {
                // Best-effort cancellation
            }
        });

        try {
            // Send the execute request
            const params = new QueryExecuteStringParams();
            params.ownerUri = ownerUri;
            params.query = query;
            this.log?.info(
                `[QueryExecutor.execute] sendRequest(QueryExecuteString): begin ownerUri=${ownerUri}`,
            );
            const sendStarted = Date.now();
            await this.client.sendRequest(QueryExecuteStringRequest.type, params);
            this.log?.info(
                `[QueryExecutor.execute] sendRequest(QueryExecuteString): ack after ` +
                    `${Date.now() - sendStarted}ms; waiting for query/complete ownerUri=${ownerUri}`,
            );

            // Wait for query/complete notification
            const waitStarted = Date.now();
            await completion.promise;
            this.log?.info(
                `[QueryExecutor.execute] query/complete received after ` +
                    `${Date.now() - waitStarted}ms ownerUri=${ownerUri}`,
            );

            // Fetch row data for each result set
            if (!canceled) {
                await this.fetchAllRows(ownerUri, batchResults);
            }

            // Build ordered result array
            const orderedBatches: NotebookBatchResult[] = [];
            for (const [, batch] of [...batchResults.entries()].sort(([a], [b]) => a - b)) {
                orderedBatches.push(batch);
            }

            return { batches: orderedBatches, canceled };
        } finally {
            cancelDisposable?.dispose();
            this.notificationHandler.unregisterRunner(ownerUri);

            // Dispose the query to free STS resources
            try {
                const disposeParams = new QueryDisposeParams();
                disposeParams.ownerUri = ownerUri;
                await this.client.sendRequest(QueryDisposeRequest.type, disposeParams);
            } catch {
                // Best-effort dispose
            }
        }
    }

    private async fetchAllRows(
        ownerUri: string,
        batchResults: Map<number, NotebookBatchResult>,
    ): Promise<void> {
        for (const [batchIndex, batch] of batchResults) {
            for (let rsIndex = 0; rsIndex < batch.resultSets.length; rsIndex++) {
                const rs = batch.resultSets[rsIndex];
                if (rs.rowCount === 0) {
                    continue;
                }
                rs.rows = await this.fetchRows(ownerUri, batchIndex, rsIndex, rs.rowCount);
            }
        }
    }

    private async fetchRows(
        ownerUri: string,
        batchIndex: number,
        resultSetIndex: number,
        totalRows: number,
    ): Promise<DbCellValue[][]> {
        const allRows: DbCellValue[][] = [];
        let rowStart = 0;

        while (rowStart < totalRows) {
            const rowsToFetch = Math.min(SUBSET_PAGE_SIZE, totalRows - rowStart);
            const params = new QueryExecuteSubsetParams();
            params.ownerUri = ownerUri;
            params.batchIndex = batchIndex;
            params.resultSetIndex = resultSetIndex;
            params.rowsStartIndex = rowStart;
            params.rowsCount = rowsToFetch;

            const result = await this.client.sendRequest(QueryExecuteSubsetRequest.type, params);
            const pageRows = result?.resultSubset?.rows ?? [];
            allRows.push(...pageRows);

            if (pageRows.length === 0) {
                break;
            }
            rowStart += pageRows.length;
        }

        return allRows;
    }
}
