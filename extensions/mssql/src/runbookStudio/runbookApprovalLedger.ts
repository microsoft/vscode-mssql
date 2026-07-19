/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable approval identity records for effectful Runbook Studio activities.
 * A decision is useful only for the exact plan, activity version, resolved
 * binding digest, target fingerprint, effect summary, and policy version that
 * the user reviewed. Any drift produces a different challenge digest.
 *
 * Layout: <root>/approvals/<sha256(approvalId)>.json
 *
 * The record intentionally contains digests, opaque IDs, and actor class only;
 * never parameter values, target labels, SQL, credentials, or model content.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { RunbookArtifactFile, RunbookPlanNode } from "../sharedInterfaces/runbookStudio";
import { findActivity } from "./activities/activityCatalog";
import { canonicalRunbookJson, digestRunbookValue } from "./runbookDigest";

export const RUNBOOK_APPROVAL_SCHEMA_VERSION = 1 as const;

export interface RunbookApprovalChallenge {
    approvalId: string;
    runId: string;
    gateNodeId: string;
    activityNodeId: string;
    activityKind: string;
    activityVersion: number;
    attempt: number;
    planRevision: string;
    planHash: string;
    resolvedArgumentDigest: string;
    targetFingerprint: string;
    effectSummaryDigest: string;
    previewDigest?: string;
    policyVersion: string;
}

export interface RunbookApprovalDecision {
    outcome: "approved" | "rejected";
    /** Honest actor class; VS Code does not expose a stable signed user id. */
    actorKind: "interactiveVscodeUser";
    decidedEpochMs: number;
}

export interface RunbookApprovalRecord {
    schemaVersion: typeof RUNBOOK_APPROVAL_SCHEMA_VERSION;
    challenge: RunbookApprovalChallenge;
    challengeDigest: string;
    requestedEpochMs: number;
    decision?: RunbookApprovalDecision;
    decisionDigest?: string;
}

export interface RunbookApprovalEvidence {
    approvalId: string;
    approvalDigest: string;
}

export class RunbookApprovalLedgerError extends Error {
    constructor(
        public readonly kind:
            | "invalidChallenge"
            | "challengeMismatch"
            | "decisionMismatch"
            | "recordCorrupt",
        message: string,
    ) {
        super(message);
        this.name = "RunbookApprovalLedgerError";
    }
}

export class RunbookApprovalLedger {
    private readonly approvalsDir: string;

    constructor(storageRoot: string) {
        this.approvalsDir = path.join(storageRoot, "approvals");
        fs.mkdirSync(this.approvalsDir, { recursive: true });
    }

