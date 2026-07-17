/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Observability session bundle (final plan WI-2.3 / addendum §3.1
 * Amendment A): the one session-level catalog with independently owned child
 * manifests. Covers the golden schema fixture, serialized + debounced +
 * atomic catalog writes, rebuild from child manifests, startup repair,
 * retention accounting over bundle totals, the clear-sensitive-captures
 * primitive (§9.4), and the SessionDiagSink notification seam.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    BundleFsLike,
    ObservabilityArtifactDescriptorInputV1,
    ObservabilityBundleManager,
    diagArtifactId,
    diagManifestToArtifactInput,
} from "../../src/diagnostics/sessionBundle/bundleManager";
import {
    OBSERVABILITY_BUNDLE_SCHEMA,
    ObservabilityBundleV1,
    computeBundleClassificationSummary,
    computeBundleTotals,
    isObservabilityBundleShape,
    isSafeBundleRelativePath,
    maxPayloadClass,
} from "../../src/diagnostics/sessionBundle/bundleSchemas";
import { FeatureCaptureJournalWriter } from "../../src/diagnostics/featureCapture/journal/journalWriter";
import { SessionDiagSink } from "../../src/diagnostics/sinks";
import { SessionStore } from "../../src/diagnostics/sessionStore";
import {
    DIAG_SCHEMA_VERSION,
    DiagEvent,
    SessionManifest,
} from "../../src/sharedInterfaces/debugConsole";
import { RichCapturePolicySnapshot } from "../../src/sharedInterfaces/featureTrace";
import { ManualClock, MemJournalFs } from "./support/memJournalFs";

// ---------------------------------------------------------------------------
// Fakes and fixtures
// ---------------------------------------------------------------------------

/** MemJournalFs + the recursive delete the bundle manager needs. */
class MemBundleFs extends MemJournalFs implements BundleFsLike {
    removed: string[] = [];

    async rmrf(target: string): Promise<void> {
        this.removed.push(target);
        for (const key of [...this.files.keys()]) {
            if (key === target || key.startsWith(`${target}/`) || key.startsWith(`${target}\\`)) {
                this.files.delete(key);
            }
        }
    }
}

const STORE = "C:/store";
const CURRENT_HOST = "hs-current";

function makeManager(
    memFs: MemBundleFs,
    clock: ManualClock,
    overrides: Partial<ConstructorParameters<typeof ObservabilityBundleManager>[0]> = {},
): ObservabilityBundleManager {
    return new ObservabilityBundleManager({
        storeRoot: STORE,
        currentHostSessionId: CURRENT_HOST,
        provenance: { extensionVersion: "1.45.0", platform: "test" },
        fs: memFs,
        clock,
        // Tests drive writes through explicit flush barriers by default so
        // write counts stay deterministic; the debounce test overrides this.
        debounceMs: 60_000,
        ...overrides,
    });
}

function bundlePath(hostSessionId: string): string {
    return `${STORE}/sessions/${hostSessionId}/bundle.json`;
}

/** Renames landing on a session's bundle.json = actual catalog writes. */
function bundleWrites(memFs: MemBundleFs, hostSessionId: string): number {
    const target = bundlePath(hostSessionId);
    return memFs.ops.filter((op) => op.op === "rename" && op.to === target).length;
}

function readBundle(memFs: MemBundleFs, hostSessionId: string): ObservabilityBundleV1 {
    const raw = memFs.files.get(bundlePath(hostSessionId));
    expect(raw, `bundle.json for ${hostSessionId}`).to.be.a("string");
    return JSON.parse(raw!) as ObservabilityBundleV1;
}

function diagManifest(
    sessionId: string,
    overrides: Partial<SessionManifest> = {},
): SessionManifest {
    return {
        schemaVersion: "mssql.diag.sessionManifest/1",
        sessionId,
        createdUtc: "2026-07-16T00:00:00.000Z",
        updatedUtc: "2026-07-16T00:05:00.000Z",
        source: "live",
        captureMode: "redacted",
        policyId: "policy-redacted",
        eventCount: 42,
        gapCount: 1,
        segments: [{ file: "segment-000001.jsonl", firstSeq: 1, lastSeq: 42, events: 42 }],
        sizeBytes: 1234,
        provenance: {},
        status: "closed",
        ...overrides,
    };
}

function diagArtifactInput(
    hostSessionId: string,
    overrides: Partial<ObservabilityArtifactDescriptorInputV1> = {},
): ObservabilityArtifactDescriptorInputV1 {
    return {
        artifactId: diagArtifactId(hostSessionId),
        kind: "diagStream",
        featureId: "sessionDiag",
        schema: "mssql.diag.sessionManifest/1",
        relativeManifest: "manifest.json",
        status: "active",
        events: 0,
        bytes: 0,
        gaps: 0,
        truncations: 0,
        classification: {
            containsRichPayload: false,
            maximumClass: "diagnostic.metadata",
            policyId: "policy-redacted",
        },
        ...overrides,
    };
}

