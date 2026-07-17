/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay Lab run catalog + RPC projections (final plan WI-3.5): manifest-only
 * enumeration (newest-first, current host session first), paged list, detail
 * with an items page and tolerant parsing, live+durable merge without double
 * listing, and the privacy guarantee — no prompt bodies in any list/detail
 * projection (config groups sanitize through an allowlist).
 */

import { expect } from "chai";
import {
    listReplayRunManifests,
    readReplayRunDetail,
} from "../../src/diagnostics/featureCapture/replayRunCatalog";
import {
    REPLAY_RUN_MANIFEST_SCHEMA,
    ReplayRunItemRecordV1,
    ReplayRunManifestV1,
} from "../../src/diagnostics/featureCapture/replayRunRepository";
import {
    buildReplayRunListResult,
    projectDurableReplayItemRow,
    projectDurableReplayRunRow,
    projectLiveReplayItemRow,
    sanitizeReplayLabConfigGroup,
} from "../../src/diagnostics/replayLabRpcHost";
import { ConfigGroupV1 } from "../../src/sharedInterfaces/configGroup";
import {
    InlineCompletionDebugReplayQueueRow,
    InlineCompletionDebugReplayRun,
} from "../../src/sharedInterfaces/inlineCompletionDebug";
import {
    mergeReplayLabRunRows,
    projectLiveReplayRunRow,
} from "../../src/sharedInterfaces/replayLabRpc";
import { MemJournalFs } from "./support/memJournalFs";

const STORE = "C:/lab-store";
const CURRENT_HOST = "hs-current";
const OTHER_HOST = "hs-older";
const SECRET = "SECRET-PROMPT-BODY-NEVER-ON-THE-WIRE";

function manifest(overrides: Partial<ReplayRunManifestV1>): ReplayRunManifestV1 {
    return {
        schema: REPLAY_RUN_MANIFEST_SCHEMA,
        replayRunId: "rr-x",
        featureId: "completions",
        semantics: "interactiveExperiment",
        createdAt: 1_000,
        status: "completed",
        sourceBasketDigest: "digest",
        sources: [
            {
                captureSessionId: "cs-1",
                captureEventId: "ce-src-1",
                snapshotDigest: "snap-digest",
                label: "Live · 10:00:00",
            },
        ],
        configGroups: [
            {
                configGroupId: "cg-1",
                version: 1,
                label: "Profile: balanced",
                effectiveConfigDigest: "cfg-digest",
            },
        ],
        cells: [],
        repetitions: 1,
        expectedItems: 1,
        completedItems: 1,
        failedItems: 0,
        cancelledItems: 0,
        safety: {
            sideEffectClass: "none",
            targetBinding: "none",
            requiresConfirmation: false,
            requiresSandbox: false,
            reasons: ["model call only"],
        },
        provenance: {},
        ...overrides,
    };
}

function itemRecord(overrides: Partial<ReplayRunItemRecordV1>): ReplayRunItemRecordV1 {
    return {
        replayRunId: "rr-x",
        replayItemId: "ri-1",
        sourceCaptureEventId: "ce-src-1",
        repetition: 1,
        queuedAt: 1_000,
        startedAt: 1_100,
        endedAt: 1_600,
        resolvedConfigDigest: "cfg-digest",
        status: "completed",
        resultCaptureEventId: "ce-result-1",
        resultEventId: "E-9",
        replayMode: "rebuildCurrentSchema",
        schemaContextSource: "current",
        attempt: 1,
        ...overrides,
    };
}

function seedRun(
    fs: MemJournalFs,
    hostSessionId: string,
    runManifest: ReplayRunManifestV1,
    items: ReplayRunItemRecordV1[] = [],
    configGroups?: ConfigGroupV1[],
): void {
    const dir = `${STORE}/sessions/${hostSessionId}/replay/${runManifest.replayRunId}`;
    fs.files.set(`${dir}/manifest.json`, JSON.stringify(runManifest, null, 2));
    if (items.length > 0) {
        fs.files.set(
            `${dir}/items.jsonl`,
            items.map((record) => JSON.stringify(record)).join("\n") + "\n",
        );
    }
    if (configGroups) {
        fs.files.set(`${dir}/configGroups.json`, JSON.stringify(configGroups, null, 2));
    }
}

function liveRun(
    overrides: Partial<InlineCompletionDebugReplayRun>,
): InlineCompletionDebugReplayRun {
    return {
        id: "rr-live",
        traceId: "trace-1",
        kind: "single",
        startedAt: 5_000,
        status: "running",
        totalEvents: 4,
        completedEvents: 1,
        ...overrides,
    };
}

