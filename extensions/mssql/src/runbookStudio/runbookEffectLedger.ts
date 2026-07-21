/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable write-ahead ledger for extension-hosted external effects.
 *
 * This ledger is deliberately separate from the run event ledger. Runtime
 * completion is not proof that an external mutation did (or did not) happen:
 * the extension can die after the effect succeeds but before a node result is
 * recorded. Each effect therefore owns a self-sufficient append-only journal.
 * A transition is flushed before the caller is allowed to cross the matching
 * external-effect boundary.
 *
 * Layout: <root>/effects/<sha256(effectId)>.jsonl
 *
 * Journals contain digests and opaque IDs only. Connection strings, tokens,
 * SQL text, and user data must never be placed in this store.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { canonicalRunbookJson } from "./runbookDigest";

export const RUNBOOK_EFFECT_LEDGER_SCHEMA_VERSION = 1 as const;

export type RunbookEffectRetrySemantics =
    | "idempotent"
    | "atLeastOnceDeduplicated"
    | "atMostOnceUnknownOutcome"
    | "resumable"
    | "operatorDecisionRequired";

export interface RunbookEffectIdentity {
    effectId: string;
    runId: string;
    nodeId: string;
    attempt: number;
    activityKind: string;
    activityVersion: number;
    idempotencyKey: string;
    planHash: string;
    bindingDigest: string;
    targetFingerprint: string;
    retrySemantics: RunbookEffectRetrySemantics;
    /** Process that crossed the effect boundary; recovery skips another
     * plausibly live extension host. */
    /** Absent only on journals written before process ownership was added. */
    ownerPid?: number;
    policy: {
        version: string;
        outcome: "allowed";
    };
    approval?: {
        approvalId: string;
        approvalDigest: string;
    };
    /** Non-secret information sufficient to probe/clean a crash-window
     * resource even when effect.observed was never appended. */
    recovery?: {
        resourceKind: string;
        resourceId: string;
        connectionProfileId: string;
        ownershipMarkerDigest: string;
    };
}

export interface RunbookEffectResource {
    resourceKind: string;
    /** Opaque host resource identity; never a connection string. */
    resourceId: string;
    /** Digest of the ownership marker used to authorize automatic cleanup. */
    ownershipMarkerDigest: string;
    /** Opaque saved-profile id used to reconnect for cleanup. */
    connectionProfileId?: string;
    outputHandles?: string[];
}

export type RunbookEffectState =
    | "prepared"
    | "effectObserved"
    | "finalized"
    | "failedNoEffect"
    | "cleanupStarted"
    | "cleaned"
    | "needsOperatorDecision";

interface RunbookEffectEventBase {
    schemaVersion: typeof RUNBOOK_EFFECT_LEDGER_SCHEMA_VERSION;
    effectId: string;
    seq: number;
    epochMs: number;
}

export type RunbookEffectEvent = RunbookEffectEventBase &
    (
        | { type: "effect.prepared"; identity: RunbookEffectIdentity }
        | { type: "effect.observed"; resource: RunbookEffectResource }
        | { type: "effect.finalized"; evidenceDigest: string }
        | { type: "effect.failedNoEffect"; errorCode: string }
        | { type: "cleanup.started" }
        | { type: "cleanup.completed"; evidenceDigest: string }
        | { type: "recovery.operatorDecisionRequired"; reasonCode: string }
    );

export interface RunbookEffectSnapshot {
    identity: RunbookEffectIdentity;
    seq: number;
    state: RunbookEffectState;
    preparedEpochMs: number;
    lastUpdatedEpochMs: number;
    resource?: RunbookEffectResource;
    finalizedEvidenceDigest?: string;
    errorCode?: string;
    cleanupEvidenceDigest?: string;
    recoveryReasonCode?: string;
}

export interface RunbookEffectRecoveryEntry {
    snapshot: RunbookEffectSnapshot;
    /** A crash interrupted the final append; valid preceding events survived. */
    droppedTrailingLine: boolean;
}

export interface RunbookEffectRecoveryScan {
    outstanding: RunbookEffectRecoveryEntry[];
    /** Filenames only; journal contents are classified and never surfaced. */
    unreadableFiles: Array<{ fileName: string; errorCode: string }>;
}

