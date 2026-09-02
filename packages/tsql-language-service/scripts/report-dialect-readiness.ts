#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Publishes dialect readiness per engine profile.
 *
 * Totals are produced by the same runner the strict unit test lane uses, from a manifest whose
 * denominator is the reviewed ScriptDOM family list. A category with no scenario is reported as
 * `missing`, never as passing, and the report needs no live server.
 *
 * Usage: npx tsx scripts/report-dialect-readiness.ts [--json]
 */

import { platformFeatures, type PlatformFeature, type SqlEngineProfile } from "../src/index.ts";
import {
    loadDialectInventory,
    runScenario,
    type DialectClassification,
    type DialectInventoryDecision,
    type DialectManifest,
    type DialectScenarioOutcome,
    type ScriptDomFamilyInventory,
} from "../test/unit/dialect/support/dialectScenarios.ts";

const { families, manifest } = loadDialectInventory();
const editorCategories = ["completion", "hover", "signature", "definition", "coloring"] as const;

type EditorCategory = (typeof editorCategories)[number];
type MeasurementState = "measured" | "missing" | "notApplicable";

interface Measurement {
    readonly total: number;
    readonly passing: number;
    readonly state: MeasurementState;
}

interface InventorySummary extends Record<DialectInventoryDecision, number> {
    readonly families: number;
    readonly unmapped: readonly string[];
}

interface ProfileSummary {
    readonly scenarios: number;
    readonly passing: number;
    readonly unexpectedRecovery: number;
    readonly availabilityDiagnostics: number;
    readonly incrementalAgreement: number;
    readonly byClassification: Readonly<Record<DialectClassification, Measurement>>;
    readonly editor: Readonly<Record<EditorCategory, Measurement>>;
}

interface FeatureSummary {
    readonly registered: number;
    readonly profileGated: number;
    readonly withScenario: number;
    readonly missing: readonly string[];
}

interface DialectReadinessReport {
    readonly inventory: InventorySummary;
    readonly byProfile: Readonly<Record<SqlEngineProfile, ProfileSummary>>;
    readonly features: FeatureSummary;
    readonly failures: readonly {
        readonly id: string;
        readonly failures: readonly string[];
    }[];
}

void main();

async function main(): Promise<void> {
    const outcomes = await Promise.all(manifest.scenarios.map(runScenario));
    const report: DialectReadinessReport = {
        inventory: summarizeInventory(families, manifest),
        byProfile: {
            "sql-server": summarizeProfile("sql-server", outcomes),
            "azure-sql-database": summarizeProfile("azure-sql-database", outcomes),
            "azure-sql-managed-instance": summarizeProfile("azure-sql-managed-instance", outcomes),
            "azure-synapse-dedicated": summarizeProfile("azure-synapse-dedicated", outcomes),
            "fabric-warehouse": summarizeProfile("fabric-warehouse", outcomes),
            unknown: summarizeProfile("unknown", outcomes),
        },
        features: summarizeFeatures(platformFeatures, manifest),
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
}

function summarizeInventory(
    familyFile: ScriptDomFamilyInventory,
    manifestFile: DialectManifest,
): InventorySummary {
    const counts: Record<DialectInventoryDecision, number> = {
        covered: 0,
        outOfScope: 0,
        duplicate: 0,
        missing: 0,
    };
    const unmapped: string[] = [];
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

function summarizeProfile(
    profile: SqlEngineProfile,
    outcomes: readonly DialectScenarioOutcome[],
): ProfileSummary {
    const scenarios = outcomes.filter((outcome) => outcome.profile === profile);
    const summarizeClassification = (classification: DialectClassification): Measurement => {
        const selected = scenarios.filter((outcome) => outcome.classification === classification);
        // An unidentified engine can never restrict anything, so it has no unsupported-profile
        // scenario by construction. That is a reviewed absence, not a gap in the inventory.
        const notApplicable = profile === "unknown" && classification === "unsupportedProfile";
        return selected.length === 0
            ? { total: 0, passing: 0, state: notApplicable ? "notApplicable" : "missing" }
            : {
                  total: selected.length,
                  passing: selected.filter((outcome) => outcome.failures.length === 0).length,
                  state: "measured",
              };
    };
    const summarizeEditor = (category: EditorCategory): Measurement => {
        const selected = scenarios.filter((outcome) => outcome.editorKinds.includes(category));
        return selected.length === 0
            ? { total: 0, passing: 0, state: "missing" }
            : {
                  total: selected.length,
                  passing: selected.filter((outcome) => outcome.checks.editor).length,
                  state: "measured",
              };
    };
    const byClassification: Record<DialectClassification, Measurement> = {
        valid: summarizeClassification("valid"),
        unsupportedProfile: summarizeClassification("unsupportedProfile"),
        invalid: summarizeClassification("invalid"),
        incomplete: summarizeClassification("incomplete"),
    };
    const editor: Record<EditorCategory, Measurement> = {
        completion: summarizeEditor("completion"),
        hover: summarizeEditor("hover"),
        signature: summarizeEditor("signature"),
        definition: summarizeEditor("definition"),
        coloring: summarizeEditor("coloring"),
    };
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

function summarizeFeatures(
    features: readonly PlatformFeature[],
    manifestFile: DialectManifest,
): FeatureSummary {
    const exercised = new Set<string>();
    for (const scenario of manifestFile.scenarios) {
        for (const featureId of scenario.expectFeatures ?? []) exercised.add(featureId);
    }
    const gated = features.filter((feature) => feature.profiles !== undefined);
    return {
        registered: features.length,
        profileGated: gated.length,
        withScenario: gated.filter((feature) => exercised.has(feature.id)).length,
        missing: gated.filter((feature) => !exercised.has(feature.id)).map((feature) => feature.id),
    };
}

function print(value: DialectReadinessReport): void {
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
