/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ResultAccessGate + gated access facade (C2D-5, addendum §1.3/§1.4).
 *
 * The GATE is the security seam, not the tool: every value-bearing read
 * (any output byte derived verbatim from a cell value — rows, samples,
 * topK/min/max, groupBy keys, auto-histogram boundaries) requires a
 * ResultAccessGrant minted AFTER user consent. Enforcement lives HERE, so a
 * buggy or hostile caller that skips the consent UI still cannot read
 * values. Metadata (counts, schema, digests) flows freely per the plan's
 * schema-context posture.
 *
 * Grants are crypto-random, single-use, short-expiry, and owner-scoped.
 * Owner scoping is BEST-EFFORT accident prevention, not an adversary
 * boundary (§1.8) — unguessable snapshot ids + this gate are the primary
 * controls. Every mint/denial is a diagnostics event; grant ids and
 * outcomes are loggable, cell values and filter literals never are.
 */

import * as crypto from "crypto";
import { Perf } from "../perf/perfTelemetry";
import { QsCellWindow } from "../sharedInterfaces/queryStudio";
import { QueryResultAccessService } from "./queryResultAccessService";
import { QueryResultsParams } from "./queryResultsParams";
import { QueryResultAccessError, QueryResultSnapshotLease } from "./queryResultTypes";
import { TransformResult } from "./transformEngine";
import { TransformSpec, transformOutputClass } from "./transformSpec";

export type ResultAccessOperationClass = "values" | "sqlText" | "messageText" | "export";

export interface ResultAccessGrant {
    readonly grantId: string;
    readonly snapshotId: string;
    readonly ownerKey: string;
    readonly operationClass: ResultAccessOperationClass;
    readonly expiresEpochMs: number;
    remainingUses: number;
}

/** Single-use, short-lived: consent covers one read, not a session. */
const GRANT_TTL_MS = 2 * 60_000;

export class ResultAccessGate {
    private readonly grants = new Map<string, ResultAccessGrant>();

    constructor(private readonly now: () => number = () => Date.now()) {}

    /** Mint AFTER consent (LM-tool confirmation or the participant's modal). */
    mint(request: {
        snapshotId: string;
        ownerKey: string;
        operationClass: ResultAccessOperationClass;
    }): ResultAccessGrant {
        const grant: ResultAccessGrant = {
            grantId: crypto.randomBytes(12).toString("base64url"),
            snapshotId: request.snapshotId,
            ownerKey: request.ownerKey,
            operationClass: request.operationClass,
            expiresEpochMs: this.now() + GRANT_TTL_MS,
            remainingUses: 1,
        };
        this.grants.set(grant.grantId, grant);
        Perf.marker("mssql.queryResults.grant.minted", "instant", {
            operationClass: grant.operationClass,
        });
        return grant;
    }

    /** Consume exactly once; every mismatch is a counted denial. */
    consume(
        grantId: string | undefined,
        expected: {
            snapshotId: string;
            ownerKey: string;
            operationClass: ResultAccessOperationClass;
        },
    ): { ok: boolean; reason?: string } {
        const deny = (reason: string): { ok: false; reason: string } => {
            Perf.marker("mssql.queryResults.grant.denied", "instant", {
                operationClass: expected.operationClass,
                reason,
            });
            return { ok: false, reason };
        };
        if (!grantId) {
            return deny("missingGrant");
        }
        const grant = this.grants.get(grantId);
        if (!grant) {
            return deny("unknownGrant");
        }
        if (this.now() > grant.expiresEpochMs) {
            this.grants.delete(grantId);
            return deny("expired");
        }
        if (
            grant.snapshotId !== expected.snapshotId ||
            grant.ownerKey !== expected.ownerKey ||
            grant.operationClass !== expected.operationClass
        ) {
            return deny("scopeMismatch");
        }
        if (grant.remainingUses <= 0) {
            this.grants.delete(grantId);
            return deny("consumed");
        }
        grant.remainingUses--;
        if (grant.remainingUses <= 0) {
            this.grants.delete(grantId);
        }
        return { ok: true };
    }
}

/** Typed refusal the tool/participant translate into a consent round-trip. */
export class ResultAccessDenied extends Error {
    constructor(
        readonly operationClass: ResultAccessOperationClass,
        readonly denialReason: string,
    ) {
        super(
            `This operation returns ${operationClass}-class data and requires user confirmation (${denialReason}).`,
        );
        this.name = "ResultAccessDenied";
    }
}

/**
 * The ONLY result-access surface AI consumers receive. Metadata operations
 * pass through; value-bearing operations verify a grant IN HERE. Also owns
 * the per-owner resource caps (addendum §4.4): max snapshots per owner and
 * one transform at a time (queue via refusal, not buffering).
 */
export class GatedQueryResultAccess {
    private readonly ownerSnapshots = new Map<string, Set<string>>();
    private evaluating = 0;

