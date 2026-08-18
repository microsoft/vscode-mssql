#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Publishes dialect readiness per engine profile.
 *
 * Totals are produced by the same runner the offline test lane uses, from a manifest whose
 * denominator is the reviewed ScriptDOM family list. A category with no scenario is reported as
 * `missing`, never as passing, and the report needs no live server.
 *
 * Usage: node scripts/report-dialect-readiness.mjs [--json]
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { loadDialectInventory, runScenario } = require(
    join(packageRoot, "test", "support", "dialectScenarios.js"),
);
const { platformFeatures, resolvedSqlEngineProfiles } = require(
    join(packageRoot, "dist", "index.js"),
);

const { families, manifest } = loadDialectInventory();
const outcomes = [];
for (const scenario of manifest.scenarios) {
    outcomes.push(await runScenario(scenario));
}

const profiles = [...resolvedSqlEngineProfiles, "unknown"];
const editorCategories = ["completion", "hover", "signature", "definition", "coloring"];

const report = {
    inventory: summarizeInventory(families, manifest),
    byProfile: Object.fromEntries(profiles.map((profile) => [profile, summarizeProfile(profile)])),
    features: summarizeFeatures(),
    failures: outcomes
        .filter((outcome) => outcome.failures.length > 0)
        .map((outcome) => ({ id: outcome.id, failures: outcome.failures })),
};

if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
    print(report);
}
process.exitCode = report.failures.length === 0 && report.inventory.missing === 0 ? 0 : 1;

function summarizeInventory(familyFile, manifestFile) {
    const counts = { covered: 0, outOfScope: 0, duplicate: 0, missing: 0 };
    const unmapped = [];
    for (const family of familyFile.families) {
        if (family.decision !== "covered") {
            counts[family.decision] = (counts[family.decision] ?? 0) + 1;
            continue;
        }
        const mapped = manifestFile.scenarios.some(
            (scenario) =>
                family.scenarioIds?.includes(scenario.id) ||
                scenario.source.includes(family.script),
        );
        if (mapped) counts.covered++;
        else {
            counts.missing++;
            unmapped.push(family.script);
        }
    }
    return { families: familyFile.families.length, ...counts, unmapped };
}

function summarizeProfile(profile) {
    const scenarios = outcomes.filter((outcome) => outcome.profile === profile);
    const byClassification = {};
    for (const classification of ["valid", "unsupportedProfile", "invalid", "incomplete"]) {
        const selected = scenarios.filter((outcome) => outcome.classification === classification);
        // An unidentified engine can never restrict anything, so it has no unsupported-profile
        // scenario by construction. That is a reviewed absence, not a gap in the inventory.
        const notApplicable = profile === "unknown" && classification === "unsupportedProfile";
        byClassification[classification] =
            selected.length === 0
                ? { total: 0, passing: 0, state: notApplicable ? "notApplicable" : "missing" }
                : {
                      total: selected.length,
                      passing: selected.filter((outcome) => outcome.failures.length === 0).length,
                      state: "measured",
                  };
    }
    const editor = Object.fromEntries(
        editorCategories.map((category) => {
            const selected = scenarios.filter((outcome) => outcome.editorKinds.includes(category));
            return [
                category,
                selected.length === 0
                    ? { total: 0, passing: 0, state: "missing" }
                    : {
                          total: selected.length,
                          passing: selected.filter((outcome) => outcome.checks.editor).length,
                          state: "measured",
                      },
            ];
        }),
    );
    return {
        scenarios: scenarios.length,
        passing: scenarios.filter((outcome) => outcome.failures.length === 0).length,
        unexpectedRecovery: scenarios.filter(
            (outcome) =>
                (outcome.classification === "valid" ||
                    outcome.classification === "unsupportedProfile") &&
                outcome.rawErrors !== 0,
        ).length,
        availabilityDiagnostics: scenarios.reduce(
            (total, outcome) => total + outcome.availabilityDiagnostics,
            0,
        ),
        incrementalAgreement: scenarios.filter((outcome) => outcome.checks.incremental).length,
        byClassification,
        editor,
    };
}

function summarizeFeatures() {
    const exercised = new Set();
    for (const scenario of manifest.scenarios) {
        for (const featureId of scenario.expectFeatures ?? []) exercised.add(featureId);
    }
    const gated = platformFeatures.filter((feature) => feature.profiles !== undefined);
    return {
        registered: platformFeatures.length,
        profileGated: gated.length,
        withScenario: gated.filter((feature) => exercised.has(feature.id)).length,
        missing: gated.filter((feature) => !exercised.has(feature.id)).map((feature) => feature.id),
    };
}

function print(value) {
    console.log("T-SQL dialect readiness");
    const inventory = value.inventory;
    console.log(
        `Inventory: ${inventory.families} ScriptDOM families — ${inventory.covered} covered, ` +
            `${inventory.outOfScope} out of scope, ${inventory.missing} missing`,
    );
    for (const script of inventory.unmapped) console.log(`  missing: ${script}`);
    for (const [profile, summary] of Object.entries(value.byProfile)) {
        console.log(
            `${profile}: ${summary.passing}/${summary.scenarios} scenarios, ` +
                `${summary.unexpectedRecovery} unexpected recovery, ` +
                `${summary.availabilityDiagnostics} availability diagnostics`,
        );
        const classes = Object.entries(summary.byClassification)
            .map(([name, entry]) =>
                entry.state === "measured"
                    ? `${name}=${entry.passing}/${entry.total}`
                    : `${name}=${entry.state}`,
            )
            .join(" ");
        console.log(`  classifications: ${classes}`);
        const editor = Object.entries(summary.editor)
            .map(([name, entry]) =>
                entry.state === "measured"
                    ? `${name}=${entry.passing}/${entry.total}`
                    : `${name}=${entry.state}`,
            )
            .join(" ");
        console.log(`  editor: ${editor}`);
    }
    console.log(
        `Features: ${value.features.withScenario}/${value.features.profileGated} profile-gated features have a scenario ` +
            `(${value.features.registered} registered)`,
    );
    for (const featureId of value.features.missing) console.log(`  missing scenario: ${featureId}`);
    for (const failure of value.failures) {
        console.log(`FAIL ${failure.id}`);
        for (const reason of failure.failures) console.log(`     ${reason}`);
    }
}
