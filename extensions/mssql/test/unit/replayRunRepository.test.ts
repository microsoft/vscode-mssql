/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable replay-run repository (final plan WI-3.3 / addendum §7.3):
 * manifest lifecycle (queued → running → completed/cancelled/partial),
 * atomic tmp+rename with fault injection, per-terminal items.jsonl appends,
 * restart reconciliation marking dead runs partial, bundle descriptor
 * registration, and total failure isolation.
 */

import { expect } from "chai";
import { sha256OfCanonicalJson } from "../../src/diagnostics/featureCapture/configGroups";
import {
    REPLAY_RUN_CONFIG_GROUPS_FILE,
    REPLAY_RUN_MANIFEST_SCHEMA,
    ReplayRunBeginInput,
    ReplayRunBundleRegistrar,
    ReplayRunItemRecordV1,
    ReplayRunManifestV1,
    ReplayRunRepository,
    reconcileReplayRunsOnStartup,
} from "../../src/diagnostics/featureCapture/replayRunRepository";
import {
    ObservabilityArtifactDescriptorInputV1,
    ObservabilityArtifactPatchV1,
} from "../../src/diagnostics/sessionBundle/bundleManager";
import { ConfigGroupV1 } from "../../src/sharedInterfaces/configGroup";
import { ManualClock, MemJournalFs } from "./support/memJournalFs";

const STORE = "C:/store";
const HOST = "hs-current";

class FakeRegistrar implements ReplayRunBundleRegistrar {
    registered: Array<{ hostSessionId: string; input: ObservabilityArtifactDescriptorInputV1 }> =
        [];
    updated: Array<{ artifactId: string; patch: ObservabilityArtifactPatchV1 }> = [];
    closed: Array<{ artifactId: string; patch?: ObservabilityArtifactPatchV1 }> = [];

    async registerArtifact(
        hostSessionId: string,
        input: ObservabilityArtifactDescriptorInputV1,
    ): Promise<void> {
        this.registered.push({ hostSessionId, input });
    }

    async updateArtifact(
        _hostSessionId: string,
        artifactId: string,
        patch: ObservabilityArtifactPatchV1,
    ): Promise<boolean> {
        this.updated.push({ artifactId, patch });
        return true;
    }

    async closeArtifact(
        _hostSessionId: string,
        artifactId: string,
        patch?: ObservabilityArtifactPatchV1,
    ): Promise<boolean> {
        this.closed.push({ artifactId, patch });
        return true;
    }
}

function testConfigGroup(label: string, digest: string): ConfigGroupV1 {
    return {
        schema: "mssql.configGroup/1",
        configGroupId: `cg-${digest.slice(0, 16)}`,
        featureId: "testFeature",
        version: 1,
        label,
        partialOverrides: { speed: "fast" },
        effectiveConfig: { speed: "fast", depth: "deep" },
        effectiveConfigDigest: digest,
        settingMutability: { speed: "hot", depth: "hot" },
    };
}

function beginInput(
    runId: string,
    overrides: Partial<ReplayRunBeginInput> = {},
): ReplayRunBeginInput {
    const digest = sha256OfCanonicalJson({ speed: "fast", depth: "deep" });
    return {
        replayRunId: runId,
        createdAt: 1_000_000,
        sources: [
            {
                captureSessionId: "cs-1",
                captureEventId: "ce-source-1",
                label: "Live · 10:00:00",
                snapshotJson: { id: "E-1", timestamp: 100, result: "success" },
            },
            {
                captureSessionId: "cs-1",
                captureEventId: "ce-source-2",
                label: "Live · 10:00:05",
                snapshotJson: { id: "E-2", timestamp: 105, result: "success" },
            },
        ],
        configGroups: [testConfigGroup("Fast x Deep", digest)],
        cells: [
            {
                matrixCellId: "cell-1",
                configGroupId: `cg-${digest.slice(0, 16)}`,
                label: "Fast x Deep",
                ordinal: 1,
            },
        ],
        repetitions: 1,
        expectedItems: 2,
        estimate: {
            sourceItems: 2,
            matrixCells: 1,
            repetitions: 1,
            totalExecutions: 2,
            warnings: [],
        },
        safety: {
            sideEffectClass: "none",
            targetBinding: "none",
            requiresConfirmation: false,
            requiresSandbox: false,
            reasons: ["model call only"],
        },
        ...overrides,
    };
}

