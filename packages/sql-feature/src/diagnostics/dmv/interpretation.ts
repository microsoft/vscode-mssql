/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WaitInvestigationCategory =
    | "locking"
    | "dataIo"
    | "logIo"
    | "client"
    | "cpu"
    | "parallelism"
    | "workers"
    | "memory"
    | "unknown";

export type DmvFindingId =
    | "dmv.overview.activity-observed"
    | "dmv.overview.blocking-observed"
    | "dmv.blocking.relationships-observed"
    | "dmv.blocking.cycle-observed"
    | "dmv.blocking.invisible-parent"
    | "dmv.blocking.special-identifier"
    | "dmv.workload.cache-observation"
    | `dmv.wait.category.${WaitInvestigationCategory}`
    | "dmv.storage.read-not-measured"
    | "dmv.storage.write-not-measured"
    | "dmv.index.candidate";

export interface DmvEvidenceReference {
    readonly rowIndex: number;
    readonly fields: readonly string[];
}

export interface DmvFinding {
    readonly id: DmvFindingId;
    readonly version: 1;
    readonly severity: "info" | "caution" | "attention";
    readonly category: "activity" | "blocking" | "workload" | "waits" | "storage" | "indexes";
    readonly evidence: readonly DmvEvidenceReference[];
    readonly metrics: Readonly<Record<string, number>>;
    readonly applicability: "observed" | "limited";
    readonly uncertainty: readonly string[];
    readonly nextSteps: readonly string[];
}

export type DmvBlockingTreeNodeStatus = "visible" | "cycle" | "invisible" | "special";

export interface DmvBlockingTreeNode {
    readonly rowIndex: number;
    readonly sessionId?: number;
    readonly blockerId?: number;
    readonly level: number;
    readonly status: DmvBlockingTreeNodeStatus;
    readonly children: readonly DmvBlockingTreeNode[];
}

/** Builds a finite blocker-first tree without fabricating parents for missing DMV rows. */
export function dmvBlockingTree(
    rows: readonly Record<string, unknown>[],
): readonly DmvBlockingTreeNode[] {
    const parentByRow = rows.map((row, rowIndex) => {
        const blockerId = integer(row.blocking_session_id);
        if (blockerId === undefined || blockerId < 0) return undefined;
        return rows.findIndex(
            (candidate, candidateIndex) =>
                candidateIndex !== rowIndex && integer(candidate.session_id) === blockerId,
        );
    });
    const childrenByRow = rows.map(() => [] as number[]);
    const roots: number[] = [];
    parentByRow.forEach((parentIndex, rowIndex) => {
        if (parentIndex === undefined || parentIndex < 0) roots.push(rowIndex);
        else childrenByRow[parentIndex].push(rowIndex);
    });
    const visited = new Set<number>();
    const rootIndexes = [...roots];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        if (!rootIndexes.includes(rowIndex) && !hasAncestor(rowIndex, parentByRow)) {
            rootIndexes.push(rowIndex);
        }
    }

    const build = (
        rowIndex: number,
        level: number,
        path: ReadonlySet<number>,
    ): DmvBlockingTreeNode => {
        const row = rows[rowIndex];
        const sessionId = integer(row.session_id);
        const blockerId = integer(row.blocking_session_id);
        const chainStatus = text(row.chain_status);
        const status: DmvBlockingTreeNodeStatus =
            blockerId !== undefined && blockerId < 0
                ? "special"
                : path.has(rowIndex) || chainStatus?.includes("cycle")
                  ? "cycle"
                  : chainStatus?.includes("not visible")
                    ? "invisible"
                    : "visible";
        if (path.has(rowIndex)) {
            return { rowIndex, sessionId, blockerId, level, status: "cycle", children: [] };
        }
        const nextPath = new Set(path);
        nextPath.add(rowIndex);
        visited.add(rowIndex);
        return {
            rowIndex,
            sessionId,
            blockerId,
            level,
            status,
            children: childrenByRow[rowIndex]
                .filter((childIndex) => !nextPath.has(childIndex))
                .map((childIndex) => build(childIndex, level + 1, nextPath)),
        };
    };

    const tree = rootIndexes.map((rowIndex) => build(rowIndex, 1, new Set<number>()));
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        if (!visited.has(rowIndex)) tree.push(build(rowIndex, 1, new Set<number>()));
    }
    return tree;
}

/** Investigation categories, not diagnoses or automatic remediation rules. */
export function waitInvestigation(waitType: string): WaitInvestigationCategory {
    const wait = waitType.toUpperCase();
    if (wait.startsWith("LCK_M_")) return "locking";
    if (wait.startsWith("PAGEIOLATCH_")) return "dataIo";
    if (wait === "WRITELOG") return "logIo";
    if (wait === "ASYNC_NETWORK_IO") return "client";
    if (wait === "SOS_SCHEDULER_YIELD") return "cpu";
    if (["CXPACKET", "CXCONSUMER", "CXSYNC_PORT", "CXSYNC_CONSUMER"].includes(wait))
        return "parallelism";
    if (wait === "THREADPOOL") return "workers";
    if (wait === "RESOURCE_SEMAPHORE") return "memory";
    return "unknown";
}

