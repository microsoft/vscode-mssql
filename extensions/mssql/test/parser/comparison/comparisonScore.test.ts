/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    comparisonScenarios,
    resolveSelector,
    type ComparisonScenario,
    type TextSelector,
} from "./comparisonScenarios";
import { scoreComparison, type ScenarioResult } from "./comparisonScore";

suite("T-SQL parser comparison scoring", () => {
    test("keeps every feature represented and every selector resolvable", () => {
        const ids = new Set<string>();
        const features = new Set(comparisonScenarios.map((scenario) => scenario.feature));

        expect(features).to.deep.equal(
            new Set([
                "syntax",
                "recovery",
                "diagnosticSpans",
                "dmlTargets",
                "scopes",
                "symbols",
                "references",
                "types",
                "completions",
            ]),
        );
        for (const scenario of comparisonScenarios) {
            expect(ids.has(scenario.id), scenario.id).to.be.false;
            ids.add(scenario.id);
            for (const selector of selectorsOf(scenario)) {
                expect(() => resolveSelector(scenario.sql, selector), scenario.id).not.to.throw();
            }
        }
    });

    test("counts missing and unsupported results as failures", () => {
        const syntaxScenario = comparisonScenarios.find(
            (scenario) => scenario.feature === "syntax",
        )!;
        const results: ScenarioResult[] = [
            { scenarioId: syntaxScenario.id, feature: "syntax", passed: true },
        ];
        const score = scoreComparison(comparisonScenarios, results);

        expect(score.features.find((item) => item.feature === "syntax")?.passed).to.equal(1);
        expect(score.features.find((item) => item.feature === "completions")?.passed).to.equal(0);
        expect(score.microPercent).to.be.lessThan(100);
        expect(score.macroPercent).to.be.lessThan(score.microPercent);
    });

    test("gives each feature equal macro weight", () => {
        const results = comparisonScenarios.map(
            (scenario): ScenarioResult => ({
                scenarioId: scenario.id,
                feature: scenario.feature,
                passed: scenario.feature === "syntax",
            }),
        );
        const score = scoreComparison(comparisonScenarios, results);

        expect(score.features.find((item) => item.feature === "syntax")?.percent).to.equal(100);
        expect(score.macroPercent).to.be.closeTo(100 / 9, 0.000_001);
    });
});

function selectorsOf(scenario: ComparisonScenario): Array<TextSelector | "eof"> {
    switch (scenario.feature) {
        case "syntax":
            return scenario.expectedDiagnostic ? [scenario.expectedDiagnostic.span] : [];
        case "recovery":
            return [
                scenario.damagedSpan,
                ...(scenario.preservedStatement ? [scenario.preservedStatement] : []),
                ...(scenario.completion ? [scenario.completion.caret] : []),
            ];
        case "diagnosticSpans":
            return scenario.expectedDiagnostics.map((diagnostic) => diagnostic.span);
        case "dmlTargets":
            return [
                scenario.target,
                ...(scenario.expectedDiagnosticSpan ? [scenario.expectedDiagnosticSpan] : []),
            ];
        case "scopes":
            return [scenario.at];
        case "symbols":
            return scenario.expected.map((symbol) => symbol.span);
        case "references":
            return [scenario.at, ...scenario.occurrences.map((occurrence) => occurrence.span)];
        case "types":
            return [scenario.at];
        case "completions":
            return [scenario.caret];
    }
}