export type RunbookEffectInvariantKind =
    | "invalidIdentity"
    | "identityMismatch"
    | "invalidTransition"
    | "corruptJournal";

export class RunbookEffectLedgerError extends Error {
    constructor(
        public readonly kind: RunbookEffectInvariantKind,
        message: string,
    ) {
        super(message);
        this.name = "RunbookEffectLedgerError";
    }
}

export class RunbookEffectLedger {
    private readonly effectsDir: string;

    constructor(storageRoot: string) {
        this.effectsDir = path.join(storageRoot, "effects");
        fs.mkdirSync(this.effectsDir, { recursive: true });
    }

    /**
     * Persist the complete effect identity before any external mutation.
     * Re-entering with the exact same identity is idempotent; any difference
     * is refused instead of reusing another effect's journal.
     */
    public prepareEffect(
        identity: RunbookEffectIdentity,
        epochMs = Date.now(),
    ): RunbookEffectSnapshot {
        validateIdentity(identity);
        const filePath = this.filePath(identity.effectId);
        const event: RunbookEffectEvent = {
            schemaVersion: RUNBOOK_EFFECT_LEDGER_SCHEMA_VERSION,
            effectId: identity.effectId,
            seq: 1,
            epochMs,
            type: "effect.prepared",
            identity,
        };
        try {
            writeNewDurableJournal(filePath, event);
            return foldEffectEvents([event]);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                throw error;
            }
            const recovered = this.readEffect(identity.effectId);
            if (!recovered || !identitiesEqual(recovered.snapshot.identity, identity)) {
                throw new RunbookEffectLedgerError(
                    "identityMismatch",
                    `effect '${identity.effectId}' is already bound to another identity`,
                );
            }
            return recovered.snapshot;
        }
    }

    /** Record proof that the external effect exists before returning success. */
    public recordEffectObserved(
        effectId: string,
        resource: RunbookEffectResource,
        epochMs = Date.now(),
    ): RunbookEffectSnapshot {
        return this.append(effectId, {
            type: "effect.observed",
            resource,
            epochMs,
        });
    }

    /** Make an intentionally retained effect terminal after its externally
     * observable result and verification evidence have both been persisted. */
    public finalizeEffect(
        effectId: string,
        evidenceDigest: string,
        epochMs = Date.now(),
    ): RunbookEffectSnapshot {
        return this.append(effectId, { type: "effect.finalized", evidenceDigest, epochMs });
    }

    /** Terminal proof that the operation failed before creating an effect. */
    public recordNoEffectFailure(
        effectId: string,
        errorCode: string,
        epochMs = Date.now(),
    ): RunbookEffectSnapshot {
        return this.append(effectId, { type: "effect.failedNoEffect", errorCode, epochMs });
    }

    /** Persist before beginning compensating cleanup. */
    public startCleanup(effectId: string, epochMs = Date.now()): RunbookEffectSnapshot {
        return this.append(effectId, { type: "cleanup.started", epochMs });
    }

    /** Persist cleanup proof before reporting the lease disposed. */
    public completeCleanup(
        effectId: string,
        evidenceDigest: string,
        epochMs = Date.now(),
    ): RunbookEffectSnapshot {
        return this.append(effectId, { type: "cleanup.completed", evidenceDigest, epochMs });
    }

    /** Refuse blind retry and preserve the reason for an operator workflow. */
    public requireOperatorDecision(
        effectId: string,
        reasonCode: string,
        epochMs = Date.now(),
    ): RunbookEffectSnapshot {
        return this.append(effectId, {
            type: "recovery.operatorDecisionRequired",
            reasonCode,
            epochMs,
        });
    }

    public recoverEffect(effectId: string): RunbookEffectRecoveryEntry | undefined {
        return this.readEffect(effectId);
    }

    /**
     * Enumerate every non-terminal effect for startup recovery. Corrupt
     * journals are reported rather than skipped, because absence is not proof
     * that no external resource exists.
     */
    public scanRecovery(): RunbookEffectRecoveryScan {
        const result: RunbookEffectRecoveryScan = { outstanding: [], unreadableFiles: [] };
        let files: string[];
        try {
            files = fs.readdirSync(this.effectsDir).filter((file) => file.endsWith(".jsonl"));
        } catch (error) {
            result.unreadableFiles.push({
                fileName: "<effects-directory>",
                errorCode: stableErrorCode(error),
            });
            return result;
        }
        for (const fileName of files.sort((left, right) => left.localeCompare(right))) {
            try {
                const journal = readJournal(path.join(this.effectsDir, fileName));
                const snapshot = foldEffectEvents(journal.events);
                if (isOutstanding(snapshot.state)) {
                    result.outstanding.push({
                        snapshot,
                        droppedTrailingLine: journal.droppedTrailingLine,
                    });
                }
            } catch (error) {
                result.unreadableFiles.push({
                    fileName,
                    errorCode: stableErrorCode(error),
                });
            }
        }
        return result;
    }

    /** Retention GC for effects whose owning run expired. Outstanding or
     * unreadable journals are never deleted: operator/recovery evidence wins
     * over space reclamation. */
    public deleteTerminalEffectsForRun(runId: string): number {
        let deleted = 0;
        let files: string[];
        try {
            files = fs.readdirSync(this.effectsDir).filter((file) => file.endsWith(".jsonl"));
        } catch {
            return 0;
        }
        for (const fileName of files) {
            const filePath = path.join(this.effectsDir, fileName);
            try {
                const snapshot = foldEffectEvents(readJournal(filePath).events);
                if (snapshot.identity.runId !== runId || isOutstanding(snapshot.state)) {
                    continue;
                }
                fs.rmSync(filePath, { force: true });
                deleted++;
            } catch {
                // Never delete evidence that cannot be proved terminal.
            }
        }
        return deleted;
    }

    private append(
        effectId: string,
        event:
            | { type: "effect.observed"; resource: RunbookEffectResource; epochMs: number }
            | { type: "effect.finalized"; evidenceDigest: string; epochMs: number }
            | { type: "effect.failedNoEffect"; errorCode: string; epochMs: number }
            | { type: "cleanup.started"; epochMs: number }
            | { type: "cleanup.completed"; evidenceDigest: string; epochMs: number }
            | {
                  type: "recovery.operatorDecisionRequired";
                  reasonCode: string;
                  epochMs: number;
              },
    ): RunbookEffectSnapshot {
        const filePath = this.filePath(effectId);
        const journal = readJournal(filePath);
        if (journal.droppedTrailingLine) {
            rewriteDurableJournal(filePath, journal.events);
        }
        const full = {
            schemaVersion: RUNBOOK_EFFECT_LEDGER_SCHEMA_VERSION,
            effectId,
            seq: journal.events.length + 1,
            ...event,
        } as RunbookEffectEvent;
        const snapshot = foldEffectEvents([...journal.events, full]);
        appendDurableEvent(filePath, full);
        return snapshot;
    }

    private readEffect(effectId: string): RunbookEffectRecoveryEntry | undefined {
        const filePath = this.filePath(effectId);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const journal = readJournal(filePath);
        return {
            snapshot: foldEffectEvents(journal.events),
            droppedTrailingLine: journal.droppedTrailingLine,
        };
    }

    private filePath(effectId: string): string {
        const digest = crypto.createHash("sha256").update(effectId).digest("hex");
        return path.join(this.effectsDir, `${digest}.jsonl`);
    }
}

