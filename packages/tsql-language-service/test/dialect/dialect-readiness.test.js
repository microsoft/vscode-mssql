/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { loadDialectInventory, runScenario } = require("../support/dialectScenarios.js");
const { platformFeatures, sqlEngineProfiles } = require("../../dist/index.js");

const { families, manifest } = loadDialectInventory();
const classifications = new Set(Object.keys(manifest.classifications));
const scenarioIds = new Set(manifest.scenarios.map((scenario) => scenario.id));

suite("dialect inventory", () => {
    // Verifies the denominator is complete: every relevant ScriptDOM family has been decided, and
    // a family marked covered has exact executable evidence. Generic platform prefixes are not
    // evidence: one Fabric scenario must never make every Fabric grammar family appear covered.
    test("every ScriptDOM family has a reviewed decision", () => {
        const unmapped = [];
        for (const family of families.families) {
            assert.ok(
                ["covered", "missing", "outOfScope", "duplicate"].includes(family.decision),
                `${family.script}: ${family.decision}`,
            );
            assert.ok(family.note.length > 20, `${family.script} has no reviewed note`);
            if (family.decision !== "covered") continue;
            const explicit = family.scenarioIds ?? [];
            for (const id of explicit) assert.ok(scenarioIds.has(id), `${family.script}: ${id}`);
            if (
                explicit.length === 0 &&
                !manifest.scenarios.some((scenario) => scenario.source.includes(family.script))
            ) {
                unmapped.push(family.script);
            }
        }
        assert.deepEqual(unmapped, [], "families marked covered without exact scenario evidence");
    });

    // Verifies each scenario is completely described, so a total can never come from a blank entry.
    test("every scenario is completely described", () => {
        const identifiers = new Set();
        for (const scenario of manifest.scenarios) {
            assert.ok(!identifiers.has(scenario.id), `duplicate scenario ${scenario.id}`);
            identifiers.add(scenario.id);
            assert.ok(
                sqlEngineProfiles.includes(scenario.profile),
                `${scenario.id}: ${scenario.profile}`,
            );
            assert.ok(
                classifications.has(scenario.classification),
                `${scenario.id}: ${scenario.classification}`,
            );
            assert.ok(scenario.sql.length > 0, scenario.id);
            assert.ok(scenario.family.length > 0, scenario.id);
            assert.ok(scenario.source.length > 10, `${scenario.id} has no source reference`);
            assert.equal(scenario.provenance, "independently authored", scenario.id);
            if (scenario.classification === "unsupportedProfile") {
                assert.ok(
                    (scenario.expectFeatures ?? []).length > 0,
                    `${scenario.id} declares no expected feature`,
                );
            }
        }
    });

    // Verifies every profile-gated feature is exercised on a profile that does not have it.
    test("every profile-gated feature has an unsupported-profile scenario", () => {
        const exercised = new Set(
            manifest.scenarios.flatMap((scenario) => scenario.expectFeatures ?? []),
        );
        const missing = platformFeatures
            .filter((feature) => feature.profiles !== undefined)
            .filter((feature) => !exercised.has(feature.id))
            .map((feature) => feature.id);
        assert.deepEqual(missing, []);
    });

    // Verifies every scoped profile is measured rather than assumed.
    test("every scoped profile has scenarios in all four classifications", () => {
        for (const profile of sqlEngineProfiles) {
            const scenarios = manifest.scenarios.filter((scenario) => scenario.profile === profile);
            assert.ok(scenarios.length > 0, `${profile} has no scenario`);
            for (const classification of classifications) {
                // An unidentified engine restricts nothing, so it has no unsupported-profile case.
                if (profile === "unknown" && classification === "unsupportedProfile") continue;
                assert.ok(
                    scenarios.some((scenario) => scenario.classification === classification),
                    `${profile} has no ${classification} scenario`,
                );
            }
        }
    });
});

for (const profile of sqlEngineProfiles) {
    const scenarios = manifest.scenarios.filter((scenario) => scenario.profile === profile);
    if (scenarios.length === 0) continue;
    suite(`dialect scenarios — ${profile}`, () => {
        for (const scenario of scenarios) {
            test(scenario.id, async () => {
                const outcome = await runScenario(scenario);
                assert.deepEqual(outcome.failures, []);
            });
        }
    });
}
