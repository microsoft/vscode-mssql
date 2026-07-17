/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable run ledger (RBS2-3 / ADR-5): write-ahead JSONL per run under the
 * window's storage root, folded through the pure run model so every append
 * enforces the one-terminal and monotonic-sequence invariants BEFORE the
 * event is visible anywhere else. On terminal, an immutable record.json
 * snapshot is written and the ledger for that run closes.
 *
 * Layout: <root>/ledger/<runId>.jsonl   (append-only events)
 *         <root>/runs/<runId>.record.json (immutable terminal snapshot)
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

export class RunbookRunLedger {
    private readonly ledgerDir: string;
    private readonly runsDir: string;
    private readonly openRuns = new Map<string, OpenRun>();

    constructor(storageRoot: string) {
        this.ledgerDir = path.join(storageRoot, "ledger");
        this.runsDir = path.join(storageRoot, "runs");
        fs.mkdirSync(this.ledgerDir, { recursive: true });
        fs.mkdirSync(this.runsDir, { recursive: true });
    }

    /** Accept a run: create its ledger file and fold the accepted event. */
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
        const filePath = path.join(this.ledgerDir, `${sanitizeId(init.runId)}.jsonl`);
        const open: OpenRun = {
            snapshot: createInitialSnapshot(init),
            filePath,
            nextSeq: 1,
        };
        this.openRuns.set(init.runId, open);
        return this.append(init.runId, {
            type: "run.accepted",
            epochMs: init.epochMs,
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
        const filePath = path.join(this.ledgerDir, `${sanitizeId(runId)}.jsonl`);
        if (!fs.existsSync(filePath)) {
            return { snapshot: undefined, droppedTrailingLine: false };
        }
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
        if (events.length === 0 || events[0].type !== "run.accepted") {
            return { snapshot: undefined, droppedTrailingLine };
        }
        // Node ids are reconstructed from observed events; the accepted plan
        // node list is re-supplied by the caller when it re-opens the run.
        const nodeIds = [
            ...new Set(
                events
                    .map((e) => e.nodeId ?? e.gate?.nodeId)
                    .filter((id): id is string => id !== undefined),
            ),
        ];
        let snapshot = createInitialSnapshot({
            runId,
            runbookId: "",
            planRevision: "",
            planHash: "",
            nodeIds,
        });
        for (const event of events) {
            snapshot = applyRunEvent(snapshot, event);
        }
        return { snapshot, droppedTrailingLine };
    }

    private sealRun(runId: string, snapshot: RunbookRunSnapshot): void {
        const recordPath = path.join(this.runsDir, `${sanitizeId(runId)}.record.json`);
        const tempPath = recordPath + ".tmp";
        fs.writeFileSync(tempPath, JSON.stringify(snapshot, undefined, 2));
        fs.renameSync(tempPath, recordPath);
        this.openRuns.delete(runId);
    }

    private loadSealedRun(runId: string): RunbookRunSnapshot | undefined {
        const recordPath = path.join(this.runsDir, `${sanitizeId(runId)}.record.json`);
        try {
            return JSON.parse(fs.readFileSync(recordPath, "utf8")) as RunbookRunSnapshot;
        } catch {
            return undefined;
        }
    }
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

function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
