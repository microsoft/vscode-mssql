/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable run ledger (RBS2-3 / ADR-5): write-ahead JSONL per run under the
 * library-global storage root, folded through the pure run model so every
 * append enforces the one-terminal and monotonic-sequence invariants BEFORE
 * the event is visible anywhere else. On terminal, an immutable record.json
 * snapshot is written and the ledger for that run closes.
 *
 * Layout: <root>/ledger/<runId>.jsonl   (append-only events)
 *         <root>/runs/<runId>.record.json (immutable terminal snapshot)
 *
 * The run.accepted event carries the plan identity (runbookId, revision,
 * hash, node list, owning pid) so a journal is SELF-SUFFICIENT: after a
 * window closes mid-run, the next session can attribute the journal to its
 * runbook and seal it with a synthesized "interrupted" terminal — never a
 * fake success, never a silent disappearance.
 *
 * Writes are synchronous and small (run events are low-rate); a corrupt or
 * partial trailing line on recovery is treated as a crash artifact and
 * dropped with an explicit diagnostic, never silently repaired.
 */

import * as fs from "fs";
import * as path from "path";
import {
    RunbookRunEvent,
    RunbookRunHistoryEntry,
    RunbookRunSnapshot,
    RUNBOOK_RUN_EVENT_SCHEMA_VERSION,
} from "../sharedInterfaces/runbookStudio";
import {
    applyRunEvent,
    createInitialSnapshot,
    isTerminalRunState,
    LedgerInvariantError,
} from "./runbookRunModel";

interface OpenRun {
    snapshot: RunbookRunSnapshot;
    filePath: string;
    nextSeq: number;
}

export interface LedgerRecoveryResult {
    snapshot: RunbookRunSnapshot | undefined;
    droppedTrailingLine: boolean;
}

/** One known run on disk (sealed record or journal-only). */
export interface LedgerRunInfo {
    runId: string;
    /** "" when the journal predates accepted-event metadata (legacy). */
    runbookId: string;
    startedEpochMs: number;
    /** A terminal record.json exists (immutable, GC-safe unit). */
    sealed: boolean;
    /** pid recorded at accept time (unsealed journals only). */
    ownerPid?: number;
}

export interface RunbookRunLedgerOptions {
    /** Liveness probe for cross-window safety (injectable for tests). */
    isPidAlive?: (pid: number) => boolean;
}

/** Journals older than this seal regardless of pid liveness (pid reuse). */
const PID_TRUST_WINDOW_MS = 24 * 60 * 60 * 1000;

export class RunbookRunLedger {
    private readonly ledgerDir: string;
    private readonly runsDir: string;
    private readonly openRuns = new Map<string, OpenRun>();
    private readonly isPidAlive: (pid: number) => boolean;

    constructor(storageRoot: string, options?: RunbookRunLedgerOptions) {
        this.ledgerDir = path.join(storageRoot, "ledger");
        this.runsDir = path.join(storageRoot, "runs");
        this.isPidAlive = options?.isPidAlive ?? defaultIsPidAlive;
        fs.mkdirSync(this.ledgerDir, { recursive: true });
        fs.mkdirSync(this.runsDir, { recursive: true });
    }

    /** Accept a run: create its ledger file and fold the accepted event.
     *  The accepted event carries the plan identity so the journal alone
     *  can attribute and recover this run after a crash. */
    public acceptRun(init: {
        runId: string;
        runbookId: string;
        planRevision: string;
        planHash: string;
        nodeIds: string[];
        epochMs: number;
    }): RunbookRunSnapshot {
        if (this.openRuns.has(init.runId)) {
            throw new LedgerInvariantError("duplicateTerminal", `run ${init.runId} already open`);
        }
        const filePath = path.join(this.ledgerDir, `${sanitizeRunFileId(init.runId)}.jsonl`);
        const open: OpenRun = {
            snapshot: createInitialSnapshot(init),
            filePath,
            nextSeq: 1,
        };
        this.openRuns.set(init.runId, open);
        return this.append(init.runId, {
            type: "run.accepted",
            epochMs: init.epochMs,
            accepted: {
                runbookId: init.runbookId,
                planRevision: init.planRevision,
                planHash: init.planHash,
                nodeIds: init.nodeIds,
                pid: process.pid,
            },
        });
    }

