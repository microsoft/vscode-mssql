/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SaralSqlAnalysisEngine } from "@vscode-mssql/tsql-language-service";
import { evaluateComparison } from "../comparison/evaluateComparison";
import { comparisonScenarios, type ComparisonFeature } from "../comparison/comparisonScenarios";

suite("T-SQL analysis engine comparison", () => {
    const expectedPassedByFeature: Record<string, Record<ComparisonFeature, number>> = {
        saralsql: {
            syntax: 4,
            recovery: 2,
            diagnosticSpans: 3,
            dmlTargets: 7,
            scopes: 2,
            symbols: 1,
            references: 2,
            types: 2,
            completions: 3,
        },
    };

    for (const engine of [new SaralSqlAnalysisEngine()]) {
        test(`scores every fixed-denominator scenario through ${engine.displayName}`, () => {
            const report = evaluateComparison(engine);
            const ids = report.results.map((result) => result.scenarioId);

            expect(ids).to.have.length(comparisonScenarios.length);
            expect(new Set(ids).size).to.equal(comparisonScenarios.length);
            expect(ids).to.have.members(comparisonScenarios.map((scenario) => scenario.id));
            expect(report.score.features.every((feature) => feature.total > 0)).to.equal(true);
            expect(
                report.score.features.reduce((total, feature) => total + feature.total, 0),
            ).to.equal(comparisonScenarios.length);
            expect(report.score.microPercent).to.be.within(0, 100);
            expect(report.score.macroPercent).to.be.within(0, 100);
            expect(
                report.results.every((result) => result.passed || Boolean(result.details)),
            ).to.equal(true);
            expect(
                Object.fromEntries(
                    report.score.features.map((feature) => [feature.feature, feature.passed]),
                ),
            ).to.deep.equal(expectedPassedByFeature[engine.id]);
            expect(
                report.score.features.reduce((total, feature) => total + feature.passed, 0),
            ).to.equal(report.results.filter((result) => result.passed).length);

            console.log(`\n${report.engineName} ${report.engineVersion} comparison score`);
            console.table(
                report.score.features.map((feature) => ({
                    feature: feature.feature,
                    passed: feature.passed,
                    total: feature.total,
                    percent: feature.percent.toFixed(2),
                })),
            );
            for (const failure of report.results.filter((result) => !result.passed)) {
                console.log(`  FAIL ${failure.scenarioId}: ${failure.details}`);
            }
        });
    }
});