    constructor(
        private readonly service: QueryResultAccessService,
        private readonly gate: ResultAccessGate,
        private readonly params: () => QueryResultsParams,
    ) {}

    listLiveSources() {
        return this.service.listLiveSources();
    }

    listSnapshots() {
        return this.service.listSnapshots();
    }

    describeSnapshot(snapshotId: string) {
        return this.service.describeSnapshot(snapshotId);
    }

    async createSnapshot(request: {
        ownerKey: string;
        sourceId: string;
        reason: string;
    }): Promise<QueryResultSnapshotLease> {
        this.enforceSnapshotCap(request.ownerKey);
        const lease = await this.service.createSnapshot({
            owner: { kind: "aiTool", ownerKey: request.ownerKey, label: request.reason },
            reason: request.reason,
            sourceId: request.sourceId,
            scope: { kind: "allCompleteResultSets" },
            includeMessages: "summary",
            includeQueryText: "digest",
        });
        this.trackOwnerSnapshot(request.ownerKey, lease.snapshotId);
        // The tool holds handles, not leases: release immediately — the
        // snapshot idles under the AI TTL and the sweep owns its end of life.
        lease.dispose();
        return lease;
    }

    async deriveSnapshot(spec: TransformSpec, ownerKey: string): Promise<string> {
        this.enforceSnapshotCap(ownerKey);
        const lease = await this.service.deriveSnapshot(spec, { kind: "aiTool", ownerKey });
        this.trackOwnerSnapshot(ownerKey, lease.snapshotId);
        lease.dispose();
        return lease.snapshotId;
    }

    releaseSnapshot(snapshotId: string, ownerKey: string): void {
        const owned = this.ownerSnapshots.get(ownerKey);
        if (owned?.delete(snapshotId)) {
            this.service.disposeUnleasedSnapshot(snapshotId, "aiReleased");
        }
    }

    /**
     * Evaluate a transform. Aggregate-numeric output flows without a grant;
     * ANY values-class output requires one — computed from the spec (§1.4),
     * enforced here regardless of what the caller claims.
     */
    async evaluateTransform(
        spec: TransformSpec,
        context: { ownerKey: string; grantId?: string; isCancelled?: () => boolean },
    ): Promise<TransformResult> {
        if (transformOutputClass(spec) === "values") {
            const verdict = this.gate.consume(context.grantId, {
                snapshotId: spec.source.snapshotId,
                ownerKey: context.ownerKey,
                operationClass: "values",
            });
            if (!verdict.ok) {
                throw new ResultAccessDenied("values", verdict.reason ?? "denied");
            }
        }
        if (this.evaluating >= 1) {
            throw new QueryResultAccessError(
                "storeUnavailable",
                "Another transform is already running for this conversation — retry when it completes.",
            );
        }
        this.evaluating++;
        try {
            return await this.service.evaluateSnapshotTransform(spec, {
                reason: "aiTool",
                ...(context.isCancelled ? { isCancelled: context.isCancelled } : {}),
            });
        } finally {
            this.evaluating--;
        }
    }

    /** Raw window read — always values-class. */
    async getRows(
        request: {
            snapshotId: string;
            resultSetId: string;
            rowStart: number;
            rowCount: number;
        },
        context: { ownerKey: string; grantId?: string },
    ): Promise<QsCellWindow> {
        const verdict = this.gate.consume(context.grantId, {
            snapshotId: request.snapshotId,
            ownerKey: context.ownerKey,
            operationClass: "values",
        });
        if (!verdict.ok) {
            throw new ResultAccessDenied("values", verdict.reason ?? "denied");
        }
        const params = this.params();
        return this.service.getWindow({
            snapshotId: request.snapshotId,
            resultSetId: request.resultSetId,
            rowStart: Math.max(0, request.rowStart),
            rowCount: Math.min(Math.max(1, request.rowCount), params.aiMaxRowsPerResponse),
            reason: "aiTool",
        });
    }

    private enforceSnapshotCap(ownerKey: string): void {
        const owned = this.ownerSnapshots.get(ownerKey);
        if (!owned) {
            return;
        }
        // Drop entries the sweep already disposed.
        for (const snapshotId of [...owned]) {
            if (!this.service.describeSnapshot(snapshotId)) {
                owned.delete(snapshotId);
            }
        }
        if (owned.size >= this.params().aiMaxSnapshotsPerConversation) {
            throw new QueryResultAccessError(
                "retentionBudgetExceeded",
                `This conversation already holds ${owned.size} snapshots — release one first (release_snapshot).`,
            );
        }
    }

    private trackOwnerSnapshot(ownerKey: string, snapshotId: string): void {
        const owned = this.ownerSnapshots.get(ownerKey) ?? new Set<string>();
        owned.add(snapshotId);
        this.ownerSnapshots.set(ownerKey, owned);
    }
}