const GOLDEN_BUNDLE: ObservabilityBundleV1 = {
    schema: OBSERVABILITY_BUNDLE_SCHEMA,
    bundleId: "ob-11111111-1111-1111-1111-111111111111",
    hostSessionId: "sess_20260716T010203_100",
    createdUtc: "2026-07-16T00:00:00.000Z",
    updatedUtc: "2026-07-16T01:00:00.000Z",
    closedUtc: "2026-07-16T01:00:00.000Z",
    status: "closed",
    provenance: {
        extensionVersion: "1.45.0",
        vscodeVersion: "1.102.0",
        platform: "win32",
    },
    artifacts: [
        {
            artifactId: "diag-sess_20260716T010203_100",
            kind: "diagStream",
            featureId: "sessionDiag",
            schema: "mssql.diag.sessionManifest/1",
            relativeManifest: "manifest.json",
            createdUtc: "2026-07-16T00:00:00.000Z",
            updatedUtc: "2026-07-16T01:00:00.000Z",
            status: "closed",
            events: 8142,
            bytes: 1_048_576,
            gaps: 2,
            truncations: 0,
            classification: {
                containsRichPayload: false,
                maximumClass: "diagnostic.metadata",
                policyId: "policy-redacted",
            },
        },
        {
            artifactId: "fc-cs-22222222-2222-2222-2222-222222222222",
            kind: "featureCapture",
            featureId: "completions",
            schema: "mssql.featureCapture.manifest/1",
            relativeManifest:
                "rich/completions/cs-22222222-2222-2222-2222-222222222222/manifest.json",
            createdUtc: "2026-07-16T00:10:00.000Z",
            updatedUtc: "2026-07-16T00:59:00.000Z",
            status: "closed",
            records: 640,
            events: 214,
            bytes: 4_194_304,
            gaps: 3,
            truncations: 1,
            classification: {
                containsRichPayload: true,
                maximumClass: "model.prompt",
                policyId: "policy-full-local",
                replayPayloadAvailable: true,
            },
            manifestDigest: "a1b2c3",
        },
    ],
    totals: {
        artifacts: 2,
        events: 8356,
        records: 640,
        bytes: 5_242_880,
        gaps: 5,
        truncations: 1,
    },
    classificationSummary: {
        containsRichPayload: true,
        maximumClass: "model.prompt",
        richArtifactCount: 1,
        replayPayloadAvailable: true,
    },
};

