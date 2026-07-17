/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio SAFE replay adapter (WI-3.6/WI-3.7 / addendum §7.8):
 * execution classification, exact target binding with NO first-document
 * fallback, the mutating-mode gate, textless refusals, the estimated-plan
 * confirmation naming target + item count, cancellation reaching the (fake)
 * execution host's real cancel path, and durable persistence + catalog
 * listing with featureId "queryStudio". Fakes only — nothing here ever
 * touches a real connection.
 */

import { expect } from "chai";
import { FeatureReplayEngine } from "../../src/diagnostics/featureCapture/replayEngine";
import {
    listReplayRunManifests,
    readReplayRunDetail,
} from "../../src/diagnostics/featureCapture/replayRunCatalog";
import { ReplayRunRepository } from "../../src/diagnostics/featureCapture/replayRunRepository";
import {
    buildReplayRunListResult,
    projectDurableReplayItemRow,
} from "../../src/diagnostics/replayLabRpcHost";
import { computeQsProfileFingerprint } from "../../src/queryStudio/replay/qsRunCapture";
import {
    createQsReplayHost,
    createQsReplayRunObserver,
    liveTargetFingerprint,
    resolveQsReplayTarget,
    QsReplayExecutionHostLike,
    QsReplayTargetModel,
} from "../../src/queryStudio/replay/qsReplayAdapter";
import {
    classifyQsReplayExecution,
    classifyQsReplaySafety,
    QS_MUTATING_REPLAY_BLOCKED_REASON,
    QS_MUTATING_REPLAY_GATE,
    QS_NO_TARGET_BLOCKED_REASON,
    QS_TEXTLESS_BLOCKED_REASON,
} from "../../src/queryStudio/replay/qsReplaySafety";
import { FeatureReplayTags } from "../../src/sharedInterfaces/featureReplay";
import {
    QS_RUN_RECORD_VERSION,
    QsReplayConfig,
    QsReplayMatrixCell,
    QsRunRecord,
} from "../../src/sharedInterfaces/queryStudioReplay";
import { MemJournalFs } from "./support/memJournalFs";

// ---------------------------------------------------------------------------
// Fakes (NEVER a real connection)
// ---------------------------------------------------------------------------

class FakeExecutionHost implements QsReplayExecutionHostLike {
    executionState: { kind: string } = { kind: "idle" };
    executeCalls: Array<{
        text: string;
        options: {
            scope: string;
            mode?: string;
            replayTags?: FeatureReplayTags;
        };
    }> = [];
    setDatabaseCalls: string[] = [];
    cancelCalls = 0;
    /** false = the run hangs until finish()/cancel() settles it. */
    autoComplete = true;
    private listeners = new Set<{ onExecutionStateChanged(): void }>();

    execute(
        text: string,
        options: { scope: "selection" | "document"; mode?: string; replayTags?: FeatureReplayTags },
    ): { started: boolean; reason?: string } {
        this.executeCalls.push({ text, options });
        this.executionState = { kind: "executing" };
        if (this.autoComplete) {
            queueMicrotask(() => this.finish("succeeded"));
        }
        return { started: true };
    }

    /** Terminal-state transition, fanning the state change like the real host. */
    finish(kind: string): void {
        this.executionState = { kind };
        for (const listener of [...this.listeners]) {
            listener.onExecutionStateChanged();
        }
    }

    async setDatabase(database: string): Promise<boolean> {
        this.setDatabaseCalls.push(database);
        return true;
    }

    /** The REAL cancel seam: acknowledge, then settle the run as canceled. */
    async cancel(): Promise<{ acknowledged: boolean }> {
        this.cancelCalls++;
        queueMicrotask(() => this.finish("canceled"));
        return { acknowledged: true };
    }

    attach(listener: {
        onExecutionStateChanged(): void;
        onResultSetStarted(summary: never): void;
        onRowsAppended(resultSetId: string, newRowCount: number, complete: boolean): void;
        onResultSetEnded(resultSetId: string, rowCount: number, truncatedReason?: string): void;
        onMessages(messages: never): void;
    }): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }
}

class FakeQsTarget implements QsReplayTargetModel {
    readonly executionHost = new FakeExecutionHost();
    connected = true;