/** Stable effect identity for one run/node/attempt. */
export function deriveRunbookEffectId(input: {
    runId: string;
    nodeId: string;
    attempt: number;
    activityKind: string;
    activityVersion: number;
}): string {
    return `effect-${crypto
        .createHash("sha256")
        .update(
            [
                input.runId,
                input.nodeId,
                input.attempt.toString(10),
                input.activityKind,
                input.activityVersion.toString(10),
            ].join("\u0000"),
        )
        .digest("hex")}`;
}

function foldEffectEvents(events: RunbookEffectEvent[]): RunbookEffectSnapshot {
    if (events.length === 0) {
        throw new RunbookEffectLedgerError("corruptJournal", "effect journal is empty");
    }
    const first = events[0];
    if (
        first.schemaVersion !== RUNBOOK_EFFECT_LEDGER_SCHEMA_VERSION ||
        first.type !== "effect.prepared" ||
        first.seq !== 1 ||
        first.effectId !== first.identity.effectId
    ) {
        throw new RunbookEffectLedgerError(
            "corruptJournal",
            "effect journal does not begin with a valid prepared event",
        );
    }
    validateIdentity(first.identity);
    let snapshot: RunbookEffectSnapshot = {
        identity: first.identity,
        seq: 1,
        state: "prepared",
        preparedEpochMs: first.epochMs,
        lastUpdatedEpochMs: first.epochMs,
    };
    for (let index = 1; index < events.length; index++) {
        const event = events[index];
        if (
            event.schemaVersion !== RUNBOOK_EFFECT_LEDGER_SCHEMA_VERSION ||
            event.effectId !== first.effectId ||
            event.seq !== index + 1
        ) {
            throw new RunbookEffectLedgerError(
                "corruptJournal",
                `effect journal sequence ${index + 1} is invalid`,
            );
        }
        if (event.type === "effect.prepared") {
            throw new RunbookEffectLedgerError(
                "corruptJournal",
                "effect journal contains more than one prepared event",
            );
        }
        snapshot = applyEffectEvent(snapshot, event);
    }
    return snapshot;
}