const RICH_POLICY: RichCapturePolicySnapshot = {
    schema: "mssql.richCapturePolicy/1",
    policyId: "policy-full-local",
    featureId: "completions",
    fidelity: "fullLocal",
    persistence: "localJournal",
    source: "test",
    activatedAt: 1_000,
    replayPayloadAvailable: true,
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

suite("Session bundle schema (WI-2.3)", () => {
    test("golden fixture round-trips losslessly and passes the shape guard", () => {
        const roundTripped = JSON.parse(JSON.stringify(GOLDEN_BUNDLE)) as ObservabilityBundleV1;
        expect(roundTripped).to.deep.equal(GOLDEN_BUNDLE);
        expect(isObservabilityBundleShape(roundTripped)).to.equal(true);
    });

    test("golden fixture totals and classification rollup match the pure aggregators", () => {
        expect(computeBundleTotals(GOLDEN_BUNDLE.artifacts)).to.deep.equal(GOLDEN_BUNDLE.totals);
        expect(computeBundleClassificationSummary(GOLDEN_BUNDLE.artifacts)).to.deep.equal(
            GOLDEN_BUNDLE.classificationSummary,
        );
    });

    test("shape guard rejects junk, wrong schema, and missing blocks", () => {
        expect(isObservabilityBundleShape(undefined)).to.equal(false);
        expect(isObservabilityBundleShape("bundle")).to.equal(false);
        expect(isObservabilityBundleShape({})).to.equal(false);
        expect(isObservabilityBundleShape({ ...GOLDEN_BUNDLE, schema: "mssql.other/1" })).to.equal(
            false,
        );
        expect(isObservabilityBundleShape({ ...GOLDEN_BUNDLE, artifacts: "nope" })).to.equal(false);
        expect(isObservabilityBundleShape({ ...GOLDEN_BUNDLE, totals: undefined })).to.equal(false);
    });

    test("safe relative paths stay inside the session directory", () => {
        expect(isSafeBundleRelativePath("manifest.json")).to.equal(true);
        expect(isSafeBundleRelativePath("rich/completions/cs-1/manifest.json")).to.equal(true);
        expect(isSafeBundleRelativePath("replay\\rr-1\\manifest.json")).to.equal(true);
        expect(isSafeBundleRelativePath("../escape/manifest.json")).to.equal(false);
        expect(isSafeBundleRelativePath("rich/../../escape.json")).to.equal(false);
        expect(isSafeBundleRelativePath("/abs/manifest.json")).to.equal(false);
        expect(isSafeBundleRelativePath("C:/abs/manifest.json")).to.equal(false);
        expect(isSafeBundleRelativePath("rich//manifest.json")).to.equal(false);
        expect(isSafeBundleRelativePath("./manifest.json")).to.equal(false);
        expect(isSafeBundleRelativePath("")).to.equal(false);
        expect(isSafeBundleRelativePath(undefined)).to.equal(false);
    });

    test("unknown payload classes rank above known ones (conservative refusal)", () => {
        expect(maxPayloadClass("diagnostic.metadata", "model.prompt")).to.equal("model.prompt");
        expect(maxPayloadClass("model.response", "user.text")).to.equal("model.response");
        expect(maxPayloadClass("model.response", "unknown")).to.equal("unknown");
        expect(maxPayloadClass("unknown", "diagnostic.metadata")).to.equal("unknown");
    });
});

// ---------------------------------------------------------------------------
// Manager: serialized, debounced, atomic writes
// ---------------------------------------------------------------------------

suite("Session bundle manager (WI-2.3)", () => {
    let memFs: MemBundleFs;
    let clock: ManualClock;

    setup(() => {
        memFs = new MemBundleFs();
        clock = new ManualClock();
    });

    test("lazy creation: no bundle.json until the first artifact registers", async () => {
        const manager = makeManager(memFs, clock);
        await manager.ensureBundle(CURRENT_HOST);
        await manager.flushBarrier();
        expect(memFs.files.has(bundlePath(CURRENT_HOST))).to.equal(false);

        // Registration works even when Plane-A capture is off — any child
        // artifact activation creates the catalog (WI-A.3 recommendation).
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        await manager.flushBarrier();
        const bundle = readBundle(memFs, CURRENT_HOST);
        expect(bundle.schema).to.equal(OBSERVABILITY_BUNDLE_SCHEMA);
        expect(bundle.hostSessionId).to.equal(CURRENT_HOST);
        expect(bundle.artifacts).to.have.length(1);
        expect(bundle.artifacts[0].artifactId).to.equal(diagArtifactId(CURRENT_HOST));
    });

    test("registerArtifact upserts: re-registration updates, never duplicates", async () => {
        const manager = makeManager(memFs, clock);
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        await manager.registerArtifact(
            CURRENT_HOST,
            diagArtifactInput(CURRENT_HOST, { events: 99, bytes: 512, status: "closed" }),
        );
        await manager.flushBarrier();
        const bundle = readBundle(memFs, CURRENT_HOST);
        expect(bundle.artifacts).to.have.length(1);
        expect(bundle.artifacts[0].events).to.equal(99);
        expect(bundle.artifacts[0].bytes).to.equal(512);
        expect(bundle.artifacts[0].status).to.equal("closed");
    });

    test("concurrent register/update calls serialize: last write wins per field, one file write", async () => {
        const manager = makeManager(memFs, clock);
        const artifactId = diagArtifactId(CURRENT_HOST);
        await Promise.all([
            manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST)),
            manager.updateArtifact(CURRENT_HOST, artifactId, { events: 1, bytes: 10 }),
            manager.updateArtifact(CURRENT_HOST, artifactId, { events: 2 }),
            manager.updateArtifact(CURRENT_HOST, artifactId, { bytes: 30, gaps: 4 }),
        ]);
        await manager.flushBarrier();
        const bundle = readBundle(memFs, CURRENT_HOST);
        // No lost updates: every field reflects its LAST patch.
        expect(bundle.artifacts[0].events).to.equal(2);
        expect(bundle.artifacts[0].bytes).to.equal(30);
        expect(bundle.artifacts[0].gaps).to.equal(4);
        // Coalesced: the whole burst produced exactly one catalog write.
        expect(bundleWrites(memFs, CURRENT_HOST)).to.equal(1);
        // Totals were recomputed on write.
        expect(bundle.totals).to.deep.include({ artifacts: 1, events: 2, bytes: 30, gaps: 4 });
    });

    test("debounce: at most one write per window, next mutation opens the next window", async function () {
        this.timeout(5000);
        const manager = makeManager(memFs, clock, { debounceMs: 20 });
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        for (let i = 1; i <= 5; i++) {
            await manager.updateArtifact(CURRENT_HOST, diagArtifactId(CURRENT_HOST), {
                events: i,
            });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(bundleWrites(memFs, CURRENT_HOST)).to.equal(1);
        expect(readBundle(memFs, CURRENT_HOST).artifacts[0].events).to.equal(5);

        await manager.updateArtifact(CURRENT_HOST, diagArtifactId(CURRENT_HOST), { events: 6 });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(bundleWrites(memFs, CURRENT_HOST)).to.equal(2);
        expect(readBundle(memFs, CURRENT_HOST).artifacts[0].events).to.equal(6);
    });

    test("atomic rename failure: old bundle intact, health degrades, retry succeeds", async () => {
        const manager = makeManager(memFs, clock);
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        await manager.flushBarrier();
        const before = memFs.files.get(bundlePath(CURRENT_HOST));

        let failures = 0;
        memFs.failRename = () => (failures++ === 0 ? new Error("EACCES: injected") : undefined);
        await manager.updateArtifact(CURRENT_HOST, diagArtifactId(CURRENT_HOST), { events: 7 });
        await manager.flushBarrier();

        // The rename never landed: the previous catalog is byte-identical.
        expect(memFs.files.get(bundlePath(CURRENT_HOST))).to.equal(before);
        const degraded = manager
            .healthSnapshot()
            .find((row) => row.hostSessionId === CURRENT_HOST)!;
        expect(degraded.consecutiveWriteFailures).to.equal(1);
        expect(degraded.dirty).to.equal(true);
        expect(degraded.issues.some((issue) => issue.includes("bundle write failed"))).to.equal(
            true,
        );

        // Retry (still dirty) succeeds and recovers health.
        await manager.flushBarrier();
        expect(readBundle(memFs, CURRENT_HOST).artifacts[0].events).to.equal(7);
        const recovered = manager
            .healthSnapshot()
            .find((row) => row.hostSessionId === CURRENT_HOST)!;
        expect(recovered.consecutiveWriteFailures).to.equal(0);
        expect(recovered.dirty).to.equal(false);
    });

    test("closeArtifact is a flush barrier: terminal state reaches disk immediately", async () => {
        const manager = makeManager(memFs, clock);
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        await manager.closeArtifact(CURRENT_HOST, diagArtifactId(CURRENT_HOST), {
            events: 42,
            bytes: 1234,
        });
        // No explicit flushBarrier: closeArtifact wrote on its own.
        const bundle = readBundle(memFs, CURRENT_HOST);
        expect(bundle.artifacts[0].status).to.equal("closed");
        expect(bundle.artifacts[0].events).to.equal(42);
    });

    test("updateArtifact for an unknown artifact reports, never throws", async () => {
        const manager = makeManager(memFs, clock);
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        const updated = await manager.updateArtifact(CURRENT_HOST, "no-such-artifact", {
            events: 1,
        });
        expect(updated).to.equal(false);
        const health = manager.healthSnapshot().find((row) => row.hostSessionId === CURRENT_HOST)!;
        expect(health.issues.some((issue) => issue.includes("no-such-artifact"))).to.equal(true);
    });

    test("classification rollup lets central preview refuse rich artifacts from the catalog alone", async () => {
        const manager = makeManager(memFs, clock);
        await manager.registerArtifact(CURRENT_HOST, diagArtifactInput(CURRENT_HOST));
        await manager.registerArtifact(CURRENT_HOST, {
            artifactId: "fc-cs-1",
            kind: "featureCapture",
            featureId: "completions",
            schema: "mssql.featureCapture.manifest/1",
            relativeManifest: "rich/completions/cs-1/manifest.json",
            status: "active",
            records: 10,
            events: 4,
            bytes: 2048,
            gaps: 0,
            truncations: 0,
            classification: {
                containsRichPayload: true,
                maximumClass: "model.prompt",
                policyId: "policy-full-local",
                replayPayloadAvailable: true,
            },
        });
        await manager.flushBarrier();
        const bundle = readBundle(memFs, CURRENT_HOST);
        expect(bundle.classificationSummary).to.deep.equal({
            containsRichPayload: true,
            maximumClass: "model.prompt",
            richArtifactCount: 1,
            replayPayloadAvailable: true,
        });
        expect(bundle.totals.bytes).to.equal(2048);
    });

    test("dispose flushes and stamps the current bundle closed", async () => {
        const manager = makeManager(memFs, clock);
        await manager.registerArtifact(
            CURRENT_HOST,
            diagArtifactInput(CURRENT_HOST, { status: "closed" }),
        );
        await manager.dispose();
        const bundle = readBundle(memFs, CURRENT_HOST);
        expect(bundle.status).to.equal("closed");
        expect(bundle.closedUtc).to.be.a("string");
    });
});