    constructor(
        readonly uriKey: string,
        private readonly server: string | undefined,
        private readonly database: string | undefined,
        private readonly fileName: string,
    ) {}

    get backingDocument(): { fileName: string } {
        return { fileName: this.fileName };
    }

    get sessionBinding(): { activeSession?: { info: object } | undefined } {
        return this.connected
            ? { activeSession: { info: { server: this.server, database: this.database } } }
            : { activeSession: undefined };
    }
}

function record(id: string, overrides: Partial<QsRunRecord> = {}): QsRunRecord {
    return {
        id,
        timestamp: 1_000,
        result: "succeeded",
        recordVersion: QS_RUN_RECORD_VERSION,
        documentUriDigest: "uri:sha256:doc",
        profileFingerprint: computeQsProfileFingerprint("srv-a", "db-a"),
        database: "db-a",
        scope: "document",
        mode: "parseOnly",
        splitterVersion: "lexer-v1",
        scriptText: "SELECT canary FROM T1",
        scriptCharCount: 21,
        batches: [{ ordinal: 0, textDigest: "sql:sha256:b", charCount: 21 }],
        elevated: true,
        capturePolicyId: "test",
        ...overrides,
    };
}

interface Harness {
    engine: FeatureReplayEngine<QsRunRecord, QsReplayConfig, QsReplayMatrixCell>;
    targets: FakeQsTarget[];
    confirms: string[];
    setConfirmAnswer(answer: boolean): void;
    selectTarget(uriKey: string | undefined): void;
    errors: string[];
    dispose(): void;
}

