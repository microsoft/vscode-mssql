/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * FakeTdsDriver — deterministic scripted implementation of ITdsDriver (TSQ2
 * addendum §5.1). The engine's entire lifecycle/backpressure/fault surface is
 * testable against this twin with no tedious, no vscode, and no wall clock.
 *
 * Determinism rules: all delays ride the injected EngineClock (virtual in
 * tests); all randomness derives from TsNativeFaultProfile.seed; the pump
 * yields between steps so pause/cancel take effect at deterministic points.
 * Pause models tedious semantics: up to `pauseOverrunRows` already-parsed
 * rows may still deliver after pause() (default 1).
 */

import {
    DataPlaneOperationContext,
    EngineClock,
    EngineDisposable,
    ITdsConnection,
    ITdsDriver,
    ITdsQueryLease,
    TdsCancelReason,
    TdsCancelResult,
    TdsCell,
    TdsColumn,
    TdsCompletion,
    TdsConnectionObserver,
    TdsError,
    TdsErrorCategory,
    TdsExecuteRequest,
    TdsOpenRequest,
    TdsPauseReason,
    TdsQueryEvent,
    TdsQueryObserver,
    TdsServerFacts,
    TdsServerMessage,
    TsNativeFaultProfile,
} from "./tdsDriver";

// ---------------------------------------------------------------------------
// Virtual clock (exported for engine tests)
// ---------------------------------------------------------------------------

interface PendingTimer {
    at: number;
    seq: number;
    callback: () => void;
    disposed: boolean;
}

export class VirtualClock implements EngineClock {
    private timeMs = 0;
    private seq = 0;
    private timers: PendingTimer[] = [];

    now(): number {
        return this.timeMs;
    }

    setTimeout(callback: () => void, ms: number): EngineDisposable {
        const timer: PendingTimer = {
            at: this.timeMs + Math.max(0, ms),
            seq: this.seq++,
            callback,
            disposed: false,
        };
        this.timers.push(timer);
        return { dispose: () => (timer.disposed = true) };
    }