export function dmvFindings(
    queryId: string,
    rows: readonly Record<string, unknown>[],
): readonly DmvFinding[] {
    switch (queryId) {
        case "dmv.overview":
            return overviewFindings(rows);
        case "dmv.blockingChain":
            return blockingFindings(rows);
        case "dmv.topWorkload":
        case "dmv.topQueriesByDuration":
        case "dmv.topQueriesByCpu":
        case "dmv.topQueriesByReads":
            return workloadFindings(rows);
        case "dmv.waitStats":
        case "dmv.waitStatsAzure":
            return waitFindings(rows);
        case "dmv.fileIoStalls":
            return storageFindings(rows);
        case "dmv.missingIndexes":
            return indexFindings(rows);
        default:
            return [];
    }
}

function overviewFindings(rows: readonly Record<string, unknown>[]): readonly DmvFinding[] {
    const row = rows[0];
    if (!row) return [];
    const active = numeric(row.active_requests) ?? 0;
    const blocked = numeric(row.blocked_requests) ?? 0;
    const findings: DmvFinding[] = [];
    if (active > 0) {
        findings.push({
            id: "dmv.overview.activity-observed",
            version: 1,
            severity: "info",
            category: "activity",
            evidence: [{ rowIndex: 0, fields: ["active_requests", "observed_at"] }],
            metrics: { activeRequests: active },
            applicability: "observed",
            uncertainty: ["pointInTime"],
            nextSteps: ["dmv.inspectRequests", "dmv.compareRetainedHistory"],
        });
    }
    if (blocked > 0) {
        findings.push({
            id: "dmv.overview.blocking-observed",
            version: 1,
            severity: "attention",
            category: "blocking",
            evidence: [{ rowIndex: 0, fields: ["blocked_requests", "observed_at"] }],
            metrics: { blockedRequests: blocked },
            applicability: "observed",
            uncertainty: ["pointInTime", "relationshipDetailsNotCollected"],
            nextSteps: ["dmv.inspectBlocking"],
        });
    }
    return findings;
}

function blockingFindings(rows: readonly Record<string, unknown>[]): readonly DmvFinding[] {
    if (rows.length === 0) return [];
    const fields = ["session_id", "blocking_session_id", "relationship", "chain_status"];
    const references = rows.map((row, rowIndex) => ({ row, rowIndex }));
    const cycles = references.filter(({ row }) => text(row.chain_status)?.includes("cycle"));
    const invisible = references.filter(({ row }) =>
        text(row.chain_status)?.includes("not visible"),
    );
    const special = references.filter(({ row }) => {
        const blocker = numeric(row.blocking_session_id);
        return blocker !== undefined && blocker < 0;
    });
    const maxDepth = references.reduce(
        (maximum, { row }) => Math.max(maximum, numeric(row.level) ?? 0),
        0,
    );
    const findings: DmvFinding[] = [
        {
            id: "dmv.blocking.relationships-observed",
            version: 1,
            severity: "attention",
            category: "blocking",
            evidence: references.map(({ rowIndex }) => ({ rowIndex, fields })),
            metrics: { relationships: rows.length, maxDepth },
            applicability: "observed",
            uncertainty: ["pointInTime"],
            nextSteps: ["dmv.inspectRequests", "dmv.inspectTransactionContext"],
        },
    ];
    if (cycles.length > 0) {
        findings.push({
            id: "dmv.blocking.cycle-observed",
            version: 1,
            severity: "attention",
            category: "blocking",
            evidence: cycles.map(({ rowIndex }) => ({
                rowIndex,
                fields: ["chain_status", "session_id"],
            })),
            metrics: { rows: cycles.length },
            applicability: "limited",
            uncertainty: ["cycleContextIsBounded"],
            nextSteps: ["dmv.inspectRequests"],
        });
    }
    if (invisible.length > 0) {
        findings.push({
            id: "dmv.blocking.invisible-parent",
            version: 1,
            severity: "caution",
            category: "blocking",
            evidence: invisible.map(({ rowIndex }) => ({
                rowIndex,
                fields: ["chain_status", "blocking_session_id"],
            })),
            metrics: { rows: invisible.length },
            applicability: "limited",
            uncertainty: ["parentNotVisible"],
            nextSteps: ["dmv.inspectRequests", "dmv.reviewPermissionScope"],
        });
    }
    if (special.length > 0) {
        findings.push({
            id: "dmv.blocking.special-identifier",
            version: 1,
            severity: "caution",
            category: "blocking",
            evidence: special.map(({ rowIndex }) => ({
                rowIndex,
                fields: ["blocking_session_id", "relationship"],
            })),
            metrics: { rows: special.length },
            applicability: "limited",
            uncertainty: ["specialBlockerIdentity"],
            nextSteps: ["dmv.inspectRequests"],
        });
    }
    return findings;
}