// ---------------------------------------------------------------------------
// Rebuild + startup repair
// ---------------------------------------------------------------------------

suite("Session bundle rebuild and startup repair (WI-2.3)", () => {
    let memFs: MemBundleFs;
    let clock: ManualClock;

    setup(() => {
        memFs = new MemBundleFs();
        clock = new ManualClock();
    });

    function seedJson(relativePath: string, value: unknown): void {
        memFs.files.set(`${STORE}/${relativePath}`, JSON.stringify(value, null, 2));
    }

    test("rebuild from a diag child manifest alone (legacy session, on demand)", async () => {
        seedJson("sessions/hs-legacy/manifest.json", diagManifest("hs-legacy"));
        const manager = makeManager(memFs, clock);
        const { bundle, issues } = await manager.rebuildBundle("hs-legacy");
        expect(issues).to.deep.equal([]);
        expect(bundle.artifacts).to.have.length(1);
        const diag = bundle.artifacts[0];
        expect(diag.kind).to.equal("diagStream");
        expect(diag.relativeManifest).to.equal("manifest.json");
        expect(diag.events).to.equal(42);
        expect(diag.bytes).to.equal(1234);
        expect(diag.gaps).to.equal(1);
        expect(diag.status).to.equal("closed");
        expect(diag.classification.containsRichPayload).to.equal(false);
        // The rebuilt catalog was written immediately (explicit repair).
        expect(readBundle(memFs, "hs-legacy").bundleId).to.equal(bundle.bundleId);
    });

    test("rebuild catalogs rich streams written by the journal module", async () => {
        seedJson("sessions/hs-rich/manifest.json", diagManifest("hs-rich"));
        // A REAL journal writer produces the child manifest — the bundle
        // manager consumes exactly what WI-2.2 writes, no hand-rolled shape.
        const writer = new FeatureCaptureJournalWriter({
            directory: `${STORE}/sessions/hs-rich/rich/completions/cs-golden`,
            header: {
                featureId: "completions",
                hostSessionId: "hs-rich",
                captureSessionId: "cs-golden",
                eventSchema: "test.event/1",
                overridesSchema: "test.overrides/1",
                capturePolicy: RICH_POLICY,
            },
            fs: memFs,
            clock,
        });
        writer.tryWrite({
            kind: "event.created",
            eventRevision: 1,
            captureEventId: "ce-1",
            at: 10,
            value: { trigger: "typing" },
        });
        await writer.close();

        const manager = makeManager(memFs, clock);
        const { bundle } = await manager.rebuildBundle("hs-rich");
        expect(bundle.artifacts.map((artifact) => artifact.kind).sort()).to.deep.equal([
            "diagStream",
            "featureCapture",
        ]);
        const rich = bundle.artifacts.find((artifact) => artifact.kind === "featureCapture")!;
        expect(rich.artifactId).to.equal("fc-cs-golden");
        expect(rich.relativeManifest).to.equal("rich/completions/cs-golden/manifest.json");
        expect(rich.records).to.equal(2); // header + created
        expect(rich.events).to.equal(1);
        expect(rich.bytes).to.be.greaterThan(0);
        expect(rich.status).to.equal("closed");
        // Conservative: rebuilt rich artifacts refuse central preview.
        expect(rich.classification.containsRichPayload).to.equal(true);
        expect(rich.classification.policyId).to.equal("policy-full-local");
        // Totals include the rich bytes (retention counts them too).
        expect(bundle.totals.bytes).to.equal(1234 + rich.bytes);
    });

    test("startup repair: stale `active` claims from a dead session become `partial`", async () => {
        seedJson("sessions/hs-dead/bundle.json", {
            ...GOLDEN_BUNDLE,
            hostSessionId: "hs-dead",
            status: "active",
            closedUtc: undefined,
            artifacts: [
                { ...GOLDEN_BUNDLE.artifacts[0], status: "active" },
                { ...GOLDEN_BUNDLE.artifacts[1], status: "closed" },
            ],
        });
        const manager = makeManager(memFs, clock);
        const report = await manager.reconcileOnStartup();
        expect(report.bundlesRepaired).to.equal(1);
        expect(report.artifactsMarkedPartial).to.equal(1);
        const repaired = readBundle(memFs, "hs-dead");
        expect(repaired.status).to.equal("partial");
        expect(repaired.artifacts[0].status).to.equal("partial");
        expect(repaired.artifacts[1].status).to.equal("closed"); // untouched
    });

    test("startup repair: corrupt bundle.json is rebuilt from child manifests, never fatal", async () => {
        memFs.files.set(`${STORE}/sessions/hs-corrupt/bundle.json`, "{ this is not json");
        seedJson(
            "sessions/hs-corrupt/manifest.json",
            diagManifest("hs-corrupt", { status: "active" }),
        );
        const manager = makeManager(memFs, clock);
        const report = await manager.reconcileOnStartup();
        expect(report.bundlesRebuilt).to.equal(1);
        const rebuilt = readBundle(memFs, "hs-corrupt");
        expect(isObservabilityBundleShape(rebuilt)).to.equal(true);
        expect(rebuilt.artifacts).to.have.length(1);
        // The dead session's diag stream claimed active: honest partial.
        expect(rebuilt.artifacts[0].status).to.equal("partial");
        expect(rebuilt.status).to.equal("partial");
    });

    test("startup repair skips the live session and leaves legacy sessions untouched", async () => {
        const liveBundle = {
            ...GOLDEN_BUNDLE,
            hostSessionId: CURRENT_HOST,
            status: "active" as const,
        };
        seedJson(`sessions/${CURRENT_HOST}/bundle.json`, liveBundle);
        const liveBefore = memFs.files.get(bundlePath(CURRENT_HOST));
        seedJson("sessions/hs-old-legacy/manifest.json", diagManifest("hs-old-legacy"));

        const manager = makeManager(memFs, clock);
        const report = await manager.reconcileOnStartup();

        // Current session: not scanned, not modified.
        expect(memFs.files.get(bundlePath(CURRENT_HOST))).to.equal(liveBefore);
        // Legacy session: recognized but no bundle.json synthesized (§10.1).
        expect(report.legacySessions).to.equal(1);
        expect(memFs.files.has(bundlePath("hs-old-legacy"))).to.equal(false);
    });

    test("startup repair removes abandoned .tmp files from dead sessions and touches nothing else (WI-2.8)", async () => {
        // A dead session with atomic-rename residue at every writer site.
        seedJson("sessions/hs-dead/bundle.json", {
            ...GOLDEN_BUNDLE,
            hostSessionId: "hs-dead",
        });
        memFs.files.set(`${STORE}/sessions/hs-dead/bundle.json.7.tmp`, "{torn bundle}");
        memFs.files.set(
            `${STORE}/sessions/hs-dead/rich/completions/cs-x/manifest.json`,
            '{"real":"journal manifest"}',
        );
        memFs.files.set(
            `${STORE}/sessions/hs-dead/rich/completions/cs-x/manifest.json.3.tmp`,
            "{torn journal manifest}",
        );
        memFs.files.set(
            `${STORE}/sessions/hs-dead/rich/completions/cs-x/segment-000001.jsonl`,
            '{"never":"deleted"}\n',
        );
        memFs.files.set(
            `${STORE}/sessions/hs-dead/replay/run-1/manifest.json.9.tmp`,
            "{torn replay manifest}",
        );
        // A legacy dead session whose ONLY residue is a torn first bundle write.
        memFs.files.set(`${STORE}/sessions/hs-legacy-torn/bundle.json.1.tmp`, "{torn}");
        memFs.files.set(`${STORE}/sessions/hs-legacy-torn/manifest.json`, "{}");
        // The CURRENT session may have in-flight temp files: untouched.
        memFs.files.set(`${STORE}/sessions/${CURRENT_HOST}/bundle.json.2.tmp`, "{in flight}");
        seedJson(`sessions/${CURRENT_HOST}/bundle.json`, {
            ...GOLDEN_BUNDLE,
            hostSessionId: CURRENT_HOST,
        });

        const manager = makeManager(memFs, clock);
        const report = await manager.reconcileOnStartup();

        expect(report.tempFilesRemoved).to.equal(4);
        expect(memFs.files.has(`${STORE}/sessions/hs-dead/bundle.json.7.tmp`)).to.equal(false);
        expect(
            memFs.files.has(`${STORE}/sessions/hs-dead/rich/completions/cs-x/manifest.json.3.tmp`),
        ).to.equal(false);
        expect(
            memFs.files.has(`${STORE}/sessions/hs-dead/replay/run-1/manifest.json.9.tmp`),
        ).to.equal(false);
        expect(memFs.files.has(`${STORE}/sessions/hs-legacy-torn/bundle.json.1.tmp`)).to.equal(
            false,
        );
        // Cleanup never touches non-tmp files (real evidence is sacred)...
        expect(
            memFs.files.get(`${STORE}/sessions/hs-dead/rich/completions/cs-x/manifest.json`),
        ).to.equal('{"real":"journal manifest"}');
        expect(
            memFs.files.get(`${STORE}/sessions/hs-dead/rich/completions/cs-x/segment-000001.jsonl`),
        ).to.equal('{"never":"deleted"}\n');
        expect(memFs.files.has(bundlePath("hs-dead"))).to.equal(true);
        expect(memFs.files.get(`${STORE}/sessions/hs-legacy-torn/manifest.json`)).to.equal("{}");
        // ...and never reaches into the live session.
        expect(memFs.files.get(`${STORE}/sessions/${CURRENT_HOST}/bundle.json.2.tmp`)).to.equal(
            "{in flight}",
        );
        // Every delete targeted a .tmp name — proven from the fs op log.
        for (const removed of memFs.removed) {
            expect(removed.endsWith(".tmp"), `unexpected delete target ${removed}`).to.equal(true);
        }
    });

    test("noteReconciliation surfaces on the bundle health row (WI-2.8)", async () => {
        const manager = makeManager(memFs, clock);
        await manager.ensureBundle(CURRENT_HOST);
        expect(manager.healthSnapshot()[0].lastReconciliation).to.equal(undefined);
        manager.noteReconciliation(CURRENT_HOST, {
            atUtc: "2026-07-16T02:00:00.000Z",
            matches: false,
            mismatchCount: 2,
        });
        const row = manager.healthSnapshot().find((entry) => entry.hostSessionId === CURRENT_HOST)!;
        expect(row.lastReconciliation).to.deep.equal({
            atUtc: "2026-07-16T02:00:00.000Z",
            matches: false,
            mismatchCount: 2,
        });
        // Health-only: the reconciliation outcome is never persisted into
        // bundle.json (the full report lives beside the journal stream).
        await manager.flushBarrier(CURRENT_HOST);
        const persisted = memFs.files.get(bundlePath(CURRENT_HOST));
        expect(persisted === undefined || !persisted.includes("lastReconciliation")).to.equal(true);
    });
});