    /**
     * Append one event (seq assigned HERE — callers never invent sequence
     * numbers). Write-ahead: the line is on disk before the folded snapshot
     * is returned. Throws LedgerInvariantError on protocol violations.
     */
    public append(
        runId: string,
        event: Omit<RunbookRunEvent, "schemaVersion" | "runId" | "seq">,
    ): RunbookRunSnapshot {
        const open = this.openRuns.get(runId);
        if (!open) {
            throw new LedgerInvariantError("notAccepted", `run ${runId} is not open`);
        }
        const full: RunbookRunEvent = {
            schemaVersion: RUNBOOK_RUN_EVENT_SCHEMA_VERSION,
            runId,
            seq: open.nextSeq,
            ...event,
        };
        // Validate BEFORE writing: an invariant-violating event must never
        // reach the journal.
        const folded = applyRunEvent(open.snapshot, full);
        fs.appendFileSync(open.filePath, JSON.stringify(full) + "\n");
        open.snapshot = folded;
        open.nextSeq++;
        if (isTerminalRunState(folded.state) && full.type === "run.terminal") {
            this.sealRun(runId, folded);
        }
        return folded;
    }

    public snapshotOf(runId: string): RunbookRunSnapshot | undefined {
        const open = this.openRuns.get(runId);
        if (open) {
            return open.snapshot;
        }
        return this.loadSealedRun(runId);
    }

    public isOpen(runId: string): boolean {
        return this.openRuns.has(runId);
    }

    /** History entries for one runbook id, newest first (sealed + open). */
    public listRuns(runbookId: string): RunbookRunHistoryEntry[] {
        const entries: RunbookRunHistoryEntry[] = [];
        for (const open of this.openRuns.values()) {
            if (open.snapshot.runbookId === runbookId) {
                entries.push(toHistoryEntry(open.snapshot));
            }
        }
        try {
            for (const file of fs.readdirSync(this.runsDir)) {
                if (!file.endsWith(".record.json")) {
                    continue;
                }
                try {
                    const snapshot = JSON.parse(
                        fs.readFileSync(path.join(this.runsDir, file), "utf8"),
                    ) as RunbookRunSnapshot;
                    if (
                        snapshot.runbookId === runbookId &&
                        !entries.some((e) => e.runId === snapshot.runId)
                    ) {
                        entries.push(toHistoryEntry(snapshot));
                    }
                } catch {
                    // Unreadable record: skip; the ledger file remains for recovery.
                }
            }
        } catch {
            // Runs dir unreadable: open runs only.
        }
        return entries.sort((a, b) => b.startedEpochMs - a.startedEpochMs);
    }

    /** Every run known on disk: sealed records plus journal-only runs (the
     *  interrupted candidates), attributed via the accepted-event metadata.
     *  Runs open in THIS process are reported unsealed with our own pid. */
    public listAllRuns(): LedgerRunInfo[] {
        const byRunId = new Map<string, LedgerRunInfo>();
        try {
            for (const file of fs.readdirSync(this.runsDir)) {
                if (!file.endsWith(".record.json")) {
                    continue;
                }
                try {
                    const snapshot = JSON.parse(
                        fs.readFileSync(path.join(this.runsDir, file), "utf8"),
                    ) as RunbookRunSnapshot;
                    byRunId.set(snapshot.runId, {
                        runId: snapshot.runId,
                        runbookId: snapshot.runbookId ?? "",
                        startedEpochMs: snapshot.startedEpochMs ?? 0,
                        sealed: true,
                    });
                } catch {
                    // Unreadable record: skip (never guess identity).
                }
            }
        } catch {
            // Runs dir unreadable.
        }
        try {
            for (const file of fs.readdirSync(this.ledgerDir)) {
                if (!file.endsWith(".jsonl")) {
                    continue;
                }
                try {
                    const first = readFirstJournalLine(path.join(this.ledgerDir, file));
                    if (!first || byRunId.has(first.runId)) {
                        continue;
                    }
                    byRunId.set(first.runId, {
                        runId: first.runId,
                        runbookId: first.accepted?.runbookId ?? "",
                        startedEpochMs: first.epochMs ?? 0,
                        sealed: false,
                        ...(first.accepted?.pid !== undefined
                            ? { ownerPid: first.accepted.pid }
                            : {}),
                    });
                } catch {
                    // Unreadable journal head: skip.
                }
            }
        } catch {
            // Ledger dir unreadable.
        }
        return [...byRunId.values()];
    }

