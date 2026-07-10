/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pin helpers (C2D-7): the one host-side implementation behind the webview
 * pin buttons, the `mssql.queryStudio.pinAllResults` palette command, the
 * `@query /pin` command, and the tool's `pin_snapshot` — creating the
 * snapshot and opening the pinned document belong together so a failed open
 * always disposes the snapshot instead of leaking it.
 */

import { getQueryResultAccessService } from "./queryResultAccessService";
import { resolveQueryResultsParams } from "./queryResultsParams";
import { openPinnedResultsDocument } from "./pinnedResultsDocumentProvider";
import { QueryResultAccessError } from "./queryResultTypes";

export interface PinOutcome {
    opened: boolean;
    snapshotId?: string;
    error?: string;
}

/** Freeze a live source's results and open them as a pinned document. */
export async function pinSourceResults(
    sourceId: string,
    scope: { kind: "resultSet"; resultSetId: string } | { kind: "allCompleteResultSets" } = {
        kind: "allCompleteResultSets",
    },
    reason: string = "Pinned from Query Studio",
): Promise<PinOutcome> {
    if (!resolveQueryResultsParams().params.pinnedDocumentsEnabled) {
        return {
            opened: false,
            error: "Pinned result documents are disabled (mssql.queryResults.pinnedDocuments.enabled).",
        };
    }
    try {
        const lease = await getQueryResultAccessService().createSnapshot({
            owner: { kind: "pinnedDocument", label: reason },
            reason,
            sourceId,
            scope,
            includeMessages: "allLocal",
            includeQueryText: "digest",
        });
        try {
            const opened = await openPinnedResultsDocument(lease.snapshotId);
            return opened
                ? { opened, snapshotId: lease.snapshotId }
                : { opened, error: "The pinned results tab could not be opened." };
        } finally {
            lease.dispose();
        }
    } catch (error) {
        return {
            opened: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Open an EXISTING snapshot (e.g. an AI-derived filtered view) as a pinned
 * document. The document's own lease keeps it alive from then on — an
 * aiTool-purpose snapshot graduates out of TTL reach while pinned.
 */
export async function pinExistingSnapshot(snapshotId: string): Promise<PinOutcome> {
    const service = getQueryResultAccessService();
    if (!service.describeSnapshot(snapshotId)) {
        throw new QueryResultAccessError(
            "snapshotNotFound",
            "That snapshot no longer exists — it may have expired.",
        );
    }
    const opened = await openPinnedResultsDocument(snapshotId);
    return opened
        ? { opened, snapshotId }
        : { opened, error: "The pinned results tab could not be opened." };
}
