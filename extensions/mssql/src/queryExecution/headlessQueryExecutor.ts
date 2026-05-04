/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export interface HeadlessQueryCancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => unknown): { dispose(): unknown };
}

export interface HeadlessResultSetData {
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    rowCount: number;
}

export interface HeadlessBatchResult {
    batchSummary: BatchSummary;
    messages: IResultMessage[];
    resultSets: HeadlessResultSetData[];
    hasError: boolean;
}

export interface HeadlessQueryResult {
    batches: HeadlessBatchResult[];
    canceled: boolean;
}

const SUBSET_PAGE_SIZE = 500;

/**
 * Lightweight headless wrapper over the STS query/executeString pipeline.
 *
 * This intentionally avoids QueryRunner because QueryRunner is coupled to
 * editor UI, status-bar state, query panels, and query-editor telemetry.
 */
export class HeadlessQueryExecutor {
    constructor(
        private readonly client: SqlToolsServiceClient,
        private readonly notificationHandler: QueryNotificationHandler,
    ) {}

    async execute(
        ownerUri: string,
        query: string,
        cancellationToken?: HeadlessQueryCancellationToken,
    ): Promise<HeadlessQueryResult> {
        const batchResults = new Map<number, HeadlessBatchResult>();
        let canceled = false;
        let lastStartedBatchId = -1;
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
                void result;
            },
            handleResultSetUpdated(result: QueryExecuteResultSetUpdatedNotificationParams): void {
                void result;
            },
            handleResultSetComplete(result: QueryExecuteResultSetCompleteNotificationParams): void {
                const batchEntry = batchResults.get(result.resultSetSummary.batchId);
                if (batchEntry) {
                    while (batchEntry.resultSets.length <= result.resultSetSummary.id) {
                        batchEntry.resultSets.push({
                            columnInfo: [],
                            rows: [],
                            rowCount: 0,
                        });
                    }
                    batchEntry.resultSets[result.resultSetSummary.id] = {
                        columnInfo: result.resultSetSummary.columnInfo,
                        rows: [],
                        rowCount: result.resultSetSummary.rowCount,
                    };
                }
            },
            handleMessage(result: QueryExecuteMessageParams): void {
                const batchId = result.message.batchId;
                const effectiveBatchId =
                    batchId !== undefined && batchId >= 0 ? batchId : lastStartedBatchId;
                const batchEntry =
                    effectiveBatchId >= 0 ? batchResults.get(effectiveBatchId) : undefined;
                if (batchEntry) {
                    batchEntry.messages.push(result.message);
                }
            },
        };

        this.notificationHandler.registerRunner(handler, ownerUri);

        const cancelDisposable = cancellationToken?.onCancellationRequested(async () => {
            canceled = true;
            try {
                const cancelParams: QueryCancelParams = { ownerUri };
                await this.client.sendRequest(QueryCancelRequest.type, cancelParams);
            } catch {
                // Best-effort cancellation.
            }
        });

        try {
            const params = new QueryExecuteStringParams();
            params.ownerUri = ownerUri;
            params.query = query;
            await this.client.sendRequest(QueryExecuteStringRequest.type, params);

            await completion.promise;

            if (!canceled) {
                await this.fetchAllRows(ownerUri, batchResults);
            }

            const orderedBatches: HeadlessBatchResult[] = [];
            for (const [, batch] of [...batchResults.entries()].sort(([a], [b]) => a - b)) {
                orderedBatches.push(batch);
            }

            return { batches: orderedBatches, canceled };
        } finally {
            cancelDisposable?.dispose();
            this.notificationHandler.unregisterRunner(ownerUri);

            try {
                const disposeParams = new QueryDisposeParams();
                disposeParams.ownerUri = ownerUri;
                await this.client.sendRequest(QueryDisposeRequest.type, disposeParams);
            } catch {
                // Best-effort dispose.
            }
        }
    }

    private async fetchAllRows(
        ownerUri: string,
        batchResults: Map<number, HeadlessBatchResult>,
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