    /**
     * Recover a non-sealed run from its journal (crash/reopen path). A
     * corrupt trailing line is dropped and reported; anything else corrupt
     * fails recovery honestly.
     */
    public recoverRun(runId: string): LedgerRecoveryResult {
        const sealed = this.loadSealedRun(runId);
        if (sealed) {
            return { snapshot: sealed, droppedTrailingLine: false };
        }
        const journal = this.readJournal(runId);
        if (!journal) {
            return { snapshot: undefined, droppedTrailingLine: false };
        }
        const snapshot = foldJournal(runId, journal.events);
        return { snapshot, droppedTrailingLine: journal.droppedTrailingLine };
    }

    /**
     * Seal a run whose window closed before it terminated: append a
     * synthesized run.terminal (state "failed", honest Interrupted error)
     * through the normal validated append path, then seal the immutable
     * record. Idempotent: an already-sealed run returns its record.
     * Refuses (returns undefined) when the run is live in this process, is
     * plausibly live in ANOTHER window (recorded pid alive, journal young),
     * or its journal cannot be recovered.
     */
    public sealInterruptedRun(runId: string, errorMessage: string): RunbookRunSnapshot | undefined {
        if (this.openRuns.has(runId)) {
            return undefined; // Live in this process — not interrupted.
        }
        const sealed = this.loadSealedRun(runId);
        if (sealed) {
            return sealed;
        }
        const journal = this.readJournal(runId);
        if (!journal) {
            return undefined;
        }
        const ownerPid = journal.events[0]?.accepted?.pid;
        if (
            ownerPid !== undefined &&
            ownerPid !== process.pid &&
            this.isPidAlive(ownerPid) &&
            Date.now() - journal.mtimeMs < PID_TRUST_WINDOW_MS
        ) {
            return undefined; // Another window plausibly owns this run.
        }
        let snapshot: RunbookRunSnapshot | undefined;
        try {
            snapshot = foldJournal(runId, journal.events);
        } catch {
            return undefined; // Corrupt beyond the torn tail — never guess.
        }
        if (!snapshot) {
            return undefined;
        }
        if (isTerminalRunState(snapshot.state)) {
            // Terminal reached but the seal was lost (crash between append
            // and rename): finish the seal from the folded snapshot.
            this.sealRun(runId, snapshot);
            return snapshot;
        }
        if (journal.droppedTrailingLine) {
            // The torn tail must leave the FILE before we append — a later
            // recovery would otherwise hit corrupt JSON mid-journal.
            fs.writeFileSync(
                journal.filePath,
                journal.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
            );
        }
        const lastEpochMs = journal.events.reduce(
            (max, e) => Math.max(max, e.epochMs ?? 0),
            snapshot.startedEpochMs ?? 0,
        );
        this.openRuns.set(runId, {
            snapshot,
            filePath: journal.filePath,
            nextSeq: snapshot.seq + 1,
        });
        try {
            return this.append(runId, {
                type: "run.terminal",
                epochMs: lastEpochMs || Date.now(),
                runState: "failed",
                error: { code: "RunbookStudio.Interrupted", message: errorMessage },
                synthesized: true,
            });
        } catch {
            this.openRuns.delete(runId);
            return undefined;
        }
    }

    /** Seal every interrupted journal (optionally for one runbook id).
     *  Returns the number of runs sealed by THIS call. */
    public sealInterruptedRuns(errorMessage: string, runbookId?: string): number {
        let sealedCount = 0;
        for (const info of this.listAllRuns()) {
            if (info.sealed || this.openRuns.has(info.runId)) {
                continue;
            }
            if (runbookId !== undefined && info.runbookId !== runbookId) {
                continue;
            }
            if (this.sealInterruptedRun(info.runId, errorMessage)) {
                sealedCount++;
            }
        }
        return sealedCount;
    }

