/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B10 / LS-2 sliced diagnostics scheduler suite: debounce coalescing,
 * time-sliced passes with yields between slices, stale-version cancellation
 * (edits AND metadata-generation changes via the snapshot stamp), and
 * dispose/cancel semantics. Uses scripted passes — no engine required.
 */

import { expect } from "chai";
import { DiagnosticsResult } from "../../src/sqlLanguage/api";
import {
    DiagnosticsSnapshot,
    SlicedDiagnosticsPass,
    SlicedDiagnosticsScheduler,
} from "../../src/sqlLanguage/host/scheduler";

interface ScriptedPass extends SlicedDiagnosticsPass {
    readonly stepCount: () => number;
    readonly aborted: () => boolean;
}

function scriptedPass(units: number, result?: DiagnosticsResult): ScriptedPass {
    let steps = 0;
    let aborted = false;
    return {
        step: () => {
            steps++;
            return steps < units;
        },
        finish: () => result ?? { diagnostics: [] },
        abort: () => {
            aborted = true;
        },
        stepCount: () => steps,
        aborted: () => aborted,
    };
}

function tick(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("sqlLanguage diagnostics scheduler", () => {
    test("debounce coalesces change bursts into one pass", async () => {
        const passes: ScriptedPass[] = [];
        const published: number[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "SELECT 1", version: passes.length + 1, stamp: "v" }),
            createPass: () => {
                const pass = scriptedPass(1);
                passes.push(pass);
                return pass;
            },
            publish: (_result, version) => published.push(version),
            debounceMs: 20,
        });
        scheduler.notifyChange();
        scheduler.notifyChange();
        scheduler.notifyChange();
        expect(scheduler.state).to.equal("debouncing");
        await tick(80);
        expect(passes).to.have.length(1);
        expect(published).to.have.length(1);
        expect(scheduler.state).to.equal("idle");
        scheduler.dispose();
    });

    test("each debounce window restarts; a later change reschedules", async () => {
        let created = 0;
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: `s${created}` }),
            createPass: () => {
                created++;
                return scriptedPass(1);
            },
            publish: () => undefined,
            debounceMs: 20,
        });
        scheduler.notifyChange();
        await tick(60);
        scheduler.notifyChange();
        await tick(60);
        expect(created).to.equal(2);
        scheduler.dispose();
    });

    test("slicing: zero budget yields between every unit", async () => {
        let yields = 0;
        const pass = scriptedPass(5);
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: "s" }),
            createPass: () => pass,
            publish: () => undefined,
            sliceBudgetMs: 0,
            yieldSlice: () => {
                yields++;
                return Promise.resolve();
            },
        });
        await scheduler.runNow();
        expect(pass.stepCount()).to.equal(5);
        expect(yields).to.be.at.least(4);
        scheduler.dispose();
    });

    test("stale version cancels the in-flight pass; the new version publishes", async () => {
        let version = 1;
        const passes: ScriptedPass[] = [];
        const published: number[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version, stamp: `v${version}` }),
            createPass: () => {
                const pass = scriptedPass(10);
                passes.push(pass);
                return pass;
            },
            publish: (_result, publishedVersion) => published.push(publishedVersion),
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (passes.length === 1 && passes[0].stepCount() === 2) {
                    version = 2; // edit arrives mid-pass
                }
            },
        });
        await scheduler.runNow();
        expect(passes[0].aborted()).to.equal(true);
        expect(published).to.deep.equal([]);
        await scheduler.runNow();
        expect(published).to.deep.equal([2]);
        expect(passes[1].aborted()).to.equal(false);
        scheduler.dispose();
    });

    test("metadata generation change (same version) also cancels via the stamp", async () => {
        let generation = 1;
        const passes: ScriptedPass[] = [];
        const published: number[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: `1:${generation}` }),
            createPass: () => {
                const pass = scriptedPass(10);
                passes.push(pass);
                return pass;
            },
            publish: (_result, publishedVersion) => published.push(publishedVersion),
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (passes.length === 1 && passes[0].stepCount() === 1) {
                    generation = 2; // hydration lands mid-pass
                }
            },
        });
        await scheduler.runNow();
        expect(passes[0].aborted()).to.equal(true);
        expect(published).to.deep.equal([]);
        scheduler.dispose();
    });

    test("cancel() abandons the debounce and the in-flight run", async () => {
        const published: number[] = [];
        const pass = scriptedPass(10);
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: "s" }),
            createPass: () => pass,
            publish: (_result, version) => published.push(version),
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (pass.stepCount() === 2) {
                    scheduler.cancel();
                }
            },
        });
        await scheduler.runNow();
        expect(pass.aborted()).to.equal(true);
        expect(published).to.deep.equal([]);
        scheduler.dispose();
    });

    test("dispose() prevents any further scheduling", async () => {
        let created = 0;
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: "s" }),
            createPass: () => {
                created++;
                return scriptedPass(1);
            },
            publish: () => undefined,
            debounceMs: 5,
        });
        scheduler.dispose();
        scheduler.notifyChange();
        await scheduler.runNow();
        await tick(30);
        expect(created).to.equal(0);
    });

    test("publish carries the pass result and version", async () => {
        const result: DiagnosticsResult = {
            diagnostics: [
                {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    severity: "error",
                    message: "x",
                    source: "T-SQL (native)",
                },
            ],
            suppressed: { dynamicSql: 2 },
        };
        let publishedResult: DiagnosticsResult | undefined;
        let publishedVersion: number | undefined;
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: (): DiagnosticsSnapshot => ({ text: "x", version: 42, stamp: "s" }),
            createPass: () => scriptedPass(3, result),
            publish: (r, v) => {
                publishedResult = r;
                publishedVersion = v;
            },
        });
        await scheduler.runNow();
        expect(publishedResult).to.equal(result);
        expect(publishedVersion).to.equal(42);
        expect(scheduler.lastPublishedVersion).to.equal(42);
        scheduler.dispose();
    });

    test("no snapshot (document gone) is a no-op", async () => {
        let created = 0;
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => undefined,
            createPass: () => {
                created++;
                return scriptedPass(1);
            },
            publish: () => undefined,
        });
        await scheduler.runNow();
        expect(created).to.equal(0);
        scheduler.dispose();
    });
});
