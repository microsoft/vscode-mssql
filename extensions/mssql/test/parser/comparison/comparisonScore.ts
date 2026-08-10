/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ComparisonFeature, ComparisonScenario } from "./comparisonScenarios";

export interface ScenarioResult {
    scenarioId: string;
    feature: ComparisonFeature;
    passed: boolean;
    details?: string;
}

export interface FeatureScore {
    feature: ComparisonFeature;
    passed: number;
    total: number;
    percent: number;
}

export interface ComparisonScore {
    features: FeatureScore[];
    /** Equal-weight mean of feature percentages, so a large syntax corpus cannot hide LSP gaps. */
    macroPercent: number;
    /** Useful raw result, but never the sole engine-selection number. */
    microPercent: number;
}

const features: ComparisonFeature[] = [
    "syntax",
    "recovery",
    "diagnosticSpans",
    "dmlTargets",
    "scopes",
    "symbols",
    "references",
    "types",
    "completions",
];

/**
 * Scores against the complete corpus. Missing results are failures, including unsupported
 * features. Duplicate and unknown result IDs are rejected to prevent denominator manipulation.
 */
export function scoreComparison(
    scenarios: readonly ComparisonScenario[],
    results: readonly ScenarioResult[],
): ComparisonScore {
    const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const resultById = new Map<string, ScenarioResult>();

    for (const result of results) {
        const scenario = scenarioById.get(result.scenarioId);
        if (!scenario) {
            throw new Error(`Unknown comparison scenario result: ${result.scenarioId}`);
        }
        if (scenario.feature !== result.feature) {
            throw new Error(
                `Feature mismatch for ${result.scenarioId}: expected ${scenario.feature}, got ${result.feature}`,
            );
        }
        if (resultById.has(result.scenarioId)) {
            throw new Error(`Duplicate comparison scenario result: ${result.scenarioId}`);
        }
        resultById.set(result.scenarioId, result);
    }

    const featureScores = features.map((feature): FeatureScore => {
        const featureScenarios = scenarios.filter((scenario) => scenario.feature === feature);
        const passed = featureScenarios.filter(
            (scenario) => resultById.get(scenario.id)?.passed === true,
        ).length;
        return {
            feature,
            passed,
            total: featureScenarios.length,
            percent: percentage(passed, featureScenarios.length),
        };
    });
    const populated = featureScores.filter((score) => score.total > 0);
    const total = featureScores.reduce((sum, score) => sum + score.total, 0);
    const passed = featureScores.reduce((sum, score) => sum + score.passed, 0);

    return {
        features: featureScores,
        macroPercent: populated.reduce((sum, score) => sum + score.percent, 0) / populated.length,
        microPercent: percentage(passed, total),
    };
}

function percentage(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : (numerator / denominator) * 100;
}