// ---------------------------------------------------------------------------
// Clear sensitive captures (§9.4)
// ---------------------------------------------------------------------------

suite("Session bundle clear sensitive captures (WI-2.3)", () => {
    let memFs: MemBundleFs;
    let clock: ManualClock;

    setup(() => {
        memFs = new MemBundleFs();
        clock = new ManualClock();
    });

    test("removes rich/replay files and descriptors, preserves diag, refuses traversal", async () => {
        const dir = `${STORE}/sessions/hs-a`;
        memFs.files.set(`${dir}/manifest.json`, JSON.stringify(diagManifest("hs-a")));
        memFs.files.set(`${dir}/events/segment-000001.jsonl`, "{}\n");
        memFs.files.set(`${dir}/rich/completions/cs-1/manifest.json`, "{}");
        memFs.files.set(`${dir}/rich/completions/cs-1/segment-000001.jsonl`, "sensitive\n");
        memFs.files.set(`${dir}/replay/rr-1/manifest.json`, "{}");
        memFs.files.set(`${dir}/replay/rr-1/items.jsonl`, "sensitive\n");
        // A file OUTSIDE the session dir that a hostile descriptor points at.
        memFs.files.set(`${STORE}/evil/manifest.json`, "must survive");
        memFs.files.set(
            `${dir}/bundle.json`,
            JSON.stringify({
                ...GOLDEN_BUNDLE,
                hostSessionId: "hs-a",
                artifacts: [
                    { ...GOLDEN_BUNDLE.artifacts[0], artifactId: "diag-hs-a" },
                    {
                        ...GOLDEN_BUNDLE.artifacts[1],
                        artifactId: "fc-cs-1",
                        relativeManifest: "rich/completions/cs-1/manifest.json",
                    },
                    {
                        ...GOLDEN_BUNDLE.artifacts[1],
                        artifactId: "rr-1",
                        kind: "replayRun",
                        relativeManifest: "replay/rr-1/manifest.json",
                    },
                    {
                        ...GOLDEN_BUNDLE.artifacts[1],
                        artifactId: "fc-evil",
                        relativeManifest: "../../evil/manifest.json",
                    },
                ],
            }),
        );

        const manager = makeManager(memFs, clock);
        const result = await manager.deleteSensitiveArtifacts();

        expect(result.removedDirectories).to.equal(2);
        expect(result.removedArtifacts).to.equal(2);
        expect(result.preservedDiagArtifacts).to.equal(1);
        expect(result.issues.some((issue) => issue.includes("fc-evil"))).to.equal(true);

        // rich/ and replay/ are gone; diag evidence and the outside file stay.
        const remaining = [...memFs.files.keys()];
        expect(remaining.some((key) => key.includes("/rich/"))).to.equal(false);
        expect(remaining.some((key) => key.includes("/replay/"))).to.equal(false);
        expect(memFs.files.has(`${dir}/manifest.json`)).to.equal(true);
        expect(memFs.files.has(`${dir}/events/segment-000001.jsonl`)).to.equal(true);
        expect(memFs.files.get(`${STORE}/evil/manifest.json`)).to.equal("must survive");
        // Deletion only ever targeted the fixed session children.
        expect(memFs.removed.sort()).to.deep.equal([`${dir}/replay`, `${dir}/rich`]);

        // The catalog now lists the diag stream plus the refused descriptor,
        // marked invalid (its files were NOT deleted — honesty over tidiness).
        const bundle = readBundle(memFs, "hs-a");
        expect(bundle.artifacts.map((artifact) => artifact.artifactId).sort()).to.deep.equal([
            "diag-hs-a",
            "fc-evil",
        ]);
        expect(
            bundle.artifacts.find((artifact) => artifact.artifactId === "fc-evil")!.status,
        ).to.equal("invalid");
    });

    test("legacy sessions (no bundle.json) still get rich/replay removal, nothing synthesized", async () => {
        const dir = `${STORE}/sessions/hs-legacy`;
        memFs.files.set(`${dir}/manifest.json`, JSON.stringify(diagManifest("hs-legacy")));
        memFs.files.set(`${dir}/rich/completions/cs-9/segment-000001.jsonl`, "sensitive\n");

        const manager = makeManager(memFs, clock);
        const result = await manager.deleteSensitiveArtifacts();
        expect(result.removedDirectories).to.equal(1);
        expect(memFs.files.has(`${dir}/rich/completions/cs-9/segment-000001.jsonl`)).to.equal(
            false,
        );
        expect(memFs.files.has(`${dir}/manifest.json`)).to.equal(true);
        expect(memFs.files.has(`${dir}/bundle.json`)).to.equal(false);
    });
});

