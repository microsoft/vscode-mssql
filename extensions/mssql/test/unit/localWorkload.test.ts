/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildLocalCitiesShadowWorkload,
    localCitiesWorkloadFingerprint,
    LocalWorkloadPolicyError,
    MAX_LOCAL_WORKLOAD_BYTES,
    parseLocalWorkload,
    summarizeLocalWorkloadMeasurements,
} from "../../src/runbookStudio/runtime/localWorkload";

suite("Runbook Studio local workload policy", () => {
    test("parses SQLCMD variables and bounded GO repetitions", () => {
        const plan = parseLocalWorkload(
            ':setvar TableName "dbo.RunLog"\nINSERT INTO $(TableName) (Id) VALUES (1);\nGO 2\nSELECT COUNT(*) FROM $(TableName);',
        );
        expect(plan.batchCount).to.equal(3);
        expect(plan.mutating).to.equal(true);
        expect(plan.batches[0]).to.contain("dbo.RunLog");
        expect(plan.batches[1]).to.equal(plan.batches[0]);
        expect(plan.workloadSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("permits blocked words only inside strings and comments", () => {
        const plan = parseLocalWorkload(
            "SELECT 'DROP DATABASE nope' AS Message; -- xp_cmdshell\nGO\nSELECT 1;",
        );
        expect(plan.batchCount).to.equal(2);
        expect(plan.mutating).to.equal(false);
    });

    test("refuses server, external, include, shell, and cross-database effects", () => {
        for (const sql of [
            "USE master; SELECT 1;",
            "DROP DATABASE Important;",
            "EXEC xp_cmdshell 'whoami';",
            "BULK INSERT dbo.T FROM 'file';",
            "INSERT OtherDb.dbo.T VALUES (1);",
            "CREATE DATABASE EscapedTarget;",
            ":r other.sql",
            "!! dir",
        ]) {
            expect(() => parseLocalWorkload(sql), sql).to.throw(LocalWorkloadPolicyError);
        }
    });

    test("refuses unresolved variables and excessive content", () => {
        expect(() => parseLocalWorkload("SELECT '$(Missing)';")).to.throw(LocalWorkloadPolicyError);
        expect(() => parseLocalWorkload(Buffer.alloc(MAX_LOCAL_WORKLOAD_BYTES + 1, 65))).to.throw(
            LocalWorkloadPolicyError,
        );
    });

    test("builds an admitted closed Cities shadow-table workload", () => {
        const source = buildLocalCitiesShadowWorkload(
            Array.from({ length: 10 }, (_, index) => ({
                cityName: index === 0 ? "O'Brien" : `City ${index}`,
                stateProvinceId: index + 1,
                latestRecordedPopulation: index === 1 ? null : 1000 + index,
                lastEditedBy: 1,
            })),
            1000,
            "abcdef123456",
        );
        const plan = parseLocalWorkload(source);
        expect(plan.batchCount).to.equal(1);
        expect(plan.mutating).to.equal(true);
        expect(source).to.contain("WHILE @rbsIteration <= 1000");
        expect(source).to.contain("O''Brien");
        expect(source).to.contain("DROP TABLE [rbs_workload].[Cities_abcdef123456]");
    });

    test("rejects unsafe generated samples and iteration bounds", () => {
        const rows = Array.from({ length: 10 }, (_, index) => ({
            cityName: `City ${index}\u0000`,
            stateProvinceId: 1,
            latestRecordedPopulation: 1000,
            lastEditedBy: 1,
        }));
        expect(() => buildLocalCitiesShadowWorkload(rows, 1000, "abcdef123456")).to.throw(
            LocalWorkloadPolicyError,
        );
        expect(() => buildLocalCitiesShadowWorkload(rows.slice(0, 9), 1001, "bad")).to.throw(
            LocalWorkloadPolicyError,
        );
    });

    test("uses sampled values and protocol settings for stable workload identity", () => {
        const rows = Array.from({ length: 10 }, (_, index) => ({
            cityName: `City ${index}`,
            stateProvinceId: index + 1,
            latestRecordedPopulation: 1000 + index,
            lastEditedBy: 1,
        }));
        const first = localCitiesWorkloadFingerprint(rows, 1000);
        expect(first).to.match(/^[a-f0-9]{64}$/);
        expect(localCitiesWorkloadFingerprint(rows, 1000)).to.equal(first);
        expect(localCitiesWorkloadFingerprint(rows, 999)).not.to.equal(first);
        expect(
            localCitiesWorkloadFingerprint(
                rows.map((row, index) =>
                    index === 0 ? { ...row, cityName: "Changed City" } : row,
                ),
                1000,
            ),
        ).not.to.equal(first);
    });

    test("summarizes complete successful repetitions and excludes partial failures", () => {
        const summary = summarizeLocalWorkloadMeasurements(
            [
                { iteration: 1, durationMs: 10, succeeded: true },
                { iteration: 1, durationMs: 20, succeeded: true },
                { iteration: 2, durationMs: 20, succeeded: true },
                { iteration: 2, durationMs: 30, succeeded: true },
                { iteration: 3, durationMs: 40, succeeded: false },
            ],
            2,
        );
        expect(summary).to.deep.equal({
            measurementSampleCount: 2,
            meanDurationMs: 40,
            p50DurationMs: 30,
            p95DurationMs: 50,
            minDurationMs: 30,
            maxDurationMs: 50,
            standardDeviationMs: 10,
        });
    });
});