function createHarness(targets: FakeQsTarget[], repository?: ReplayRunRepository): Harness {
    let selected: string | undefined;
    let confirmAnswer = true;
    const confirms: string[] = [];
    const errors: string[] = [];
    let disposed = false;
    const engine = new FeatureReplayEngine<QsRunRecord, QsReplayConfig, QsReplayMatrixCell>(
        createQsReplayHost({
            listTargets: () => targets,
            getSelectedTargetUriKey: () => selected,
            confirmReadOnlyRun: async (message) => {
                confirms.push(message);
                return confirmAnswer;
            },
            getLiveOverrides: () => ({
                database: null,
                mode: null,
                stopOnError: null,
                tuning: null,
            }),
            onExecuteError: (message) => errors.push(message),
            onStateChanged: () => undefined,
            isDisposed: () => disposed,
        }),
    );
    if (repository) {
        engine.setRunObserver(
            createQsReplayRunObserver(repository, {
                setRunDurable: (runId, durable) => engine.setRunDurable(runId, durable),
                isDisposed: () => disposed,
                getExplicitTarget: () => undefined,
            }),
        );
    }
    return {
        engine,
        targets,
        confirms,
        setConfirmAnswer: (answer) => (confirmAnswer = answer),
        selectTarget: (uriKey) => (selected = uriKey),
        errors,
        dispose: () => {
            disposed = true;
            engine.dispose();
        },
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function lastRun(harness: Harness) {
    const runs = harness.engine.getState().runs;
    return runs[runs.length - 1]!;
}

async function waitForTerminalRun(harness: Harness): Promise<ReturnType<typeof lastRun>> {
    await waitFor(() =>
        ["completed", "failed", "cancelled", "partial"].includes(lastRun(harness).status),
    );
    return lastRun(harness);
}

// ---------------------------------------------------------------------------
// §7.8.1 classification
// ---------------------------------------------------------------------------

suite("Query Studio replay safety classification (§7.8.1)", () => {
    test("classification matrix: record mode × config override", () => {
        const cases: Array<{
            recordMode: QsRunRecord["mode"];
            configMode: QsReplayConfig["mode"];
            expected: string;
        }> = [
            { recordMode: "parseOnly", configMode: null, expected: "noExecution" },
            { recordMode: "estimatedPlan", configMode: null, expected: "readOnlyExpected" },
            { recordMode: "normal", configMode: null, expected: "potentiallyMutating" },
            { recordMode: "actualPlan", configMode: null, expected: "potentiallyMutating" },
            // config override wins over the record's captured mode
            { recordMode: "normal", configMode: "parseOnly", expected: "noExecution" },
            { recordMode: "parseOnly", configMode: "normal", expected: "potentiallyMutating" },
            { recordMode: "parseOnly", configMode: "estimatedPlan", expected: "readOnlyExpected" },
            {
                recordMode: "estimatedPlan",
                configMode: "actualPlan",
                expected: "potentiallyMutating",
            },
        ];
        for (const item of cases) {
            expect(
                classifyQsReplayExecution({ mode: item.recordMode }, { mode: item.configMode }),
                `${item.recordMode} + ${item.configMode ?? "record"}`,
            ).to.equal(item.expected);
        }
        // Unknown modes classify as the most severe class.
        expect(
            classifyQsReplayExecution(
                { mode: "somethingNew" as QsRunRecord["mode"] },
                { mode: null },
            ),
        ).to.equal("potentiallyMutating");
    });

    test("safety assessment shapes per class (§7.8.3)", () => {
        const none = classifyQsReplaySafety(["noExecution"]);
        expect(none.sideEffectClass).to.equal("none");
        expect(none.targetBinding).to.equal("exactRequired");
        expect(none.requiresConfirmation).to.equal(false);
        expect(none.requiresSandbox).to.equal(false);
        expect(none.blockedReason).to.equal(undefined);

        const readOnly = classifyQsReplaySafety(["noExecution", "readOnlyExpected"]);
        expect(readOnly.sideEffectClass).to.equal("readOnlyExpected");
        expect(readOnly.targetBinding).to.equal("exactRequired");
        expect(readOnly.requiresConfirmation).to.equal(true);
        expect(readOnly.requiresSandbox).to.equal(false);
        expect(readOnly.blockedReason).to.equal(undefined);

        const mutating = classifyQsReplaySafety(["readOnlyExpected", "potentiallyMutating"]);
        expect(mutating.sideEffectClass).to.equal("potentiallyMutating");
        expect(mutating.requiresConfirmation).to.equal(true);
        expect(mutating.requiresSandbox).to.equal(true);
        expect(mutating.blockedReason).to.equal(QS_MUTATING_REPLAY_BLOCKED_REASON);
    });

    test("WI-3.7: the mutating gate is a closed code-level constant", () => {
        expect(QS_MUTATING_REPLAY_GATE).to.equal(false);
    });
});

// ---------------------------------------------------------------------------
// §7.8.2 target binding
// ---------------------------------------------------------------------------

suite("Query Studio replay target binding (§7.8.2)", () => {
    test("fingerprint match binds; the digest path matches capture's", () => {
        const matching = new FakeQsTarget("doc-a", "srv-a", "db-a", "a.sql");
        const other = new FakeQsTarget("doc-b", "srv-b", "db-b", "b.sql");
        expect(liveTargetFingerprint(matching)).to.equal(
            computeQsProfileFingerprint("srv-a", "db-a"),
        );
        const resolution = resolveQsReplayTarget(record("R-1"), [other, matching], undefined);
        expect(resolution).to.not.equal(undefined);
        expect(resolution!.model).to.equal(matching);
        expect(resolution!.binding).to.equal("fingerprintMatch");
        expect(resolution!.targetRef.kind).to.equal("qsDocument");
        expect(resolution!.targetRef.label).to.equal("a.sql");
        expect(resolution!.targetRef.fingerprint).to.equal(record("R-1").profileFingerprint);
    });

    test("NO first-document fallback: two open documents, neither matches → unresolved", () => {
        const first = new FakeQsTarget("doc-1", "srv-x", "db-x", "x.sql");
        const second = new FakeQsTarget("doc-2", "srv-y", "db-y", "y.sql");
        const resolution = resolveQsReplayTarget(record("R-1"), [first, second], undefined);
        expect(resolution).to.equal(undefined);
    });

    test("explicit selection binds a non-matching target and is labeled as such", () => {
        const first = new FakeQsTarget("doc-1", "srv-x", "db-x", "x.sql");
        const second = new FakeQsTarget("doc-2", "srv-y", "db-y", "y.sql");
        const resolution = resolveQsReplayTarget(record("R-1"), [first, second], "doc-2");
        expect(resolution).to.not.equal(undefined);
        expect(resolution!.model).to.equal(second);
        expect(resolution!.binding).to.equal("explicitSelection");
        expect(resolution!.targetRef.label).to.equal("y.sql");
    });

    test("a record with no fingerprint resolves ONLY through explicit selection", () => {
        const target = new FakeQsTarget("doc-1", "srv-x", "db-x", "x.sql");
        const noFingerprint = record("R-1", { profileFingerprint: undefined });
        expect(resolveQsReplayTarget(noFingerprint, [target], undefined)).to.equal(undefined);
        expect(resolveQsReplayTarget(noFingerprint, [target], "doc-1")?.binding).to.equal(
            "explicitSelection",
        );
    });

    test("end to end: replay executes on the MATCHING document, never the first", async () => {
        const first = new FakeQsTarget("doc-1", "srv-other", "db-other", "other.sql");
        const matching = new FakeQsTarget("doc-2", "srv-a", "db-a", "match.sql");
        const harness = createHarness([first, matching]);

        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);

        expect(run.status).to.equal("completed");
        expect(first.executionHost.executeCalls.length).to.equal(0);
        expect(matching.executionHost.executeCalls.length).to.equal(1);
        expect(matching.executionHost.executeCalls[0].options.mode).to.equal("parseOnly");
        expect(matching.executionHost.executeCalls[0].options.replayTags?.replayRunId).to.equal(
            run.id,
        );
        harness.dispose();
    });

    test("end to end: no candidate target → run refused with the explicit-selection reason", async () => {
        const first = new FakeQsTarget("doc-1", "srv-x", "db-x", "x.sql");
        const second = new FakeQsTarget("doc-2", "srv-y", "db-y", "y.sql");
        const harness = createHarness([first, second]);

        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);

        expect(run.status).to.equal("failed");
        expect(run.errorMessage).to.equal(QS_NO_TARGET_BLOCKED_REASON);
        // Nothing executed anywhere — no silent substitution (§2.2.5).
        expect(first.executionHost.executeCalls.length).to.equal(0);
        expect(second.executionHost.executeCalls.length).to.equal(0);
        harness.dispose();
    });
});