function itemInput(replayItemId: string, status: "completed" | "failed" | "cancelled") {
    return {
        replayItemId,
        sourceCaptureEventId: "ce-source-1",
        matrixCellId: "cell-1",
        repetition: 1,
        queuedAt: 1_000_010,
        startedAt: 1_000_020,
        endedAt: 1_000_030,
        resolvedConfigDigest: "d".repeat(64),
        status,
        attempt: 1,
    };
}

function runDir(runId: string): string {
    return `${STORE}/sessions/${HOST}/replay/${runId}`;
}

function readManifest(memFs: MemJournalFs, runId: string): ReplayRunManifestV1 {
    const raw = memFs.files.get(`${runDir(runId)}/manifest.json`);
    expect(raw, `manifest.json for ${runId}`).to.be.a("string");
    return JSON.parse(raw!) as ReplayRunManifestV1;
}

function readItems(memFs: MemJournalFs, runId: string): ReplayRunItemRecordV1[] {
    const raw = memFs.files.get(`${runDir(runId)}/items.jsonl`) ?? "";
    return raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as ReplayRunItemRecordV1);
}

function makeRepository(
    memFs: MemJournalFs,
    clock: ManualClock,
    registrar?: ReplayRunBundleRegistrar,
): ReplayRunRepository {
    return new ReplayRunRepository({
        storeRoot: STORE,
        hostSessionId: HOST,
        featureId: "testFeature",
        provenance: { extensionVersion: "1.45.0-test" },
        bundleRegistrar: registrar,
        fs: memFs,
        clock,
        // Tests drive writes through terminal flushes and explicit barriers.
        debounceMs: 60_000,
    });
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

suite("Replay run repository", () => {
    test("manifest lifecycle: queued → running → completed, with §7.3 fields", async () => {
        const memFs = new MemJournalFs();
        const clock = new ManualClock();
        const repository = makeRepository(memFs, clock);

        const durable = await repository.beginRun(beginInput("rr-test-1"));
        expect(durable).to.equal(true);

        let manifest = readManifest(memFs, "rr-test-1");
        expect(manifest.schema).to.equal(REPLAY_RUN_MANIFEST_SCHEMA);
        expect(manifest.replayRunId).to.equal("rr-test-1");
        expect(manifest.featureId).to.equal("testFeature");
        expect(manifest.semantics).to.equal("interactiveExperiment");
        expect(manifest.status).to.equal("queued");
        expect(manifest.expectedItems).to.equal(2);
        expect(manifest.repetitions).to.equal(1);
        expect(manifest.sources.length).to.equal(2);
        expect(manifest.sources[0].snapshotDigest).to.equal(
            sha256OfCanonicalJson({ id: "E-1", timestamp: 100, result: "success" }),
        );
        expect(manifest.sourceBasketDigest).to.match(/^[0-9a-f]{64}$/);
        expect(manifest.configGroups[0].effectiveConfigDigest).to.match(/^[0-9a-f]{64}$/);
        expect(manifest.cells[0].configGroupId).to.equal(manifest.configGroups[0].configGroupId);
        expect(manifest.estimate?.totalExecutions).to.equal(2);
        expect(manifest.safety.sideEffectClass).to.equal("none");
        expect(manifest.provenance).to.deep.equal({ extensionVersion: "1.45.0-test" });
        // Frozen config groups persist next to the manifest, SANITIZED
        // through the shared allowlist (§7.6): the test feature's unknown
        // keys ("speed"/"depth") are dropped, while identity and the
        // ORIGINAL effective digest survive.
        const groupsRaw = memFs.files.get(
            `${runDir("rr-test-1")}/${REPLAY_RUN_CONFIG_GROUPS_FILE}`,
        );
        expect(groupsRaw).to.be.a("string");
        const persistedGroup = (JSON.parse(groupsRaw!) as ConfigGroupV1[])[0];
        expect(persistedGroup.configGroupId).to.equal(manifest.configGroups[0].configGroupId);
        expect(persistedGroup.effectiveConfigDigest).to.equal(
            manifest.configGroups[0].effectiveConfigDigest,
        );
        expect(persistedGroup.partialOverrides).to.deep.equal({});
        expect(persistedGroup.effectiveConfig).to.deep.equal({});
        expect(persistedGroup.settingMutability).to.deep.equal({});

        clock.advance(1000);
        repository.noteRunStatus({ replayRunId: "rr-test-1", status: "running" });
        repository.recordItem("rr-test-1", itemInput("ri-1", "completed"));
        repository.recordItem("rr-test-1", itemInput("ri-2", "failed"));
        clock.advance(1000);
        repository.noteRunStatus({ replayRunId: "rr-test-1", status: "completed" });
        await repository.flushBarrier();

        manifest = readManifest(memFs, "rr-test-1");
        expect(manifest.status).to.equal("completed");
        expect(manifest.startedAt).to.equal(1_001_000);
        expect(manifest.endedAt).to.equal(1_002_000);
        expect(manifest.completedItems).to.equal(1);
        expect(manifest.failedItems).to.equal(1);
        expect(manifest.cancelledItems).to.equal(0);

        const items = readItems(memFs, "rr-test-1");
        expect(items.length).to.equal(2);
        expect(items[0]).to.deep.include({
            replayRunId: "rr-test-1",
            replayItemId: "ri-1",
            sourceCaptureEventId: "ce-source-1",
            matrixCellId: "cell-1",
            repetition: 1,
            status: "completed",
            attempt: 1,
        });
        expect(items[1].status).to.equal("failed");
    });

    test("cancelling → cancelled transition persists; terminal is terminal", async () => {
        const memFs = new MemJournalFs();
        const repository = makeRepository(memFs, new ManualClock());
        await repository.beginRun(beginInput("rr-cancel-1"));

        repository.noteRunStatus({ replayRunId: "rr-cancel-1", status: "running" });
        repository.noteRunStatus({ replayRunId: "rr-cancel-1", status: "cancelling" });
        repository.recordItem("rr-cancel-1", itemInput("ri-1", "cancelled"));
        repository.noteRunStatus({ replayRunId: "rr-cancel-1", status: "cancelled" });
        await repository.flushBarrier();

        let manifest = readManifest(memFs, "rr-cancel-1");
        expect(manifest.status).to.equal("cancelled");
        expect(manifest.cancelledItems).to.equal(1);

        // A late update cannot resurrect a terminal manifest.
        repository.noteRunStatus({ replayRunId: "rr-cancel-1", status: "running" });
        await repository.flushBarrier();
        manifest = readManifest(memFs, "rr-cancel-1");
        expect(manifest.status).to.equal("cancelled");
    });

    test("atomic rename fault injection: prior manifest survives, repository recovers", async () => {
        const memFs = new MemJournalFs();
        const repository = makeRepository(memFs, new ManualClock());
        await repository.beginRun(beginInput("rr-fault-1"));
        expect(readManifest(memFs, "rr-fault-1").status).to.equal("queued");

        let armed = true;
        memFs.failRename = (_from, to) =>
            armed && to === `${runDir("rr-fault-1")}/manifest.json`
                ? new Error("EIO: injected rename failure")
                : undefined;

        repository.noteRunStatus({ replayRunId: "rr-fault-1", status: "running" });
        await repository.flushBarrier();
        // The rename never landed: the previous manifest is intact and valid.
        expect(readManifest(memFs, "rr-fault-1").status).to.equal("queued");

        armed = false;
        repository.noteRunStatus({ replayRunId: "rr-fault-1", status: "completed" });
        await repository.flushBarrier();
        expect(readManifest(memFs, "rr-fault-1").status).to.equal("completed");
    });

    test("a dead filesystem degrades the repository without ever throwing", async () => {
        const memFs = new MemJournalFs();
        memFs.failWrite = () => new Error("ENOSPC: injected");
        const repository = makeRepository(memFs, new ManualClock());

        const durable = await repository.beginRun(beginInput("rr-dead-1"));
        expect(durable).to.equal(false);
        // Subsequent calls are contained no-ops.
        repository.noteRunStatus({ replayRunId: "rr-dead-1", status: "running" });
        repository.recordItem("rr-dead-1", itemInput("ri-1", "completed"));
        await repository.flushBarrier();
        await repository.dispose();
    });

    test("startup reconciliation marks dead-session running/cancelling runs partial", async () => {
        const memFs = new MemJournalFs();
        const seed = (session: string, runId: string, status: string) => {
            memFs.files.set(
                `${STORE}/sessions/${session}/replay/${runId}/manifest.json`,
                JSON.stringify({
                    schema: REPLAY_RUN_MANIFEST_SCHEMA,
                    replayRunId: runId,
                    featureId: "testFeature",
                    semantics: "interactiveExperiment",
                    createdAt: 1,
                    status,
                    sourceBasketDigest: "x",
                    sources: [],
                    configGroups: [],
                    cells: [],
                    repetitions: 1,
                    expectedItems: 1,
                    completedItems: 0,
                    failedItems: 0,
                    cancelledItems: 0,
                    safety: {
                        sideEffectClass: "none",
                        targetBinding: "none",
                        requiresConfirmation: false,
                        requiresSandbox: false,
                        reasons: [],
                    },
                    provenance: {},
                }),
            );
        };
        seed("hs-dead", "rr-a", "running");
        seed("hs-dead", "rr-b", "completed");
        seed("hs-dead", "rr-c", "cancelling");
        seed("hs-dead", "rr-d", "queued");
        seed(HOST, "rr-live", "running");

        const report = await reconcileReplayRunsOnStartup({
            storeRoot: STORE,
            currentHostSessionId: HOST,
            fs: memFs,
            clock: new ManualClock(5_000_000),
        });

        expect(report.runsScanned).to.equal(4);
        expect(report.runsMarkedPartial).to.equal(3);
        expect(report.issues).to.deep.equal([]);
        const readStatus = (session: string, runId: string) =>
            (
                JSON.parse(
                    memFs.files.get(`${STORE}/sessions/${session}/replay/${runId}/manifest.json`)!,
                ) as ReplayRunManifestV1
            ).status;
        expect(readStatus("hs-dead", "rr-a")).to.equal("partial");
        expect(readStatus("hs-dead", "rr-b")).to.equal("completed");
        expect(readStatus("hs-dead", "rr-c")).to.equal("partial");
        expect(readStatus("hs-dead", "rr-d")).to.equal("partial");
        // The CURRENT host session is never touched.
        expect(readStatus(HOST, "rr-live")).to.equal("running");
        const repaired = JSON.parse(
            memFs.files.get(`${STORE}/sessions/hs-dead/replay/rr-a/manifest.json`)!,
        ) as ReplayRunManifestV1;
        expect(repaired.endedAt).to.equal(5_000_000);
    });

    test("bundle descriptor registered as metadata-only replayRun, closed on terminal", async () => {
        const memFs = new MemJournalFs();
        const registrar = new FakeRegistrar();
        const repository = makeRepository(memFs, new ManualClock(), registrar);

        await repository.beginRun(beginInput("rr-bundle-1"));
        await waitFor(() => registrar.registered.length === 1);
        const input = registrar.registered[0].input;
        expect(registrar.registered[0].hostSessionId).to.equal(HOST);
        expect(input.artifactId).to.equal("rr-bundle-1");
        expect(input.kind).to.equal("replayRun");
        expect(input.schema).to.equal(REPLAY_RUN_MANIFEST_SCHEMA);
        expect(input.relativeManifest).to.equal("replay/rr-bundle-1/manifest.json");
        expect(input.status).to.equal("active");
        // The run manifest is metadata; rich results live in the journal.
        expect(input.classification.containsRichPayload).to.equal(false);
        expect(input.classification.maximumClass).to.equal("diagnostic.metadata");

        repository.recordItem("rr-bundle-1", itemInput("ri-1", "completed"));
        repository.noteRunStatus({ replayRunId: "rr-bundle-1", status: "completed" });
        await repository.flushBarrier();
        await waitFor(() => registrar.closed.length === 1);
        expect(registrar.closed[0].artifactId).to.equal("rr-bundle-1");
        expect(registrar.closed[0].patch?.status).to.equal("closed");

        // Partial terminal states close as partial (honesty).
        await repository.beginRun(beginInput("rr-bundle-2"));
        repository.noteRunStatus({ replayRunId: "rr-bundle-2", status: "partial" });
        await repository.flushBarrier();
        await waitFor(() => registrar.closed.length === 2);
        expect(registrar.closed[1].patch?.status).to.equal("partial");
    });

    test("dispose flushes pending state; duplicate beginRun is refused", async () => {
        const memFs = new MemJournalFs();
        const repository = makeRepository(memFs, new ManualClock());
        expect(await repository.beginRun(beginInput("rr-dispose-1"))).to.equal(true);
        expect(await repository.beginRun(beginInput("rr-dispose-1"))).to.equal(false);

        repository.noteRunStatus({ replayRunId: "rr-dispose-1", status: "running" });
        repository.recordItem("rr-dispose-1", itemInput("ri-1", "completed"));
        await repository.dispose();

        const manifest = readManifest(memFs, "rr-dispose-1");
        expect(manifest.status).to.equal("running");
        expect(manifest.completedItems).to.equal(1);
        expect(readItems(memFs, "rr-dispose-1").length).to.equal(1);
    });
});