    public requestApproval(
        challenge: RunbookApprovalChallenge,
        epochMs = Date.now(),
    ): RunbookApprovalRecord {
        validateChallenge(challenge);
        const record: RunbookApprovalRecord = {
            schemaVersion: RUNBOOK_APPROVAL_SCHEMA_VERSION,
            challenge,
            challengeDigest: digestRunbookValue(challenge),
            requestedEpochMs: epochMs,
        };
        const filePath = this.filePath(challenge.approvalId);
        try {
            writeNewDurableRecord(filePath, record);
            return record;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                throw error;
            }
            const existing = this.read(challenge.approvalId);
            if (!existing || existing.challengeDigest !== record.challengeDigest) {
                throw new RunbookApprovalLedgerError(
                    "challengeMismatch",
                    `approval '${challenge.approvalId}' is already bound to another challenge`,
                );
            }
            return existing;
        }
    }

    /** Persist the decision before releasing the runtime gate. */
    public decide(
        approvalId: string,
        outcome: RunbookApprovalDecision["outcome"],
        epochMs = Date.now(),
    ): RunbookApprovalRecord {
        const existing = this.read(approvalId);
        if (!existing) {
            throw new RunbookApprovalLedgerError(
                "recordCorrupt",
                `approval '${approvalId}' has no durable challenge`,
            );
        }
        const decision: RunbookApprovalDecision = {
            outcome,
            actorKind: "interactiveVscodeUser",
            decidedEpochMs: epochMs,
        };
        if (existing.decision) {
            if (
                existing.decision.outcome !== outcome ||
                existing.decision.actorKind !== decision.actorKind
            ) {
                throw new RunbookApprovalLedgerError(
                    "decisionMismatch",
                    `approval '${approvalId}' already has a different decision`,
                );
            }
            return existing;
        }
        const decisionDigest = digestRunbookValue({
            challengeDigest: existing.challengeDigest,
            decision,
        });
        const decided: RunbookApprovalRecord = {
            ...existing,
            decision,
            decisionDigest,
        };
        replaceDurableRecord(this.filePath(approvalId), decided);
        return decided;
    }

    public approvedEvidence(
        approvalId: string,
        expectedChallengeDigest?: string,
    ): RunbookApprovalEvidence | undefined {
        const record = this.read(approvalId);
        if (
            !record ||
            record.decision?.outcome !== "approved" ||
            !record.decisionDigest ||
            (expectedChallengeDigest !== undefined &&
                record.challengeDigest !== expectedChallengeDigest)
        ) {
            return undefined;
        }
        return { approvalId, approvalDigest: record.decisionDigest };
    }

    public read(approvalId: string): RunbookApprovalRecord | undefined {
        const filePath = this.filePath(approvalId);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        let record: RunbookApprovalRecord;
        try {
            record = JSON.parse(fs.readFileSync(filePath, "utf8")) as RunbookApprovalRecord;
        } catch {
            throw new RunbookApprovalLedgerError(
                "recordCorrupt",
                `approval '${approvalId}' is unreadable`,
            );
        }
        validateRecord(record, approvalId);
        return record;
    }

    public listPending(): RunbookApprovalRecord[] {
        const pending: RunbookApprovalRecord[] = [];
        let files: string[];
        try {
            files = fs.readdirSync(this.approvalsDir).filter((file) => file.endsWith(".json"));
        } catch {
            return pending;
        }
        for (const fileName of files.sort((left, right) => left.localeCompare(right))) {
            try {
                const record = JSON.parse(
                    fs.readFileSync(path.join(this.approvalsDir, fileName), "utf8"),
                ) as RunbookApprovalRecord;
                validateRecord(record, record.challenge?.approvalId);
                if (!record.decision) {
                    pending.push(record);
                }
            } catch {
                // A corrupt record is never treated as approval. Diagnostics
                // and operator recovery surface this in the owning workflow.
            }
        }
        return pending;
    }

    public deleteApprovalsForRun(runId: string): number {
        let deleted = 0;
        let files: string[];
        try {
            files = fs.readdirSync(this.approvalsDir).filter((file) => file.endsWith(".json"));
        } catch {
            return deleted;
        }
        for (const fileName of files) {
            const filePath = path.join(this.approvalsDir, fileName);
            try {
                const record = JSON.parse(
                    fs.readFileSync(filePath, "utf8"),
                ) as RunbookApprovalRecord;
                validateRecord(record, record.challenge?.approvalId);
                if (record.challenge.runId === runId) {
                    fs.rmSync(filePath, { force: true });
                    deleted++;
                }
            } catch {
                // Never delete an approval that cannot be attributed safely.
            }
        }
        return deleted;
    }

    private filePath(approvalId: string): string {
        const digest = crypto.createHash("sha256").update(approvalId, "utf8").digest("hex");
        return path.join(this.approvalsDir, `${digest}.json`);
    }
}

/**
 * Build the exact approval challenge for a gate's single approved activity
 * successor. Returns undefined for non-effect gates or ambiguous graph shapes.
 */
export function buildRunbookApprovalChallenge(input: {
    runId: string;
    artifact: RunbookArtifactFile;
    parameterValues: Record<string, string | number | boolean | null>;
    gateNodeId: string;
    attempt?: number;
    /** In-memory scalar outputs already observed for this run. They let a
     * later gate bind to an exact provisioned lease or preview digest. */
    nodeValues?: ReadonlyMap<string, Readonly<Record<string, number | string | boolean>>>;
}): RunbookApprovalChallenge | undefined {
    const lock = input.artifact.lock;
    if (!lock) {
        return undefined;
    }
    const successorIds = lock.edges
        .filter((edge) => edge.from === input.gateNodeId && edge.when === "approved")
        .map((edge) => edge.to);
    if (successorIds.length !== 1) {
        return undefined;
    }
    const node = lock.nodes.find((candidate) => candidate.id === successorIds[0]);
    if (!node || node.kind !== "activity") {
        return undefined;
    }
    const descriptor = findActivity(node.activityKind);
    if (!descriptor || descriptor.blastRadius.operation === "read") {
        return undefined;
    }
    const attempt = input.attempt ?? 1;
    const resolvedInputs = resolveApprovalInputs(node, input.parameterValues, input.nodeValues);
    const targetBindingValue =
        descriptor.target && "bindingInput" in descriptor.target
            ? resolvedInputs[descriptor.target.bindingInput]
            : undefined;
    const approvalId = `approval-${digestRunbookValue({
        runId: input.runId,
        gateNodeId: input.gateNodeId,
        activityNodeId: node.id,
        attempt,
    }).slice("sha256:".length)}`;
    return {
        approvalId,
        runId: input.runId,
        gateNodeId: input.gateNodeId,
        activityNodeId: node.id,
        activityKind: descriptor.kind,
        activityVersion: descriptor.version,
        attempt,
        planRevision: lock.planRevision,
        planHash: lock.planHash,
        resolvedArgumentDigest: digestRunbookValue(resolvedInputs),
        targetFingerprint: digestRunbookValue({
            targetKind: node.target?.kind,
            binding: node.target?.binding,
            resolvedValue: targetBindingValue,
        }),
        effectSummaryDigest: digestRunbookValue({
            kind: descriptor.kind,
            version: descriptor.version,
            blastRadius: descriptor.blastRadius,
            outputContract: descriptor.outputContract,
        }),
        policyVersion: "runbook-policy/1",
    };
}