// ---------------------------------------------------------------------------
// Preflight refusals + confirmation (§7.8.3, WI-3.7)
// ---------------------------------------------------------------------------

suite("Query Studio replay preflight (§7.8.3 / WI-3.7)", () => {
    test("mutating gate: a normal-mode record refuses the whole run", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "a.sql");
        const harness = createHarness([target]);
        harness.engine.addToCart([{ event: record("R-1", { mode: "normal" }) }]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);
        expect(run.status).to.equal("failed");
        expect(run.errorMessage).to.equal(QS_MUTATING_REPLAY_BLOCKED_REASON);
        expect(run.safety?.sideEffectClass).to.equal("potentiallyMutating");
        expect(run.safety?.requiresSandbox).to.equal(true);
        expect(target.executionHost.executeCalls.length).to.equal(0);
        harness.dispose();
    });

    test("mutating gate: an actualPlan matrix cell refuses the run too", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "a.sql");
        const harness = createHarness([target]);
        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.runMatrix([
            { cellId: "cell-1", ordinal: 1, mode: "actualPlan", label: "record db x actualPlan" },
        ]);
        const run = await waitForTerminalRun(harness);
        expect(run.status).to.equal("failed");
        expect(run.errorMessage).to.equal(QS_MUTATING_REPLAY_BLOCKED_REASON);
        expect(target.executionHost.executeCalls.length).to.equal(0);
        harness.dispose();
    });

    test("digest-only records (no SQL text) refuse with the elevated-capture reason", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "a.sql");
        const harness = createHarness([target]);
        harness.engine.addToCart([
            { event: record("R-1", { scriptText: undefined, elevated: false }) },
        ]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);
        expect(run.status).to.equal("failed");
        expect(run.errorMessage).to.equal(QS_TEXTLESS_BLOCKED_REASON);
        expect(target.executionHost.executeCalls.length).to.equal(0);
        harness.dispose();
    });

    test("readOnlyExpected: confirmation names target and item count; declining refuses", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "plan.sql");
        const harness = createHarness([target]);
        harness.setConfirmAnswer(false);
        harness.engine.addToCart([
            { event: record("R-1", { mode: "estimatedPlan" }) },
            { event: record("R-2", { mode: "estimatedPlan" }) },
        ]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);

        expect(harness.confirms.length).to.equal(1);
        expect(harness.confirms[0]).to.contain("2 estimated-plan items");
        expect(harness.confirms[0]).to.contain("plan.sql");
        expect(run.status).to.equal("failed");
        expect(run.errorMessage).to.contain("declined");
        expect(target.executionHost.executeCalls.length).to.equal(0);

        // Accepting runs the same cart.
        harness.setConfirmAnswer(true);
        harness.engine.queueCart();
        const second = await waitForTerminalRun(harness);
        expect(second.status).to.equal("completed");
        expect(target.executionHost.executeCalls.length).to.equal(2);
        expect(run.safety?.requiresConfirmation).to.equal(true);
        harness.dispose();
    });

    test("parse-only runs queue WITHOUT a confirmation (noExecution)", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "a.sql");
        const harness = createHarness([target]);
        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);
        expect(run.status).to.equal("completed");
        expect(harness.confirms.length).to.equal(0);
        expect(run.safety?.sideEffectClass).to.equal("none");
        expect(run.safety?.requiresConfirmation).to.equal(false);
        harness.dispose();
    });

    test("estimate: sources × cells with the §7.8 estimated-plan warning naming the target", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "plan.sql");
        const harness = createHarness([target]);
        harness.engine.addToCart([
            { event: record("R-1", { mode: "estimatedPlan" }) },
            { event: record("R-2", { mode: "estimatedPlan" }) },
        ]);
        harness.engine.runMatrix([
            { cellId: "cell-1", ordinal: 1, mode: "estimatedPlan", label: "db-a x estimatedPlan" },
            { cellId: "cell-2", ordinal: 2, mode: "parseOnly", label: "db-a x parseOnly" },
        ]);
        const run = await waitForTerminalRun(harness);
        expect(run.estimate?.sourceItems).to.equal(2);
        expect(run.estimate?.matrixCells).to.equal(2);
        expect(run.estimate?.totalExecutions).to.equal(4);
        expect(
            run.estimate?.warnings.some(
                (warning) => warning.includes("estimated-plan") && warning.includes("plan.sql"),
            ),
        ).to.equal(true);
        harness.dispose();
    });
});