suite("Replay Lab run catalog + projections (WI-3.5)", () => {
    test("manifest-only enumeration: items/configGroups files are never opened by the list", async () => {
        const fs = new MemJournalFs();
        seedRun(fs, CURRENT_HOST, manifest({ replayRunId: "rr-a", createdAt: 3_000 }), [
            itemRecord({}),
        ]);
        seedRun(fs, OTHER_HOST, manifest({ replayRunId: "rr-b", createdAt: 9_000 }));
        seedRun(fs, OTHER_HOST, manifest({ replayRunId: "rr-c", createdAt: 1_000 }));

        const result = await listReplayRunManifests({
            storeRoot: STORE,
            currentHostSessionId: CURRENT_HOST,
            fs,
        });
        // Current host session first, then newest-first.
        expect(result.entries.map((entry) => entry.manifest.replayRunId)).to.deep.equal([
            "rr-a",
            "rr-b",
            "rr-c",
        ]);
        expect(result.issues).to.deep.equal([]);
        // Manifest-only: no read op ever touched items.jsonl/configGroups.json.
        const readPaths = fs.ops.filter((op) => op.op === "read").map((op) => op.path);
        expect(readPaths.every((path) => path.endsWith("manifest.json"))).to.equal(true);
    });

    test("unreadable manifests are counted as issues, never thrown", async () => {
        const fs = new MemJournalFs();
        seedRun(fs, CURRENT_HOST, manifest({ replayRunId: "rr-good" }));
        fs.files.set(`${STORE}/sessions/${CURRENT_HOST}/replay/rr-torn/manifest.json`, "{not json");
        fs.files.set(
            `${STORE}/sessions/${CURRENT_HOST}/replay/rr-alien/manifest.json`,
            JSON.stringify({ schema: "mssql.other/9" }),
        );

        const result = await listReplayRunManifests({
            storeRoot: STORE,
            currentHostSessionId: CURRENT_HOST,
            fs,
        });
        expect(result.entries.length).to.equal(1);
        expect(result.issues.length).to.equal(2);
    });

    test("paged list walks by cursor without dropping or repeating rows", async () => {
        const fs = new MemJournalFs();
        for (let index = 0; index < 5; index++) {
            seedRun(
                fs,
                CURRENT_HOST,
                manifest({ replayRunId: `rr-${index}`, createdAt: 1_000 + index }),
            );
        }
        const catalog = await listReplayRunManifests({
            storeRoot: STORE,
            currentHostSessionId: CURRENT_HOST,
            fs,
        });

        const seen: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
            const result = buildReplayRunListResult({
                entries: catalog.entries,
                issues: catalog.issues,
                params: { limit: 2, ...(cursor !== undefined ? { cursor } : {}) },
                currentHostSessionId: CURRENT_HOST,
                storeAvailable: true,
            });
            seen.push(...result.rows.map((row) => row.replayRunId));
            expect(result.totalCount).to.equal(5);
            cursor = result.nextCursor;
            if (cursor === undefined) {
                break;
            }
        }
        expect(seen).to.deep.equal(["rr-4", "rr-3", "rr-2", "rr-1", "rr-0"]);
    });

    test("detail reads a paged items slice and tolerates torn lines", async () => {
        const fs = new MemJournalFs();
        const records = [0, 1, 2].map((index) =>
            itemRecord({ replayItemId: `ri-${index}`, endedAt: 2_000 + index }),
        );
        seedRun(fs, CURRENT_HOST, manifest({ replayRunId: "rr-a" }), records);
        // Torn tail line (crash mid-append) is skipped honestly.
        const itemsPath = `${STORE}/sessions/${CURRENT_HOST}/replay/rr-a/items.jsonl`;
        fs.files.set(itemsPath, fs.files.get(itemsPath)! + '{"replayItemId": "ri-torn"');

        const detail = await readReplayRunDetail({
            storeRoot: STORE,
            hostSessionId: CURRENT_HOST,
            replayRunId: "rr-a",
            itemsOffset: 1,
            itemsLimit: 1,
            fs,
        });
        expect(detail.manifest?.replayRunId).to.equal("rr-a");
        expect(detail.itemsTotal).to.equal(3);
        expect(detail.items.map((record) => record.replayItemId)).to.deep.equal(["ri-1"]);
    });

    test("item projection resolves labels from the manifest and computes duration", () => {
        const source = manifest({
            replayRunId: "rr-a",
            cells: [
                {
                    matrixCellId: "cell-1",
                    configGroupId: "cg-1",
                    label: "Focused x Tight",
                    ordinal: 1,
                },
            ],
        });
        const row = projectDurableReplayItemRow(
            itemRecord({ matrixCellId: "cell-1", status: "blocked", errorMessage: "no schema" }),
            source,
        );
        expect(row.sourceLabel).to.equal("Live · 10:00:00");
        expect(row.cellLabel).to.equal("Focused x Tight");
        expect(row.status).to.equal("blocked");
        expect(row.durationMs).to.equal(500);
        expect(row.replayMode).to.equal("rebuildCurrentSchema");
        expect(row.schemaContextSource).to.equal("current");
    });

    test("live + durable merge never double-lists an active run; live state wins", () => {
        const durable = [
            projectDurableReplayRunRow(
                {
                    hostSessionId: CURRENT_HOST,
                    manifest: manifest({
                        replayRunId: "rr-active",
                        status: "running",
                        completedItems: 2,
                        failedItems: 1,
                        expectedItems: 4,
                    }),
                },
                CURRENT_HOST,
            ),
            projectDurableReplayRunRow(
                { hostSessionId: OTHER_HOST, manifest: manifest({ replayRunId: "rr-old" }) },
                CURRENT_HOST,
            ),
        ];
        const live = [
            projectLiveReplayRunRow(
                liveRun({
                    id: "rr-active",
                    status: "cancelling",
                    completedEvents: 3,
                    durable: true,
                }),
            ),
        ];
        const merged = mergeReplayLabRunRows(live, durable);
        expect(merged.map((row) => row.replayRunId)).to.deep.equal(["rr-active", "rr-old"]);
        const active = merged[0];
        // Live truth for state; durable truth for the per-status item split.
        expect(active.status).to.equal("cancelling");
        expect(active.live).to.equal(true);
        expect(active.durable).to.equal(true);
        expect(active.failedItems).to.equal(1);
        expect(merged[1].currentHostSession).to.equal(false);
    });

    test("PRIVACY: list rows, item rows, and sanitized config groups carry no prompt bodies", async () => {
        const fs = new MemJournalFs();
        const groups: ConfigGroupV1[] = [
            {
                schema: "mssql.configGroup/1",
                configGroupId: "cg-1",
                featureId: "completions",
                version: 1,
                label: "Custom overrides",
                partialOverrides: {
                    profileId: "balanced",
                    customSystemPrompt: SECRET,
                    replayMode: "rebuildCurrentSchema",
                    somethingUnknown: SECRET,
                },
                effectiveConfig: {
                    profileId: "balanced",
                    customSystemPrompt: SECRET,
                    replayMode: "rebuildCurrentSchema",
                },
                effectiveConfigDigest: "cfg-digest",
                settingMutability: { profileId: "hot" },
            },
        ];
        seedRun(fs, CURRENT_HOST, manifest({ replayRunId: "rr-a" }), [itemRecord({})], groups);

        const catalog = await listReplayRunManifests({
            storeRoot: STORE,
            currentHostSessionId: CURRENT_HOST,
            fs,
        });
        const list = buildReplayRunListResult({
            entries: catalog.entries,
            issues: catalog.issues,
            params: undefined,
            currentHostSessionId: CURRENT_HOST,
            storeAvailable: true,
        });
        const detail = await readReplayRunDetail({
            storeRoot: STORE,
            hostSessionId: CURRENT_HOST,
            replayRunId: "rr-a",
            fs,
        });
        const wireDetail = {
            items: detail.items.map((record) =>
                projectDurableReplayItemRow(record, detail.manifest),
            ),
            configGroups: (detail.configGroups ?? []).map(sanitizeReplayLabConfigGroup),
        };

        const serialized = JSON.stringify({ list, wireDetail });
        expect(serialized).to.not.contain(SECRET);
        // The exact KEY must be gone (the boolean `customSystemPromptUsed`
        // flag is the allowed replacement).
        expect(serialized).to.not.contain('"customSystemPrompt"');
        // The sanitized group still says a custom prompt was in play.
        expect(wireDetail.configGroups[0].customSystemPromptUsed).to.equal(true);
        expect(wireDetail.configGroups[0].overridesSummary).to.deep.equal({
            profileId: "balanced",
            replayMode: "rebuildCurrentSchema",
        });
    });

    test("live queue rows project to metadata-only item rows", () => {
        const queueRow = {
            id: "ri-live",
            runId: "rr-live",
            traceId: "trace-1",
            snapshotId: "snapshot-1",
            sourceEventId: "E-1",
            position: 1,
            total: 2,
            status: "running",
            queuedAt: 5_000,
            startedAt: 5_100,
            config: { replayMode: "frozenPrompt" },
            configDigest: "row-digest",
            repetition: 1,
            event: {
                id: "R-1",
                timestamp: 5_000,
                promptMessages: [{ role: "user", content: SECRET }],
                rawResponse: SECRET,
                locals: { linePrefix: SECRET },
                link: {
                    schema: "mssql.observabilityLink/1",
                    featureId: "completions",
                    hostSessionId: CURRENT_HOST,
                    captureSessionId: "cs-1",
                    captureEventId: "ce-src-1",
                },
            },
        } as unknown as InlineCompletionDebugReplayQueueRow;
        const row = projectLiveReplayItemRow(queueRow);
        expect(row.sourceCaptureEventId).to.equal("ce-src-1");
        expect(row.status).to.equal("running");
        expect(row.replayMode).to.equal("frozenPrompt");
        expect(JSON.stringify(row)).to.not.contain(SECRET);
    });
});