    /** Remove a run's journal and record (retention GC). Refuses runs open
     *  in this process. Returns true when anything was deleted. */
    public deleteRun(runId: string): boolean {
        if (this.openRuns.has(runId)) {
            return false;
        }
        let deleted = false;
        for (const filePath of [
            path.join(this.ledgerDir, `${sanitizeRunFileId(runId)}.jsonl`),
            path.join(this.runsDir, `${sanitizeRunFileId(runId)}.record.json`),
        ]) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.rmSync(filePath, { force: true });
                    deleted = true;
                }
            } catch {
                // Locked/unreadable: leave for a later sweep.
            }
        }
        return deleted;
    }

    private sealRun(runId: string, snapshot: RunbookRunSnapshot): void {
        const recordPath = path.join(this.runsDir, `${sanitizeRunFileId(runId)}.record.json`);
        const tempPath = recordPath + ".tmp";
        fs.writeFileSync(tempPath, JSON.stringify(snapshot, undefined, 2));
        fs.renameSync(tempPath, recordPath);
        this.openRuns.delete(runId);
    }

    private loadSealedRun(runId: string): RunbookRunSnapshot | undefined {
        const recordPath = path.join(this.runsDir, `${sanitizeRunFileId(runId)}.record.json`);
        try {
            return JSON.parse(fs.readFileSync(recordPath, "utf8")) as RunbookRunSnapshot;
        } catch {
            return undefined;
        }
    }

    /** Read + parse a journal; the torn trailing line is dropped in memory
     *  (the caller decides whether to rewrite the file). Throws on corrupt
     *  NON-trailing lines — that is damage, not a crash artifact. */
    private readJournal(runId: string):
        | {
              events: RunbookRunEvent[];
              droppedTrailingLine: boolean;
              filePath: string;
              mtimeMs: number;
          }
        | undefined {
        const filePath = path.join(this.ledgerDir, `${sanitizeRunFileId(runId)}.jsonl`);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const mtimeMs = fs.statSync(filePath).mtimeMs;
        const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
        const events: RunbookRunEvent[] = [];
        let droppedTrailingLine = false;
        for (let i = 0; i < lines.length; i++) {
            try {
                events.push(JSON.parse(lines[i]) as RunbookRunEvent);
            } catch (error) {
                if (i === lines.length - 1) {
                    droppedTrailingLine = true;
                    break;
                }
                throw error;
            }
        }
        return { events, droppedTrailingLine, filePath, mtimeMs };
    }
}

/** Fold a journal's events into a snapshot. Prefers the accepted-event plan
 *  identity (self-sufficient journals); legacy journals fall back to node
 *  ids reconstructed from observed events with an empty runbook id. */
function foldJournal(runId: string, events: RunbookRunEvent[]): RunbookRunSnapshot | undefined {
    if (events.length === 0 || events[0].type !== "run.accepted") {
        return undefined;
    }
    const accepted = events[0].accepted;
    const nodeIds = accepted?.nodeIds ?? [
        ...new Set(
            events
                .map((e) => e.nodeId ?? e.gate?.nodeId)
                .filter((id): id is string => id !== undefined),
        ),
    ];
    let snapshot = createInitialSnapshot({
        runId,
        runbookId: accepted?.runbookId ?? "",
        planRevision: accepted?.planRevision ?? "",
        planHash: accepted?.planHash ?? "",
        nodeIds,
    });
    for (const event of events) {
        snapshot = applyRunEvent(snapshot, event);
    }
    return snapshot;
}

function readFirstJournalLine(filePath: string): RunbookRunEvent | undefined {
    const content = fs.readFileSync(filePath, "utf8");
    const newline = content.indexOf("\n");
    const line = newline >= 0 ? content.slice(0, newline) : content;
    if (!line.trim()) {
        return undefined;
    }
    try {
        return JSON.parse(line) as RunbookRunEvent;
    } catch {
        return undefined;
    }
}

/**
 * Retention selection (pure): return the runIds beyond the newest
 * `keepPerRunbook` runs of each runbook. Ties break on runId so the
 * selection is deterministic.
 */
export function selectExpiredRuns(
    runs: Array<{ runId: string; runbookId: string; startedEpochMs: number }>,
    keepPerRunbook: number,
): string[] {
    const byRunbook = new Map<string, Array<{ runId: string; startedEpochMs: number }>>();
    for (const run of runs) {
        const group = byRunbook.get(run.runbookId) ?? [];
        group.push(run);
        byRunbook.set(run.runbookId, group);
    }
    const expired: string[] = [];
    for (const group of byRunbook.values()) {
        group.sort((a, b) => b.startedEpochMs - a.startedEpochMs || b.runId.localeCompare(a.runId));
        for (const run of group.slice(Math.max(0, keepPerRunbook))) {
            expired.push(run.runId);
        }
    }
    return expired;
}

function toHistoryEntry(snapshot: RunbookRunSnapshot): RunbookRunHistoryEntry {
    return {
        runId: snapshot.runId,
        startedEpochMs: snapshot.startedEpochMs ?? 0,
        state: snapshot.state,
        planRevision: snapshot.planRevision,
        ...(snapshot.verdict ? { verdict: snapshot.verdict } : {}),
    };
}

/** Filesystem-safe projection of a run id (shared with the result store so
 *  ledger units and result payload directories stay co-addressable). */
export function sanitizeRunFileId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultIsPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means the process exists but is not ours — still alive.
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}