// ---------------------------------------------------------------------------
// Retention accounting + store validation (real filesystem)
// ---------------------------------------------------------------------------

suite("Session bundle retention accounting (WI-2.3)", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-bundle-retention-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function seedSession(
        sessionId: string,
        manifest: SessionManifest,
        bundle?: Partial<ObservabilityBundleV1> & { totals: ObservabilityBundleV1["totals"] },
    ): string {
        const dir = path.join(root, "sessions", sessionId);
        fs.mkdirSync(path.join(dir, "events"), { recursive: true });
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(dir, "events", "segment-000001.jsonl"), "");
        if (bundle) {
            fs.writeFileSync(
                path.join(dir, "bundle.json"),
                JSON.stringify(
                    {
                        ...GOLDEN_BUNDLE,
                        hostSessionId: sessionId,
                        artifacts: [],
                        ...bundle,
                    },
                    null,
                    2,
                ),
            );
        }
        return dir;
    }

    test("size budget counts rich bytes via bundle totals; eviction removes the whole dir", () => {
        // Session A: diag manifest claims only 10 bytes, but its bundle totals
        // include 10,000 bytes of rich captures (which really exist on disk).
        const dirA = seedSession(
            "sess_a",
            diagManifest("sess_a", {
                sessionId: "sess_a",
                createdUtc: "2026-01-01T00:00:00.000Z",
                sizeBytes: 10,
            }),
            { totals: { artifacts: 2, bytes: 10_000, gaps: 0, truncations: 0 } },
        );
        fs.mkdirSync(path.join(dirA, "rich", "completions", "cs-1"), { recursive: true });
        fs.writeFileSync(
            path.join(dirA, "rich", "completions", "cs-1", "segment-000001.jsonl"),
            "x".repeat(9_990),
        );
        const dirB = seedSession(
            "sess_b",
            diagManifest("sess_b", {
                sessionId: "sess_b",
                createdUtc: "2026-07-01T00:00:00.000Z",
                sizeBytes: 10,
            }),
            { totals: { artifacts: 1, bytes: 100, gaps: 0, truncations: 0 } },
        );

        const store = new SessionStore(root);
        // Without bundle totals both sessions would look like 10 bytes and
        // nothing would be evicted; WITH them, sess_a busts the 5,000-byte
        // budget and the OLDEST session goes — whole directory, rich included.
        store.enforceRetention(10, 10_000, 5_000);
        expect(fs.existsSync(dirA)).to.equal(false);
        expect(fs.existsSync(dirB)).to.equal(true);
    });

    test("validateStore reports bundle issues without ever being fatal", () => {
        // Clean session: consistent bundle → no issues from it.
        seedSession(
            "sess_clean",
            diagManifest("sess_clean", {
                sessionId: "sess_clean",
                eventCount: 0,
                gapCount: 0,
                sizeBytes: 0,
                segments: [{ file: "segment-000001.jsonl", firstSeq: 0, lastSeq: 0, events: 0 }],
            }),
            {
                totals: { artifacts: 1, bytes: 0, gaps: 0, truncations: 0 },
                artifacts: [
                    {
                        ...GOLDEN_BUNDLE.artifacts[0],
                        artifactId: "diag-sess_clean",
                        events: 0,
                        bytes: 0,
                        gaps: 0,
                    },
                ],
            },
        );
        // Missing child manifest + unsafe path + corrupt bundle.
        seedSession(
            "sess_missing",
            diagManifest("sess_missing", {
                sessionId: "sess_missing",
                eventCount: 0,
                gapCount: 0,
                sizeBytes: 0,
                segments: [{ file: "segment-000001.jsonl", firstSeq: 0, lastSeq: 0, events: 0 }],
            }),
            {
                totals: { artifacts: 2, bytes: 0, gaps: 0, truncations: 0 },
                artifacts: [
                    {
                        ...GOLDEN_BUNDLE.artifacts[1],
                        artifactId: "fc-gone",
                        relativeManifest: "rich/completions/cs-gone/manifest.json",
                    },
                    {
                        ...GOLDEN_BUNDLE.artifacts[1],
                        artifactId: "fc-unsafe",
                        relativeManifest: "../outside/manifest.json",
                    },
                ],
            },
        );
        const dirCorrupt = seedSession(
            "sess_corrupt",
            diagManifest("sess_corrupt", {
                sessionId: "sess_corrupt",
                eventCount: 0,
                gapCount: 0,
                sizeBytes: 0,
                segments: [{ file: "segment-000001.jsonl", firstSeq: 0, lastSeq: 0, events: 0 }],
            }),
        );
        fs.writeFileSync(path.join(dirCorrupt, "bundle.json"), "{ nope");

        const store = new SessionStore(root);
        const { issues } = store.validateStore();
        expect(
            issues.some((issue) => issue.includes("fc-gone") && issue.includes("missing")),
        ).to.equal(true);
        expect(
            issues.some((issue) => issue.includes("fc-unsafe") && issue.includes("unsafe")),
        ).to.equal(true);
        expect(
            issues.some((issue) => issue.includes("sess_corrupt") && issue.includes("bundle.json")),
        ).to.equal(true);
        expect(issues.some((issue) => issue.includes("sess_clean"))).to.equal(false);
    });
});