// ---------------------------------------------------------------------------
// Cancellation (§7.8.4)
// ---------------------------------------------------------------------------

suite("Query Studio replay cancellation (§7.8.4)", () => {
    test("cancelRun reaches the execution host's real cancel; outcome is cancelledInFlight", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "a.sql");
        target.executionHost.autoComplete = false; // the run hangs until cancelled
        const harness = createHarness([target]);

        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        await waitFor(() => target.executionHost.executeCalls.length === 1);

        harness.engine.cancelRun(undefined);
        const run = await waitForTerminalRun(harness);

        expect(target.executionHost.cancelCalls).to.equal(1);
        expect(run.status).to.equal("cancelled");
        expect(run.cancelRequestedAt).to.be.a("number");
        harness.dispose();
    });

    test("cancel acknowledged but the run completed anyway → cancelRequestedButCompleted", async () => {
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "a.sql");
        target.executionHost.autoComplete = false;
        // The fake acknowledges the cancel but the run still SUCCEEDS (races
        // the backend): the adapter must not claim cancelledInFlight.
        target.executionHost.cancel = async function (this: FakeExecutionHost) {
            this.cancelCalls++;
            queueMicrotask(() => this.finish("succeeded"));
            return { acknowledged: true };
        }.bind(target.executionHost);

        const outcomes: string[] = [];
        const harness = createHarness([target]);
        harness.engine.setRunObserver({
            onItemSettled: (outcome) => {
                if (outcome.cancellationOutcome) {
                    outcomes.push(outcome.cancellationOutcome);
                }
            },
        });
        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        await waitFor(() => target.executionHost.executeCalls.length === 1);
        harness.engine.cancelRun(undefined);
        await waitForTerminalRun(harness);

        expect(target.executionHost.cancelCalls).to.equal(1);
        expect(outcomes).to.deep.equal(["cancelRequestedButCompleted"]);
        harness.dispose();
    });
});

// ---------------------------------------------------------------------------
// Durable persistence + catalog listing (WI-3.6 Lab integration)
// ---------------------------------------------------------------------------

