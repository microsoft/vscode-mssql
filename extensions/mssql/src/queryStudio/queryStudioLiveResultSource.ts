/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryStudioLiveResultSource (C2D-1, plan §9.1): the adapter that exposes a
 * Query Studio document model to the QueryResultAccessService as a live
 * result source. Models register themselves on creation and deregister on
 * dispose — the service never scans provider registries, and tool/chat code
 * never touches ExecutionHost directly.
 *
 * Save As transplants re-key the model; title and URI digest are computed
 * per call so a transplanted source stays truthful without re-registration.
 */

import * as crypto from "crypto";
import * as path from "path";
import {
    LiveQueryResultSource,
    LiveQueryResultState,
    QueryResultSetFrozenSummary,
} from "../queryResults/queryResultTypes";
import { sourceUriDigest } from "../queryResults/queryResultAccessService";
import { QsMessageRow } from "../sharedInterfaces/queryStudio";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";

export class QueryStudioLiveResultSource implements LiveQueryResultSource {
    readonly sourceId = `qsrc_${crypto.randomBytes(9).toString("base64url")}`;
    readonly sourceKind = "queryStudio" as const;

    constructor(private readonly model: QueryStudioDocumentModel) {}

    sourceTitle(): string {
        const uri = this.model.backingDocument.uri;
        if (this.model.backingDocument.isUntitled) {
            return `Untitled query (${uri.path})`;
        }
        return path.basename(uri.path);
    }

    sourceUriDigest(): string {
        return sourceUriDigest(this.model.uriKey);
    }

    state(): LiveQueryResultState {
        const host = this.model.executionHost;
        const results = host.resultsState();
        const resultSets: QueryResultSetFrozenSummary[] = results.resultSets.map((summary) => ({
            resultSetId: summary.resultSetId,
            ...(summary.batchOrdinal !== undefined ? { batchOrdinal: summary.batchOrdinal } : {}),
            columnNames: summary.columnNames,
            ...(summary.columns ? { columns: summary.columns } : {}),
            rowCount: summary.rowCount,
            complete: summary.complete === true,
            ...(summary.truncatedReason ? { truncatedReason: summary.truncatedReason } : {}),
            corrupt: false, // the store summary is authoritative at freeze time
            ...(summary.isPlanResult ? { isPlanResult: true } : {}),
        }));
        return {
            streaming: results.streaming,
            ...(host.retainedStore ? { runId: host.retainedStore.runId } : {}),
            resultSets,
        };
    }

    currentStore() {
        return this.model.executionHost.retainedStore;
    }

    messagesSnapshot(): readonly QsMessageRow[] {
        return this.model.executionHost.getMessages().messages;
    }

    queryText(): string | undefined {
        return this.model.executionHost.lastRunSql;
    }

    runRecordId(): string | undefined {
        return this.model.executionHost.retainedStore?.runRecordId;
    }

    tuning(): { digest?: string; profileId?: string } {
        const tuning = this.model.executionHost.currentTuning;
        return {
            ...(tuning?.digest ? { digest: tuning.digest } : {}),
            ...(tuning?.profileId ? { profileId: tuning.profileId } : {}),
        };
    }
}