    yield(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Advance virtual time, firing due timers in (time, insertion) order.
     * Microtasks are drained BEFORE every timer scan so awaits resumed by a
     * previous firing (or by callers) can schedule follow-up timers that are
     * still due within this same advance.
     */
    async advance(ms: number): Promise<void> {
        const target = this.timeMs + ms;
        let progressed = true;
        while (progressed) {
            progressed = false;
            await drainMicrotasks();
            const due = this.timers
                .filter((t) => !t.disposed && t.at <= target)
                .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
            if (due) {
                this.timeMs = Math.max(this.timeMs, due.at);
                this.timers = this.timers.filter((t) => t !== due);
                due.callback();
                progressed = true;
            }
        }
        this.timeMs = target;
        await drainMicrotasks();
    }

    /** Settle promise chains without moving time. */
    async flush(): Promise<void> {
        await drainMicrotasks();
    }

    pendingTimerCount(): number {
        return this.timers.filter((t) => !t.disposed).length;
    }
}

async function drainMicrotasks(): Promise<void> {
    // A handful of microtask turns settles the engine's await chains; using
    // setImmediate here would reintroduce real-time coupling.
    for (let i = 0; i < 32; i++) {
        await Promise.resolve();
    }
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

export type FakeTdsStep =
    | { step: "metadata"; columns: TdsColumn[] }
    | { step: "row"; cells: readonly TdsCell[] }
    | {
          step: "rows";
          count: number;
          /** Deterministic row generator (index → cells). */
          make: (index: number) => readonly TdsCell[];
      }
    | { step: "done"; token: "done" | "doneInProc" | "doneProc"; rowCount?: number; more: boolean }
    | { step: "message"; message: TdsServerMessage }
    | { step: "databaseChanged"; database: string }
    | { step: "delay"; ms: number }
    | { step: "sever"; category?: TdsErrorCategory }
    | { step: "hangUntilCancel" };

export interface FakeTdsQueryScript {
    match: string | ((text: string) => boolean);
    steps: FakeTdsStep[];
    /** Request-callback outcome after steps (default ok). */
    completion?: TdsCompletion;
}

export interface FakeTdsOpenScript {
    outcome: "ok" | "authFail" | "networkFail" | "timeout" | "hang";
    delayMs?: number;
    serverFacts?: TdsServerFacts;
}

export interface FakeTdsDriverOptions {
    opens?: FakeTdsOpenScript[];
    queries?: FakeTdsQueryScript[];
    faults?: TsNativeFaultProfile;
    /** Rows that may still deliver after pause() (tedious models ≥1). */
    pauseOverrunRows?: number;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class FakeTdsDriver implements ITdsDriver {
    readonly name = "fake" as const;
    readonly version = "0.0.0-fake";
    private openIndex = 0;
    readonly connections: FakeTdsConnection[] = [];

    constructor(
        private readonly clock: EngineClock,
        private readonly options: FakeTdsDriverOptions = {},
    ) {}

    async open(
        request: TdsOpenRequest,
        observer: TdsConnectionObserver,
        _context: DataPlaneOperationContext,
    ): Promise<ITdsConnection> {
        const script = this.options.opens?.[this.openIndex++] ?? { outcome: "ok" as const };
        const faultDelay = this.options.faults?.openDelayMs ?? 0;
        const delay = (script.delayMs ?? 0) + faultDelay;
        if (delay > 0) {
            await this.sleep(delay);
        }
        const forcedFailure = this.options.faults?.openFailure;
        const outcome = forcedFailure
            ? forcedFailure === "auth"
                ? "authFail"
                : forcedFailure === "network"
                  ? "networkFail"
                  : "timeout"
            : script.outcome;
        switch (outcome) {
            case "ok": {
                const connection = new FakeTdsConnection(
                    this.clock,
                    this.options,
                    observer,
                    request,
                    script.serverFacts ?? { serverVersion: "16.0.0-fake" },
                );
                this.connections.push(connection);
                return connection;
            }
            case "authFail":
                throw fakeError("auth", "Login failed for user (fake).", 18456);
            case "networkFail":
                throw fakeError("network", "Could not connect (fake).");
            case "timeout":
                throw fakeError("timeout", "Connect timeout (fake).");
            case "hang":
                return new Promise<never>(() => undefined); // caller deadline owns this
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => this.clock.setTimeout(resolve, ms));
    }
}

function fakeError(category: TdsErrorCategory, message: string, number?: number): TdsError & Error {
    const error = new Error(message) as TdsError & Error;
    error.category = category;
    if (number !== undefined) {
        error.serverDetail = { number };
    }
    return error;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let fakeConnectionCounter = 0;

export class FakeTdsConnection implements ITdsConnection {
    readonly id = `ftds-${++fakeConnectionCounter}`;
    state: "open" | "closing" | "closed" | "lost" = "open";
    private generation = 0;
    private activeLease: FakeLease | undefined;
    /** Every listener-ownership bug shows up here: >0 after close = leak. */
    installedListeners = 0;

    constructor(
        private readonly clock: EngineClock,
        private readonly options: FakeTdsDriverOptions,
        private readonly observer: TdsConnectionObserver,
        readonly openRequest: TdsOpenRequest,
        readonly serverFacts: TdsServerFacts,
    ) {
        this.installedListeners = 1; // the one connection-level router
    }

    execute(
        request: TdsExecuteRequest,
        observer: TdsQueryObserver,
        _context: DataPlaneOperationContext,
    ): ITdsQueryLease {
        if (this.state !== "open") {
            const lease = new FakeLease(++this.generation);
            lease.rejectAccepted(fakeError("internal", `execute on ${this.state} connection`));
            lease.complete({
                ok: false,
                error: { category: "internal", message: "connection not open" },
            });
            return lease;
        }
        if (this.activeLease && !this.activeLease.terminal) {
            const lease = new FakeLease(++this.generation);
            lease.rejectAccepted(
                fakeError("internal", "one request at a time (engine must enforce Busy above)"),
            );
            lease.complete({
                ok: false,
                error: { category: "internal", message: "request already active" },
            });
            return lease;
        }
        const script = this.options.queries?.find((s) =>
            typeof s.match === "string"
                ? s.match === request.batchText
                : s.match(request.batchText),
        );
        const lease = new FakeLease(++this.generation);
        this.activeLease = lease;
        lease.resolveAccepted();
        void this.pump(lease, observer, script);
        return lease;
    }

    /** Emits the scripted stream honoring pause/cancel/sever semantics. */
    private async pump(
        lease: FakeLease,
        observer: TdsQueryObserver,
        script: FakeTdsQueryScript | undefined,
    ): Promise<void> {
        const overrunBudget = this.options.pauseOverrunRows ?? 1;
        let overrunRemaining = overrunBudget;
        let driverSeq = 0;
        let eventCount = 0;
        const dropAfter = this.options.faults?.dropAfterDriverEvents;
        const emit = async (event: TdsQueryEvent): Promise<boolean> => {
            if (lease.terminal) {
                return false;
            }
            // Pause gate: rows may overrun by a BOUNDED budget (models
            // tedious's already-parsed in-flight rows); everything else waits.
            if (lease.paused) {
                if (event.kind === "row" && overrunRemaining > 0) {
                    overrunRemaining -= 1;
                } else {
                    while (lease.paused && !lease.canceled && !lease.terminal) {
                        await this.sleepTick();
                    }
                    if (lease.terminal) {
                        return false;
                    }
                }
            }
            if (!lease.paused) {
                overrunRemaining = overrunBudget;
            }
            if (lease.canceled) {
                return false;
            }
            observer.onEvent(event);
            eventCount++;
            if (dropAfter !== undefined && eventCount >= dropAfter) {
                this.sever("network");
                return false;
            }
            return true;
        };

        if (!script) {
            observer.onEvent({
                kind: "message",
                driverSeq: driverSeq++,
                message: {
                    number: 2812,
                    severity: 16,
                    message: "FakeTdsDriver has no script for this batch",
                    isError: true,
                },
            });
            lease.complete({
                ok: false,
                error: {
                    category: "server",
                    message: "no script",
                    serverDetail: { number: 2812, severity: 16 },
                },
            });
            this.finishLease(lease);
            return;
        }

        for (const step of script.steps) {
            if (lease.terminal) {
                return;
            }
            if (lease.canceled) {
                break;
            }
            await this.clock.yield();
            switch (step.step) {
                case "metadata":
                    if (
                        !(await emit({
                            kind: "metadata",
                            driverSeq: driverSeq++,
                            columns: step.columns,
                        }))
                    ) {
                        return this.completeCanceledOrDead(lease);
                    }
                    break;
                case "row":
                    if (!(await emit({ kind: "row", driverSeq: driverSeq++, cells: step.cells }))) {
                        return this.completeCanceledOrDead(lease);
                    }
                    break;
                case "rows": {
                    for (let i = 0; i < step.count; i++) {
                        if (lease.canceled || lease.terminal) {
                            break;
                        }
                        // One virtual tick per row: deterministic pacing so
                        // pause/cancel interleave at exact row boundaries.
                        await this.sleepTick();
                        const delayEvery = this.options.faults?.delayEveryRows;
                        if (delayEvery && i > 0 && i % delayEvery.rows === 0) {
                            await this.sleep(delayEvery.ms);
                        }
                        if (
                            !(await emit({
                                kind: "row",
                                driverSeq: driverSeq++,
                                cells: step.make(i),
                            }))
                        ) {
                            return this.completeCanceledOrDead(lease);
                        }
                    }
                    break;
                }
                case "done":
                    if (
                        !(await emit({
                            kind: "done",
                            driverSeq: driverSeq++,
                            token: step.token,
                            ...(step.rowCount !== undefined ? { rowCount: step.rowCount } : {}),
                            more: step.more,
                        }))
                    ) {
                        return this.completeCanceledOrDead(lease);
                    }
                    break;
                case "message":
                    if (
                        !(await emit({
                            kind: "message",
                            driverSeq: driverSeq++,
                            message: step.message,
                        }))
                    ) {
                        return this.completeCanceledOrDead(lease);
                    }
                    break;
                case "databaseChanged":
                    if (
                        !(await emit({
                            kind: "databaseChanged",
                            driverSeq: driverSeq++,
                            database: step.database,
                        }))
                    ) {
                        return this.completeCanceledOrDead(lease);
                    }
                    break;
                case "delay":
                    await this.sleep(step.ms);
                    break;
                case "sever":
                    this.sever(step.category ?? "network");
                    return; // sever completes the lease
                case "hangUntilCancel":
                    while (!lease.canceled && !lease.terminal) {
                        await this.sleepTick();
                    }
                    break;
            }
        }

        if (lease.terminal) {
            return;
        }
        if (lease.canceled) {
            return this.completeCanceledOrDead(lease);
        }
        lease.complete(script.completion ?? { ok: true });
        this.finishLease(lease);
    }

    private completeCanceledOrDead(lease: FakeLease): void {
        if (lease.terminal) {
            return;
        }
        lease.complete({
            ok: false,
            error: { category: "cancel", message: "operation canceled (fake ECANCEL)" },
        });
        this.finishLease(lease);
    }

    private finishLease(lease: FakeLease): void {
        if (this.activeLease === lease) {
            this.activeLease = undefined;
        }
    }

    /** Socket loss: completes the active lease once, then notifies loss. */
    sever(category: TdsErrorCategory): void {
        if (this.state === "lost" || this.state === "closed") {
            return;
        }
        this.state = "lost";
        this.installedListeners = 0;
        const lease = this.activeLease;
        if (lease && !lease.terminal) {
            lease.complete({
                ok: false,
                error: { category, message: "connection severed (fake)" },
            });
            this.finishLease(lease);
        }
        this.observer.onLost(category);
    }

    async close(_context: DataPlaneOperationContext): Promise<void> {
        if (this.state === "closed") {
            return;
        }
        if (this.options.faults?.hangOnClose) {
            return new Promise<never>(() => undefined);
        }
        this.state = "closing";
        const lease = this.activeLease;
        if (lease && !lease.terminal) {
            lease.canceled = true;
            await this.clock.yield();
        }
        this.state = "closed";
        this.installedListeners = 0;
    }

    destroy(_reason: string): void {
        if (this.state === "closed" || this.state === "lost") {
            return;
        }
        this.sever("network");
    }

    /** Simulate an out-of-band ENVCHANGE (no active query). */
    signalDatabaseChanged(database: string): void {
        this.observer.onDatabaseChanged(database);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => this.clock.setTimeout(resolve, ms));
    }

    private sleepTick(): Promise<void> {
        return new Promise((resolve) => this.clock.setTimeout(resolve, 1));
    }
}

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

class FakeLease implements ITdsQueryLease {
    paused = false;
    canceled = false;
    terminal = false;
    readonly pauseReasons = new Set<TdsPauseReason>();
    readonly accepted: Promise<void>;
    readonly completed: Promise<TdsCompletion>;
    private acceptResolve!: () => void;
    private acceptReject!: (error: Error) => void;
    private completeResolve!: (completion: TdsCompletion) => void;
    private acceptedSettled = false;

    constructor(readonly generation: number) {
        this.accepted = new Promise<void>((resolve, reject) => {
            this.acceptResolve = resolve;
            this.acceptReject = reject;
        });
        // Callers may observe completion without awaiting accepted first.
        this.accepted.catch(() => undefined);
        this.completed = new Promise<TdsCompletion>((resolve) => {
            this.completeResolve = resolve;
        });
    }

    resolveAccepted(): void {
        if (!this.acceptedSettled) {
            this.acceptedSettled = true;
            this.acceptResolve();
        }
    }

    rejectAccepted(error: Error): void {
        if (!this.acceptedSettled) {
            this.acceptedSettled = true;
            this.acceptReject(error);
        }
    }

    complete(completion: TdsCompletion): void {
        if (this.terminal) {
            return;
        }
        this.terminal = true;
        // Acceptance can never remain pending past terminal.
        this.rejectAccepted(new Error("completed before acceptance"));
        this.completeResolve(completion);
    }

    pause(reason: TdsPauseReason): void {
        this.pauseReasons.add(reason);
        this.paused = true;
    }

    resume(reason: TdsPauseReason): void {
        this.pauseReasons.delete(reason);
        this.paused = this.pauseReasons.size > 0;
    }

    async cancel(_reason: TdsCancelReason): Promise<TdsCancelResult> {
        this.canceled = true;
        return { delivered: true };
    }
}