function workloadFindings(rows: readonly Record<string, unknown>[]): readonly DmvFinding[] {
    const row = rows[0];
    if (!row) return [];
    return [
        {
            id: "dmv.workload.cache-observation",
            version: 1,
            severity: "info",
            category: "workload",
            evidence: [{ rowIndex: 0, fields: ["executions", "last_execution_time", "sql_text"] }],
            metrics: {
                executions: numeric(row.executions) ?? 0,
                rows: rows.length,
            },
            applicability: "limited",
            uncertainty: ["planCacheSinceCompilation", "evictionOrRecompileCanRemoveEvidence"],
            nextSteps: ["dmv.compareRetainedHistory", "dmv.inspectQueryText"],
        },
    ];
}

function waitFindings(rows: readonly Record<string, unknown>[]): readonly DmvFinding[] {
    const groups = new Map<WaitInvestigationCategory, DmvEvidenceReference[]>();
    const totals = new Map<WaitInvestigationCategory, number>();
    rows.forEach((row, rowIndex) => {
        const waitType = text(row.wait_type);
        if (!waitType) return;
        const category = waitInvestigation(waitType);
        const evidence = groups.get(category) ?? [];
        evidence.push({ rowIndex, fields: ["wait_type", "wait_time_ms", "pct_of_total"] });
        groups.set(category, evidence);
        totals.set(category, (totals.get(category) ?? 0) + (numeric(row.wait_time_ms) ?? 0));
    });
    return [...groups.entries()].map(([category, evidence]) => ({
        id: `dmv.wait.category.${category}`,
        version: 1,
        severity: category === "unknown" ? "caution" : "info",
        category: "waits",
        evidence,
        metrics: { waitTimeMs: totals.get(category) ?? 0, rows: evidence.length },
        applicability: "limited",
        uncertainty: ["cumulativeTaskWaits", "waitShareUsesIncludedRows"],
        nextSteps: category === "locking" ? ["dmv.inspectBlocking"] : ["dmv.inspectWorkload"],
    }));
}

function storageFindings(rows: readonly Record<string, unknown>[]): readonly DmvFinding[] {
    const findings: DmvFinding[] = [];
    const readUnmeasured = rows
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => text(row.read_latency_status) === "not measured");
    const writeUnmeasured = rows
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => text(row.write_latency_status) === "not measured");
    if (readUnmeasured.length > 0) {
        findings.push({
            id: "dmv.storage.read-not-measured",
            version: 1,
            severity: "caution",
            category: "storage",
            evidence: readUnmeasured.map(({ rowIndex }) => ({
                rowIndex,
                fields: ["num_of_reads", "read_latency_status"],
            })),
            metrics: { files: readUnmeasured.length },
            applicability: "limited",
            uncertainty: ["readLatencyUnavailable"],
            nextSteps: ["dmv.inspectWorkload"],
        });
    }
    if (writeUnmeasured.length > 0) {
        findings.push({
            id: "dmv.storage.write-not-measured",
            version: 1,
            severity: "caution",
            category: "storage",
            evidence: writeUnmeasured.map(({ rowIndex }) => ({
                rowIndex,
                fields: ["num_of_writes", "write_latency_status"],
            })),
            metrics: { files: writeUnmeasured.length },
            applicability: "limited",
            uncertainty: ["writeLatencyUnavailable"],
            nextSteps: ["dmv.inspectWorkload"],
        });
    }
    return findings;
}

function indexFindings(rows: readonly Record<string, unknown>[]): readonly DmvFinding[] {
    if (rows.length === 0) return [];
    return [
        {
            id: "dmv.index.candidate",
            version: 1,
            severity: "caution",
            category: "indexes",
            evidence: rows.map((_, rowIndex) => ({
                rowIndex,
                fields: ["improvement_measure", "table_name"],
            })),
            metrics: { candidates: rows.length },
            applicability: "limited",
            uncertainty: ["countersSinceReset", "writeCostAndOverlapNotEvaluated"],
            nextSteps: ["dmv.inspectWorkload", "dmv.reviewExistingIndexes"],
        },
    ];
}

function numeric(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function text(value: unknown): string | undefined {
    return typeof value === "string" ? value.toLowerCase() : undefined;
}

function integer(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
}

function hasAncestor(rowIndex: number, parentByRow: readonly (number | undefined)[]): boolean {
    const seen = new Set<number>();
    let current = parentByRow[rowIndex];
    while (current !== undefined && current >= 0 && !seen.has(current)) {
        seen.add(current);
        current = parentByRow[current];
    }
    return current !== undefined && current >= 0;
}
