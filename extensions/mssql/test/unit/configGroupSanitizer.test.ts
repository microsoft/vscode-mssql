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
import type { SqlInlineCompletionSchemaBudgetOverrides } from "../../src/copilot/completionSchemaContextCore";

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

function groupWithNestedSentinel(): ConfigGroupV1 {
    const group = groupWithSentinel();
    const schemaContext = {
        budgetProfile: "balanced",
        includeRoutines: false,
        schemaSizeAdaptive: true,
        relevanceTermRecencyBias: false,
        columnRepresentation: "types",
        messageOrder: "data-then-rules",
        schemaContextChannel: "separate-message",
        customSystemPrompt: SENTINEL,
        unknown: { nested: SENTINEL },
        budgetOverrides: {
            maxTables: 12,
            maxPromptTokens: 0,
            columnNameRelevanceWeight: 0.5,
            cacheTtlMs: 1000,
            customSystemPrompt: SENTINEL,
            maxViews: { prompt: SENTINEL },
            maxSchemas: SENTINEL,
            maxRoutines: Infinity,
            maxForeignKeys: NaN,
            unknown: 123,
        },
    };
    group.partialOverrides.schemaContext = schemaContext;
    group.effectiveConfig!.schemaContext = schemaContext;
    return group;
}

suite("Config-group sanitizer (shared allowlist)", () => {
    test("preserves every supported numeric schema budget on disk and wire", () => {
        const budget: Required<SqlInlineCompletionSchemaBudgetOverrides> = {
            maxSchemas: 1,
            maxTables: 2,
            maxViews: 3,
            maxColumnsPerObject: 4,
            smallSchemaMaxColumnsPerObject: 5,
            largeSchemaMaxColumnsPerObject: 6,
            maxFetchedTables: 7,
            maxFetchedViews: 8,
            maxTableNameOnlyInventory: 9,
            maxViewNameOnlyInventory: 10,
            largeTableNameOnlyInventory: 11,
            largeViewNameOnlyInventory: 12,
            outlierNameOnlyInventory: 13,
            maxFetchedSchemas: 14,
            maxSystemObjects: 15,
            maxMasterSymbols: 16,
            maxForeignKeys: 17,
            maxSchemaContextRelevanceTerms: 18,
            maxRoutines: 19,
            maxFetchedRoutines: 20,
            maxRoutineNameOnlyInventory: 21,
            largeRoutineNameOnlyInventory: 22,
            maxParametersPerRoutine: 23,
            maxPromptChars: 24,
            maxPromptTokens: 0,
            smallSchemaThreshold: 26,
            largeSchemaThreshold: 27,
            outlierSchemaThreshold: 28,
            foreignKeyExpansionDepth: 29,
            foreignKeyExpansionObjectCap: 30,
            columnNameRelevanceWeight: 0.5,
            defaultSchemaWeight: 0.75,
            inventoryChunkSize: 33,
            cacheTtlMs: 34,
        };
        const schemaContext = { budgetOverrides: budget };
        const group = groupWithSentinel();
        group.partialOverrides = { schemaContext };
        group.effectiveConfig = { schemaContext };
        const persisted = sanitizeConfigGroupForPersistence(group);
        expect(persisted.partialOverrides.schemaContext).to.deep.equal(schemaContext);
        expect(persisted.effectiveConfig!.schemaContext).to.deep.equal(schemaContext);
        expect(sanitizeReplayLabConfigGroup(group).overridesSummary.schemaContext).to.deep.equal(
            schemaContext,
        );
        expect(sanitizeConfigGroupForPersistence(persisted)).to.deep.equal(persisted);
        expect(sanitizeReplayLabConfigGroup(persisted)).to.deep.equal(
            sanitizeReplayLabConfigGroup(group),
        );
    });

    test("nested schema settings retain only known typed knobs on disk and wire", () => {
        const group = groupWithNestedSentinel();
        const expected = {
            budgetProfile: "balanced",
            includeRoutines: false,
            schemaSizeAdaptive: true,
            relevanceTermRecencyBias: false,
            columnRepresentation: "types",
            messageOrder: "data-then-rules",
            schemaContextChannel: "separate-message",
            budgetOverrides: {
                maxTables: 12,
                maxPromptTokens: 0,
                columnNameRelevanceWeight: 0.5,
                cacheTtlMs: 1000,
            },
        };
        const persisted = sanitizeConfigGroupForPersistence(group);
        const wire = sanitizeReplayLabConfigGroup(group);
        expect(persisted.partialOverrides.schemaContext).to.deep.equal(expected);
        expect(persisted.effectiveConfig!.schemaContext).to.deep.equal(expected);
        expect(wire.overridesSummary.schemaContext).to.deep.equal(expected);
        expect(JSON.stringify(persisted)).to.not.contain(SENTINEL);
        expect(JSON.stringify(wire)).to.not.contain(SENTINEL);
        expect(sanitizeConfigGroupForPersistence(persisted)).to.deep.equal(persisted);
        expect(sanitizeReplayLabConfigGroup(persisted)).to.deep.equal(wire);
        // Projection must not alter the captured input used to compute its digest.
        expect(JSON.stringify(group)).to.contain(SENTINEL);
    });

    test("schema fields reject invalid enums, booleans, and non-record subtrees", () => {
        for (const schemaContext of [
            SENTINEL,
            [SENTINEL],
            {
                budgetProfile: SENTINEL,
                columnRepresentation: SENTINEL,
                messageOrder: SENTINEL,
                schemaContextChannel: SENTINEL,
                schemaSizeAdaptive: SENTINEL,
                includeRoutines: { text: SENTINEL },
                relevanceTermRecencyBias: [SENTINEL],
                budgetOverrides: [SENTINEL],
            },
        ]) {
            const group = groupWithSentinel();
            group.partialOverrides = { schemaContext };
            group.effectiveConfig = { schemaContext };
            expect(JSON.stringify(sanitizeConfigGroupForPersistence(group))).to.not.contain(
                SENTINEL,
            );
            expect(JSON.stringify(sanitizeReplayLabConfigGroup(group))).to.not.contain(SENTINEL);
        }
        const group = groupWithSentinel();
        group.partialOverrides = { schemaContext: null };
        expect(sanitizeReplayLabConfigGroup(group).overridesSummary.schemaContext).to.equal(null);
    });

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
            configGroups: [groupWithNestedSentinel()],
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