// ---------------------------------------------------------------------------
// SessionDiagSink notification seam
// ---------------------------------------------------------------------------

suite("Session diag sink bundle notification (WI-2.3)", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-bundle-sink-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function makeEvent(seq: number): DiagEvent {
        return {
            schemaVersion: DIAG_SCHEMA_VERSION,
            eventId: `evt_${seq}`,
            sessionId: "sess_bundle",
            seq,
            epochMs: Date.now(),
            process: "extensionHost",
            feature: "connection",
            kind: "event",
            type: "mssql.test.event",
            status: "ok",
            cls: { max: "diagnostic.metadata", redactedFields: 0, policyId: "policy-redacted" },
            payload: {},
        };
    }

    test("every manifest rewrite notifies the fake manager along the flush path", () => {
        const notifications: Array<{ eventCount: number; status: string; sizeBytes?: number }> = [];
        const sink = new SessionDiagSink(
            root,
            "sess_bundle",
            "redacted",
            "policy-redacted",
            {},
            (manifest) =>
                notifications.push({
                    eventCount: manifest.eventCount,
                    status: manifest.status,
                    ...(manifest.sizeBytes !== undefined ? { sizeBytes: manifest.sizeBytes } : {}),
                }),
        );
        // Registration rides the constructor's manifest write.
        expect(notifications).to.have.length(1);
        expect(notifications[0]).to.deep.include({ eventCount: 0, status: "active" });

        // Emission alone notifies nothing — only the flush path does.
        sink.tryWrite(makeEvent(1));
        expect(notifications).to.have.length(1);

        sink.flush();
        expect(notifications).to.have.length(2);
        expect(notifications[1].eventCount).to.equal(1);
        expect(notifications[1].sizeBytes).to.be.greaterThan(0);

        sink.close();
        expect(notifications[notifications.length - 1].status).to.equal("closed");
    });

    test("a throwing notifier never degrades capture", () => {
        const sink = new SessionDiagSink(
            root,
            "sess_bundle",
            "redacted",
            "policy-redacted",
            {},
            () => {
                throw new Error("catalog exploded");
            },
        );
        sink.tryWrite(makeEvent(1));
        sink.flush();
        expect(sink.health().healthy).to.equal(true);
        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, "sessions", "sess_bundle", "manifest.json"), "utf8"),
        ) as SessionManifest;
        expect(manifest.eventCount).to.equal(1);
    });

    test("the manifest maps to a diagStream descriptor and lands in the bundle catalog", async () => {
        const memFs = new MemBundleFs();
        const manager = new ObservabilityBundleManager({
            storeRoot: STORE,
            currentHostSessionId: "sess_bundle",
            fs: memFs,
            clock: new ManualClock(),
            debounceMs: 60_000,
        });
        // The exact wiring DiagnosticsManager uses.
        const sink = new SessionDiagSink(
            root,
            "sess_bundle",
            "redacted",
            "policy-redacted",
            {},
            (manifest) =>
                void manager.registerArtifact(
                    manifest.sessionId,
                    diagManifestToArtifactInput(manifest),
                ),
        );
        sink.tryWrite(makeEvent(1));
        sink.tryWrite(makeEvent(2));
        sink.flush();
        sink.close();
        await manager.flushBarrier();

        const bundle = readBundle(memFs, "sess_bundle");
        expect(bundle.artifacts).to.have.length(1);
        const diag = bundle.artifacts[0];
        expect(diag.artifactId).to.equal("diag-sess_bundle");
        expect(diag.kind).to.equal("diagStream");
        expect(diag.relativeManifest).to.equal("manifest.json");
        expect(diag.events).to.equal(2);
        expect(diag.bytes).to.be.greaterThan(0);
        expect(diag.status).to.equal("closed");
        expect(diag.classification).to.deep.equal({
            containsRichPayload: false,
            maximumClass: "diagnostic.metadata",
            policyId: "policy-redacted",
        });
        // Registration + updates coalesced into one catalog write.
        expect(bundleWrites(memFs, "sess_bundle")).to.equal(1);
    });
});
