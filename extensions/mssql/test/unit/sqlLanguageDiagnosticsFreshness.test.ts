/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Diagnostics freshness invariants owned by the native engine and scheduler.
 * Consumer-specific publication wiring is tested with the consumer that composes
 * the engine; this suite keeps the language-service foundation independently usable.
 */

import { expect } from "chai";
import { DiagnosticsResult } from "../../src/sqlLanguage/api";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import {
    DiagnosticsSnapshot,
    SlicedDiagnosticsPass,
    SlicedDiagnosticsScheduler,
    isMetadataDriftCancel,
} from "../../src/sqlLanguage/host/scheduler";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);
const T1_PLUS_BINDER = "SELECT (1 + 2))\nSELECT Missing FROM Sales.Orders";

async function diagnose(
    text: string,
    metadataFreshness?: "validated" | "notValidated",
): Promise<DiagnosticsResult> {
    const result = await new NativeSqlLanguageEngine(standardProvider).diagnostics({
        text,
        version: 1,
        ...(metadataFreshness !== undefined ? { metadataFreshness } : {}),
    });
    expect(result).to.not.equal(undefined);
    return result!;
}

function codes(result: DiagnosticsResult): (string | undefined)[] {
    return result.diagnostics.map((diagnostic) => diagnostic.code);
}

suite("sqlLanguage diagnostics freshness gate", () => {
    test("notValidated suppresses metadata-backed claims while preserving T1", async () => {
        const result = await diagnose(T1_PLUS_BINDER, "notValidated");
        expect(codes(result)).to.include("mssql(102)");
        expect(codes(result)).to.not.include("mssql(207)");
        expect(result.suppressed?.metadataNotValidated ?? 0).to.be.at.least(1);
    });

    test("validated and absent verdicts preserve binder diagnostics", async () => {
        expect(codes(await diagnose(T1_PLUS_BINDER, "validated"))).to.include("mssql(207)");
        expect(codes(await diagnose(T1_PLUS_BINDER))).to.include("mssql(207)");
    });

    test("the diagnostics memo distinguishes freshness verdicts", async () => {
        const engine = new NativeSqlLanguageEngine(standardProvider);
        const suppressed = await engine.diagnostics({
            text: T1_PLUS_BINDER,
            version: 3,
            metadataFreshness: "notValidated",
        });
        const validated = await engine.diagnostics({
            text: T1_PLUS_BINDER,
            version: 3,
            metadataFreshness: "validated",
        });
        expect(validated).to.not.equal(suppressed);
        expect(codes(validated!)).to.include("mssql(207)");
        expect(codes(suppressed!)).to.not.include("mssql(207)");
    });
});

interface ScriptedPass extends SlicedDiagnosticsPass {
    readonly stepCount: () => number;
    readonly aborted: () => boolean;
}

function scriptedPass(units: number): ScriptedPass {
    let steps = 0;
    let aborted = false;
    return {
        step: () => ++steps < units,
        finish: () => ({ diagnostics: [] }),
        abort: () => {
            aborted = true;
        },
        stepCount: () => steps,
        aborted: () => aborted,
    };
}

interface StaleCancelRecord {
    readonly started: DiagnosticsSnapshot;
    readonly current: DiagnosticsSnapshot | undefined;
}

suite("sqlLanguage diagnostics scheduler drift handling", () => {
    test("generation drift aborts the pass and is classified as metadata drift", async () => {
        let generation = 1;
        const passes: ScriptedPass[] = [];
        const cancels: StaleCancelRecord[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "SELECT 1", version: 1, stamp: `1:${generation}` }),
            createPass: () => {
                const pass = scriptedPass(10);
                passes.push(pass);
                return pass;
            },
            publish: () => undefined,
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (passes[0]?.stepCount() === 2) {
                    generation = 2;
                }
            },
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });

        await scheduler.runNow();
        expect(passes[0].aborted()).to.equal(true);
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(true);
        scheduler.dispose();
    });

    test("document edits abort work but are not metadata drift", async () => {
        let version = 1;
        const passes: ScriptedPass[] = [];
        const cancels: StaleCancelRecord[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version, stamp: `${version}:1` }),
            createPass: () => {
                const pass = scriptedPass(10);
                passes.push(pass);
                return pass;
            },
            publish: () => undefined,
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (passes[0]?.stepCount() === 2) {
                    version = 2;
                }
            },
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });

        await scheduler.runNow();
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(false);
        scheduler.dispose();
    });

    test("staleness is rechecked after an asynchronous pass factory", async () => {
        let stamp = "1:1";
        const pass = scriptedPass(3);
        const cancels: StaleCancelRecord[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp }),
            createPass: async () => {
                stamp = "1:2";
                return pass;
            },
            publish: () => undefined,
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });

        await scheduler.runNow();
        expect(pass.stepCount()).to.equal(0);
        expect(pass.aborted()).to.equal(true);
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(true);
        scheduler.dispose();
    });
});
