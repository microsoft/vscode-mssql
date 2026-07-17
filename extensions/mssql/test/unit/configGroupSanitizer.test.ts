/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared config-group sanitizer (§7.6 "sensitive values never enter a shared
 * config group"): the ONE allowlist behind the Replay Lab wire AND the
 * durable run repository. Includes the DISK CANARY: a sentinel custom system
 * prompt in an overridden config must never appear in ANY file under
 * `replay/<runId>/`.
 */

import { expect } from "chai";
import {
    sanitizeConfigGroupForPersistence,
    sanitizeReplayLabConfigGroup,
} from "../../src/diagnostics/featureCapture/configGroupSanitizer";
import { ReplayRunRepository } from "../../src/diagnostics/featureCapture/replayRunRepository";
import { ConfigGroupV1 } from "../../src/sharedInterfaces/configGroup";
import { MemJournalFs } from "./support/memJournalFs";

const SENTINEL = "CANARY-PROMPT-a7f3e9-do-not-persist";

function groupWithSentinel(): ConfigGroupV1 {
    return {
        schema: "mssql.configGroup/1",
        configGroupId: "cg-sentinel",
        featureId: "completions",
        version: 1,
        label: "Custom prompt group",
        baseProfileId: "balanced",
        baseProfileVersion: 3,
        partialOverrides: {
            profileId: "balanced",
            customSystemPrompt: SENTINEL,
            replayMode: "rebuildCapturedContext",
            futureUnknownKey: SENTINEL,
        },
        effectiveConfig: {
            profileId: "balanced",
            customSystemPrompt: SENTINEL,
            replayMode: "rebuildCapturedContext",
            maxTokens: 256,
            futureUnknownKey: SENTINEL,
        },
        effectiveConfigDigest: "d".repeat(64),
        settingMutability: {
            profileId: "hot",
            customSystemPrompt: "hot",
            replayMode: "hot",
            maxTokens: "hot",
            futureUnknownKey: "hot",
        },
    };
}

suite("Config-group sanitizer (shared allowlist)", () => {
    test("persistence sanitizer: prompt collapses to flag, unknown keys drop", () => {
        const sanitized = sanitizeConfigGroupForPersistence(groupWithSentinel());
        const serialized = JSON.stringify(sanitized);
        expect(serialized).to.not.contain(SENTINEL);
        expect(serialized).to.not.contain('"customSystemPrompt"');
        expect(serialized).to.not.contain("futureUnknownKey");
        expect(sanitized.partialOverrides).to.deep.equal({
            profileId: "balanced",
            replayMode: "rebuildCapturedContext",
            customSystemPromptUsed: true,
        });
        expect(sanitized.effectiveConfig).to.deep.equal({
            profileId: "balanced",
            replayMode: "rebuildCapturedContext",
            maxTokens: 256,
            customSystemPromptUsed: true,
        });
        // The digest still identifies the ORIGINAL effective config.
        expect(sanitized.effectiveConfigDigest).to.equal("d".repeat(64));
        expect(sanitized.settingMutability).to.deep.equal({
            profileId: "hot",
            replayMode: "hot",
            maxTokens: "hot",
        });
        // Identity/labels survive.
        expect(sanitized.configGroupId).to.equal("cg-sentinel");
        expect(sanitized.baseProfileId).to.equal("balanced");
    });

    test("persistence sanitizer is idempotent", () => {
        const once = sanitizeConfigGroupForPersistence(groupWithSentinel());
        const twice = sanitizeConfigGroupForPersistence(once);
        expect(twice).to.deep.equal(once);
        expect(twice.partialOverrides.customSystemPromptUsed).to.equal(true);
    });

    test("Query Studio config keys pass the allowlist", () => {
        const sanitized = sanitizeConfigGroupForPersistence({
            schema: "mssql.configGroup/1",
            configGroupId: "cg-qs",
            featureId: "queryStudio",
            version: 1,
            label: "estimatedPlan",
            partialOverrides: { mode: "estimatedPlan", database: "AdventureWorks" },
            effectiveConfig: {
                database: "AdventureWorks",
                mode: "estimatedPlan",
                stopOnError: null,
                tuning: { pageRows: 100 },
            },
            effectiveConfigDigest: "e".repeat(64),
            settingMutability: { database: "hot", mode: "hot", stopOnError: "hot", tuning: "hot" },
        });
        expect(sanitized.effectiveConfig).to.deep.equal({
            database: "AdventureWorks",
            mode: "estimatedPlan",
            stopOnError: null,
            tuning: { pageRows: 100 },
        });
        expect(sanitized.settingMutability.tuning).to.equal("hot");
    });

    test("wire sanitizer handles both raw and already-sanitized (flag) shapes", () => {
        const rawWire = sanitizeReplayLabConfigGroup(groupWithSentinel());
        expect(rawWire.customSystemPromptUsed).to.equal(true);
        expect(JSON.stringify(rawWire)).to.not.contain(SENTINEL);

        const sanitizedOnDisk = sanitizeConfigGroupForPersistence(groupWithSentinel());
        const wire = sanitizeReplayLabConfigGroup(sanitizedOnDisk);
        expect(wire.customSystemPromptUsed).to.equal(true);
        expect(wire.overridesSummary).to.deep.equal({
            profileId: "balanced",
            replayMode: "rebuildCapturedContext",
        });
        expect(JSON.stringify(wire)).to.not.contain(SENTINEL);
    });

    test("DISK CANARY: sentinel prompt never appears in any file under replay/<runId>/", async () => {
        const memFs = new MemJournalFs();
        const repository = new ReplayRunRepository({
            storeRoot: "C:/store",
            hostSessionId: "hs-canary",
            featureId: "completions",
            fs: memFs,
            debounceMs: 60_000,
        });
        const durable = await repository.beginRun({
            replayRunId: "rr-canary-1",
            createdAt: 1_000,
            sources: [
                {
                    captureSessionId: "cs-1",
                    captureEventId: "ce-1",
                    label: "Live · 10:00:00",
                    // The snapshot is digested, never persisted — but keep the
                    // sentinel here too so a regression would trip the scan.
                    snapshotJson: { id: "E-1", prompt: SENTINEL },
                },
            ],
            configGroups: [groupWithSentinel()],
            cells: [],
            repetitions: 1,
            expectedItems: 1,
        });
        expect(durable).to.equal(true);
        repository.noteRunStatus({ replayRunId: "rr-canary-1", status: "running" });
        repository.recordItem("rr-canary-1", {
            replayItemId: "ri-1",
            sourceCaptureEventId: "ce-1",
            repetition: 1,
            queuedAt: 1_010,
            startedAt: 1_020,
            endedAt: 1_030,
            resolvedConfigDigest: "f".repeat(64),
            status: "completed",
            attempt: 1,
        });
        repository.noteRunStatus({ replayRunId: "rr-canary-1", status: "completed" });
        await repository.flushBarrier();
        await repository.dispose();

        const runFiles = [...memFs.files.entries()].filter(([path]) =>
            path.includes("replay/rr-canary-1/"),
        );
        expect(runFiles.length).to.be.greaterThan(1); // manifest + configGroups + items
        for (const [path, content] of runFiles) {
            expect(content, path).to.not.contain(SENTINEL);
            expect(content, path).to.not.contain('"customSystemPrompt"');
        }
        // The flag replacement IS present in the persisted groups.
        const groupsFile = runFiles.find(([path]) => path.endsWith("configGroups.json"));
        expect(groupsFile).to.not.equal(undefined);
        const persisted = JSON.parse(groupsFile![1]) as ConfigGroupV1[];
        expect(persisted[0].partialOverrides.customSystemPromptUsed).to.equal(true);
    });
});