function resolveApprovalInputs(
    node: RunbookPlanNode,
    parameterValues: Record<string, string | number | boolean | null>,
    nodeValues?: ReadonlyMap<string, Readonly<Record<string, number | string | boolean>>>,
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(node.inputs ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => [
                name,
                resolveApprovalValue(value, parameterValues, nodeValues),
            ]),
    );
}

function resolveApprovalValue(
    value: unknown,
    parameterValues: Record<string, string | number | boolean | null>,
    nodeValues?: ReadonlyMap<string, Readonly<Record<string, number | string | boolean>>>,
): unknown {
    if (typeof value === "string") {
        const parameter = /^\$params\.([A-Za-z0-9_-]+)$/.exec(value);
        if (parameter) {
            return parameterValues[parameter[1]];
        }
        const output = /^\$nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value);
        return output ? (nodeValues?.get(output[1])?.[output[2]] ?? value) : value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => resolveApprovalValue(entry, parameterValues, nodeValues));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
                key,
                resolveApprovalValue(entry, parameterValues, nodeValues),
            ]),
        );
    }
    return value;
}

function validateChallenge(challenge: RunbookApprovalChallenge): void {
    for (const [label, value] of [
        ["approvalId", challenge.approvalId],
        ["runId", challenge.runId],
        ["gateNodeId", challenge.gateNodeId],
        ["activityNodeId", challenge.activityNodeId],
        ["activityKind", challenge.activityKind],
        ["planRevision", challenge.planRevision],
        ["planHash", challenge.planHash],
        ["resolvedArgumentDigest", challenge.resolvedArgumentDigest],
        ["targetFingerprint", challenge.targetFingerprint],
        ["effectSummaryDigest", challenge.effectSummaryDigest],
        ["policyVersion", challenge.policyVersion],
    ] as Array<[string, string]>) {
        if (!value?.trim()) {
            throw new RunbookApprovalLedgerError("invalidChallenge", `${label} must be non-empty`);
        }
    }
    if (
        !Number.isSafeInteger(challenge.activityVersion) ||
        challenge.activityVersion < 1 ||
        !Number.isSafeInteger(challenge.attempt) ||
        challenge.attempt < 1
    ) {
        throw new RunbookApprovalLedgerError(
            "invalidChallenge",
            "approval challenge version or attempt is invalid",
        );
    }
}

function validateRecord(record: RunbookApprovalRecord, expectedApprovalId?: string): void {
    if (record.schemaVersion !== RUNBOOK_APPROVAL_SCHEMA_VERSION || !record.challenge) {
        throw new RunbookApprovalLedgerError("recordCorrupt", "approval record schema is invalid");
    }
    validateChallenge(record.challenge);
    if (expectedApprovalId && record.challenge.approvalId !== expectedApprovalId) {
        throw new RunbookApprovalLedgerError(
            "recordCorrupt",
            "approval record identity does not match its lookup key",
        );
    }
    if (record.challengeDigest !== digestRunbookValue(record.challenge)) {
        throw new RunbookApprovalLedgerError(
            "recordCorrupt",
            "approval challenge digest does not match the record",
        );
    }
    if (record.decision) {
        const expected = digestRunbookValue({
            challengeDigest: record.challengeDigest,
            decision: record.decision,
        });
        if (record.decisionDigest !== expected) {
            throw new RunbookApprovalLedgerError(
                "recordCorrupt",
                "approval decision digest does not match the record",
            );
        }
    } else if (record.decisionDigest !== undefined) {
        throw new RunbookApprovalLedgerError(
            "recordCorrupt",
            "approval record has a decision digest without a decision",
        );
    }
}

function writeNewDurableRecord(filePath: string, record: RunbookApprovalRecord): void {
    const descriptor = fs.openSync(filePath, "wx");
    try {
        fs.writeFileSync(descriptor, canonicalRunbookJson(record), "utf8");
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

function replaceDurableRecord(filePath: string, record: RunbookApprovalRecord): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
    let renamed = false;
    try {
        const descriptor = fs.openSync(tempPath, "wx");
        try {
            fs.writeFileSync(descriptor, canonicalRunbookJson(record), "utf8");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(tempPath, filePath);
        renamed = true;
    } finally {
        if (!renamed) {
            try {
                fs.rmSync(tempPath, { force: true });
            } catch {
                // Best effort; the previous durable record remains authoritative.
            }
        }
    }
}