function applyEffectEvent(
    snapshot: RunbookEffectSnapshot,
    event: Exclude<RunbookEffectEvent, { type: "effect.prepared" }>,
): RunbookEffectSnapshot {
    const next = { ...snapshot, seq: event.seq, lastUpdatedEpochMs: event.epochMs };
    switch (event.type) {
        case "effect.observed":
            requireState(snapshot, event, "prepared");
            validateResource(event.resource);
            return { ...next, state: "effectObserved", resource: event.resource };
        case "effect.finalized":
            requireState(snapshot, event, "effectObserved");
            requireNonEmpty(event.evidenceDigest, "evidenceDigest");
            return {
                ...next,
                state: "finalized",
                finalizedEvidenceDigest: event.evidenceDigest,
            };
        case "effect.failedNoEffect":
            requireState(snapshot, event, "prepared");
            requireNonEmpty(event.errorCode, "errorCode");
            return { ...next, state: "failedNoEffect", errorCode: event.errorCode };
        case "cleanup.started":
            if (
                snapshot.state !== "effectObserved" &&
                !(snapshot.state === "needsOperatorDecision" && snapshot.resource)
            ) {
                invalidTransition(snapshot, event);
            }
            return { ...next, state: "cleanupStarted" };
        case "cleanup.completed":
            requireState(snapshot, event, "cleanupStarted");
            requireNonEmpty(event.evidenceDigest, "evidenceDigest");
            return {
                ...next,
                state: "cleaned",
                cleanupEvidenceDigest: event.evidenceDigest,
            };
        case "recovery.operatorDecisionRequired":
            if (!isOutstanding(snapshot.state)) {
                invalidTransition(snapshot, event);
            }
            requireNonEmpty(event.reasonCode, "reasonCode");
            return {
                ...next,
                state: "needsOperatorDecision",
                recoveryReasonCode: event.reasonCode,
            };
    }
}

function requireState(
    snapshot: RunbookEffectSnapshot,
    event: RunbookEffectEvent,
    expected: RunbookEffectState,
): void {
    if (snapshot.state !== expected) {
        invalidTransition(snapshot, event);
    }
}

function invalidTransition(snapshot: RunbookEffectSnapshot, event: RunbookEffectEvent): never {
    throw new RunbookEffectLedgerError(
        "invalidTransition",
        `effect '${snapshot.identity.effectId}' cannot apply '${event.type}' from '${snapshot.state}'`,
    );
}

function isOutstanding(state: RunbookEffectState): boolean {
    return state !== "failedNoEffect" && state !== "cleaned" && state !== "finalized";
}

