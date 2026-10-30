/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `mssql.queryResults.showStatus` document (C2D-4, plan §18.3): a pure
 * builder over the access/context services so the whole surface is
 * unit-testable and privacy-checkable in one place. Structural facts only —
 * no row values, no SQL, no message text, no raw URIs.
 */

import { getQueryResultAccessService } from "./queryResultAccessService";
import {
    QueryResultResolvedContext,
    getQueryResultContextService,
} from "./queryResultContextService";
import { GateOutcomeRecord, recentGateOutcomes } from "./resultAccessGate";
import { resolveQueryResultsParams } from "./queryResultsParams";
import { QueryResultAccessStatus } from "./queryResultTypes";

export interface QueryResultsStatusInputs {
    status: QueryResultAccessStatus;
    snapshots: ReadonlyArray<{
        snapshotId: string;
        purpose: string;
        resultSetCount: number;
        totalRows: number;
        leaseCount: number;
        createdEpochMs: number;
    }>;
    context: QueryResultResolvedContext | undefined;
    paramsDigest: string;
    overriddenKeys: readonly string[];
    gateOutcomes?: readonly GateOutcomeRecord[];
}

export function renderQueryResultsStatus(inputs: QueryResultsStatusInputs): string {
    const { status, context } = inputs;
    return JSON.stringify(
        {
            liveSources: status.liveSources,
            snapshots: inputs.snapshots.map((snapshot) => ({
                // Short digest only — full ids stay host-internal.
                id: `${snapshot.snapshotId.slice(0, 12)}…`,
                purpose: snapshot.purpose,
                resultSets: snapshot.resultSetCount,
                rows: snapshot.totalRows,
                leases: snapshot.leaseCount,
                ageSeconds: Math.round((Date.now() - snapshot.createdEpochMs) / 1000),
            })),
            leasesByOwnerKind: status.leasesByOwnerKind,
            retained: {
                stores: status.retainedStores,
                memoryBytes: status.retainedMemoryBytes,
                spillBytes: status.retainedSpillBytes,
            },
            lastSweep: status.lastSweep ?? "never",
            activeContext: context
                ? {
                      kind: context.kind,
                      selectedCells: context.selectedCellCount,
                      selectedRows: context.selectedRowCount,
                      ageSeconds: Math.round((Date.now() - context.updatedEpochMs) / 1000),
                  }
                : "none",
            params: {
                digest: inputs.paramsDigest,
                overriddenKeys: inputs.overriddenKeys,
            },
            // Class + outcome only — grant ids and payloads never surface.
            recentGrantActivity: (inputs.gateOutcomes ?? []).map((record) => ({
                ageSeconds: Math.round((Date.now() - record.atEpochMs) / 1000),
                operationClass: record.operationClass,
                outcome: record.outcome,
            })),
        },
        undefined,
        2,
    );
}

export function buildQueryResultsStatusDocument(): string {
    const service = getQueryResultAccessService();
    const resolved = resolveQueryResultsParams();
    return renderQueryResultsStatus({
        status: service.status(),
        snapshots: service.listSnapshots().map((snapshot) => ({
            snapshotId: snapshot.snapshotId,
            purpose: snapshot.purpose,
            resultSetCount: snapshot.resultSetCount,
            totalRows: snapshot.totalRows,
            leaseCount: snapshot.leaseCount,
            createdEpochMs: snapshot.createdEpochMs,
        })),
        context: getQueryResultContextService().current(),
        paramsDigest: resolved.digest,
        overriddenKeys: resolved.overriddenKeys,
        gateOutcomes: recentGateOutcomes(),
    });
}