suite("Query Studio replay durable runs (WI-3.6)", () => {
    test("runs persist with featureId queryStudio, per-item target fields, and list via the catalog", async () => {
        const memFs = new MemJournalFs();
        const repository = new ReplayRunRepository({
            storeRoot: "C:/store",
            hostSessionId: "hs-qs",
            featureId: "queryStudio",
            fs: memFs,
            debounceMs: 60_000,
        });
        const target = new FakeQsTarget("doc-1", "srv-a", "db-a", "match.sql");
        const harness = createHarness([target], repository);

        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);
        expect(run.status).to.equal("completed");
        await waitFor(
            () => run.id !== undefined && harness.engine.getState().runs[0]!.durable === true,
        );
        await repository.flushBarrier();

        // Catalog listing — the dc/replayRunList projection over the store.
        const catalog = await listReplayRunManifests({
            storeRoot: "C:/store",
            currentHostSessionId: "hs-qs",
            fs: memFs,
        });
        expect(catalog.entries.length).to.equal(1);
        const manifest = catalog.entries[0].manifest;
        expect(manifest.featureId).to.equal("queryStudio");
        expect(manifest.semantics).to.equal("interactiveExperiment");
        expect(manifest.status).to.equal("completed");
        expect(manifest.safety.sideEffectClass).to.equal("none");
        expect(manifest.safety.targetBinding).to.equal("exactRequired");

        const list = buildReplayRunListResult({
            entries: catalog.entries,
            issues: catalog.issues,
            params: undefined,
            currentHostSessionId: "hs-qs",
            storeAvailable: true,
        });
        expect(list.rows.length).to.equal(1);
        expect(list.rows[0].featureId).to.equal("queryStudio");
        expect(list.rows[0].completedItems).to.equal(1);

        // Detail: items.jsonl carries fingerprint + database per item, and
        // the Lab projection exposes the compact target column fields.
        const detail = await readReplayRunDetail({
            storeRoot: "C:/store",
            hostSessionId: "hs-qs",
            replayRunId: run.id,
            fs: memFs,
        });
        expect(detail.items.length).to.equal(1);
        expect(detail.items[0].status).to.equal("completed");
        expect(detail.items[0].replayMode).to.equal("parseOnly");
        expect(detail.items[0].target?.kind).to.equal("qsDocument");
        expect(detail.items[0].target?.label).to.equal("match.sql");
        expect(detail.items[0].target?.fingerprint).to.equal(
            computeQsProfileFingerprint("srv-a", "db-a"),
        );
        expect(detail.items[0].targetDatabase).to.equal("db-a");
        const row = projectDurableReplayItemRow(detail.items[0], detail.manifest);
        expect(row.targetLabel).to.equal("match.sql");
        expect(row.targetDatabase).to.equal("db-a");
        expect(row.targetFingerprint).to.equal(computeQsProfileFingerprint("srv-a", "db-a"));

        // Config groups persisted sanitized (QS keys are allowlisted).
        expect(detail.configGroups?.length).to.equal(1);
        expect(detail.configGroups?.[0].featureId).to.equal("queryStudio");
        expect(detail.configGroups?.[0].effectiveConfig?.mode).to.equal("parseOnly");

        harness.dispose();
        await repository.dispose();
    });

    test("a refused run (no target) still leaves an honest failed manifest", async () => {
        const memFs = new MemJournalFs();
        const repository = new ReplayRunRepository({
            storeRoot: "C:/store",
            hostSessionId: "hs-qs2",
            featureId: "queryStudio",
            fs: memFs,
            debounceMs: 60_000,
        });
        const target = new FakeQsTarget("doc-1", "srv-x", "db-x", "x.sql");
        const harness = createHarness([target], repository);
        harness.engine.addToCart([{ event: record("R-1") }]);
        harness.engine.queueCart();
        const run = await waitForTerminalRun(harness);
        expect(run.status).to.equal("failed");
        await repository.flushBarrier();

        const catalog = await listReplayRunManifests({
            storeRoot: "C:/store",
            currentHostSessionId: "hs-qs2",
            fs: memFs,
        });
        // Preflight-refused runs never reach onRunQueued (no items ever
        // planned), so nothing durable exists — the honest UI-only failed
        // state carries the reason.
        expect(catalog.entries.length).to.equal(0);
        expect(run.errorMessage).to.equal(QS_NO_TARGET_BLOCKED_REASON);
        harness.dispose();
        await repository.dispose();
    });
});