function validateIdentity(identity: RunbookEffectIdentity): void {
    for (const [label, value] of [
        ["effectId", identity.effectId],
        ["runId", identity.runId],
        ["nodeId", identity.nodeId],
        ["activityKind", identity.activityKind],
        ["idempotencyKey", identity.idempotencyKey],
        ["planHash", identity.planHash],
        ["bindingDigest", identity.bindingDigest],
        ["targetFingerprint", identity.targetFingerprint],
        ["policy.version", identity.policy?.version],
    ] as Array<[string, string | undefined]>) {
        requireNonEmpty(value, label);
    }
    if (
        !Number.isSafeInteger(identity.attempt) ||
        identity.attempt < 1 ||
        !Number.isSafeInteger(identity.activityVersion) ||
        identity.activityVersion < 1 ||
        (identity.ownerPid !== undefined &&
            (!Number.isSafeInteger(identity.ownerPid) || identity.ownerPid < 1)) ||
        identity.policy.outcome !== "allowed"
    ) {
        throw new RunbookEffectLedgerError("invalidIdentity", "effect identity is invalid");
    }
    if (identity.approval) {
        requireNonEmpty(identity.approval.approvalId, "approval.approvalId");
        requireNonEmpty(identity.approval.approvalDigest, "approval.approvalDigest");
    }
    if (identity.recovery) {
        requireNonEmpty(identity.recovery.resourceKind, "recovery.resourceKind");
        requireNonEmpty(identity.recovery.resourceId, "recovery.resourceId");
        requireNonEmpty(identity.recovery.connectionProfileId, "recovery.connectionProfileId");
        requireNonEmpty(identity.recovery.ownershipMarkerDigest, "recovery.ownershipMarkerDigest");
    }
}

function validateResource(resource: RunbookEffectResource): void {
    requireNonEmpty(resource.resourceKind, "resourceKind");
    requireNonEmpty(resource.resourceId, "resourceId");
    requireNonEmpty(resource.ownershipMarkerDigest, "ownershipMarkerDigest");
    if (resource.connectionProfileId !== undefined) {
        requireNonEmpty(resource.connectionProfileId, "connectionProfileId");
    }
}

function requireNonEmpty(value: string | undefined, label: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new RunbookEffectLedgerError("invalidIdentity", `${label} must be non-empty`);
    }
}

function identitiesEqual(left: RunbookEffectIdentity, right: RunbookEffectIdentity): boolean {
    return canonicalRunbookJson(left) === canonicalRunbookJson(right);
}

function readJournal(filePath: string): {
    events: RunbookEffectEvent[];
    droppedTrailingLine: boolean;
} {
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf8");
    } catch (error) {
        throw new RunbookEffectLedgerError(
            "corruptJournal",
            `effect journal is unreadable (${stableErrorCode(error)})`,
        );
    }
    const lines = content.split("\n").filter(Boolean);
    const events: RunbookEffectEvent[] = [];
    let droppedTrailingLine = false;
    for (let index = 0; index < lines.length; index++) {
        try {
            events.push(JSON.parse(lines[index]) as RunbookEffectEvent);
        } catch (error) {
            if (index === lines.length - 1) {
                droppedTrailingLine = true;
                break;
            }
            throw new RunbookEffectLedgerError(
                "corruptJournal",
                `effect journal contains invalid record ${index + 1} (${stableErrorCode(error)})`,
            );
        }
    }
    return { events, droppedTrailingLine };
}

function writeNewDurableJournal(filePath: string, event: RunbookEffectEvent): void {
    const descriptor = fs.openSync(filePath, "wx");
    try {
        fs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

function appendDurableEvent(filePath: string, event: RunbookEffectEvent): void {
    const descriptor = fs.openSync(filePath, "a");
    try {
        fs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

function rewriteDurableJournal(filePath: string, events: RunbookEffectEvent[]): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
    let renamed = false;
    try {
        const descriptor = fs.openSync(tempPath, "wx");
        try {
            fs.writeFileSync(
                descriptor,
                events.map((event) => JSON.stringify(event)).join("\n") + "\n",
                "utf8",
            );
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
                // Best effort; the original journal remains authoritative.
            }
        }
    }
}

function stableErrorCode(error: unknown): string {
    return (
        (error as NodeJS.ErrnoException)?.code ??
        (error instanceof RunbookEffectLedgerError ? error.kind : "UnknownError")
    );
}
