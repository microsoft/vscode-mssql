/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-5 diagnostics freshness suite (cache/drift addendum §7.3): binder
 * (T2) diagnostics never assert claims from unvalidated/stale metadata.
 *
 * - engine gate: a host-supplied "notValidated" verdict suppresses every
 *   binder claim (counted `metadataNotValidated`); T1 continues unchanged;
 * - scheduler drift cancel: a metadata-generation change mid-pass aborts
 *   AND reports the cancel so the host counts `metadataStale` (the restart
 *   itself is the pre-existing behavior);
 * - host publisher: ensureFresh(MetadataPolicies.diagnosticsBinder) is the
 *   verdict source; its wait budget is a race — a lease that never settles
 *   cannot block the pass (T1-only publish within a bounded time).
 */

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
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
import {
    FreshCatalogResult,
    MetadataFreshnessPolicy,
    MetadataPolicies,
} from "../../src/services/metadata/cache/metadataFreshness";
import { QueryStudioLanguageService } from "../../src/queryStudio/queryStudioLanguageService";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);

/** One T1 error (unmatched paren) + one statement that binds to a 207. */
const T1_PLUS_BINDER = "SELECT (1 + 2))\nSELECT Missing FROM Sales.Orders";

async function diagnose(
    text: string,
    metadataFreshness?: "validated" | "notValidated",
): Promise<DiagnosticsResult> {
    const engine = new NativeSqlLanguageEngine(standardProvider);
    const result = await engine.diagnostics({
        text,
        version: 1,
        ...(metadataFreshness !== undefined ? { metadataFreshness } : {}),
    });
    expect(result).to.not.equal(undefined);
    return result!;
}

function codes(result: DiagnosticsResult): (string | undefined)[] {
    return result.diagnostics.map((d) => d.code);
}

// ---------------------------------------------------------------------------
// Engine gate (pure side): the verdict arrives as data
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics freshness gate (CACHE-5 §7.3)", () => {
    test("notValidated: ZERO binder diagnostics; T1 unchanged; suppression counted", async () => {
        const result = await diagnose(T1_PLUS_BINDER, "notValidated");
        // T1 (structural certainty) still present…
        expect(codes(result)).to.include("mssql(102)");
        // …but no metadata-backed claim of any kind.
        for (const code of ["mssql(207)", "mssql(208)", "mssql(209)"]) {
            expect(codes(result), `unexpected binder claim ${code}`).to.not.include(code);
        }
        expect(result.diagnostics).to.have.length(1);
        expect(result.suppressed?.metadataNotValidated ?? 0).to.be.at.least(1);
    });

    test("validated: binder diagnostics appear exactly as today", async () => {
        const result = await diagnose(T1_PLUS_BINDER, "validated");
        expect(codes(result)).to.include("mssql(102)");
        expect(codes(result)).to.include("mssql(207)");
        expect(result.suppressed?.metadataNotValidated).to.equal(undefined);
    });

    test("absent verdict defaults to validated (hosts without a lease change nothing)", async () => {
        const result = await diagnose(T1_PLUS_BINDER);
        expect(codes(result)).to.include("mssql(207)");
        expect(result.suppressed?.metadataNotValidated).to.equal(undefined);
    });

    test("suppression is counted PER binder-eligible statement", async () => {
        const result = await diagnose(
            "SELECT Missing FROM Sales.Orders\nSELECT Nope FROM Sales.Customers",
            "notValidated",
        );
        expect(result.diagnostics).to.have.length(0);
        expect(result.suppressed?.metadataNotValidated).to.equal(2);
    });

    test("statements without binder claims keep their own reasons (no double count)", async () => {
        const result = await diagnose("EXEC('SELECT * FROM NotReal')", "notValidated");
        expect(result.diagnostics).to.have.length(0);
        expect(result.suppressed?.dynamicSql ?? 0).to.be.at.least(1);
        expect(result.suppressed?.metadataNotValidated).to.equal(undefined);
    });

    test("memo distinguishes verdicts for the same version+generation", async () => {
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
        // Same verdict again = memo hit (identical object).
        const again = await engine.diagnostics({
            text: T1_PLUS_BINDER,
            version: 3,
            metadataFreshness: "validated",
        });
        expect(again).to.equal(validated);
    });
});

// ---------------------------------------------------------------------------
// Scheduler drift cancel (metadataStale producer)
// ---------------------------------------------------------------------------

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

interface StaleCancelRecord {
    started: DiagnosticsSnapshot;
    current: DiagnosticsSnapshot | undefined;
}

suite("sqlLanguage diagnostics scheduler drift cancel (CACHE-5)", () => {
    test("generation change mid-pass: abort is reported as drift; restart publishes", async () => {
        let generation = 1;
        const passes: ScriptedPass[] = [];
        const published: number[] = [];
        const cancels: StaleCancelRecord[] = [];
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "SELECT 1", version: 1, stamp: `1:${generation}` }),
            createPass: () => {
                const pass = scriptedPass(10);
                passes.push(pass);
                return pass;
            },
            publish: (_result, version) => published.push(version),
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (passes.length === 1 && passes[0].stepCount() === 2) {
                    generation = 2; // drift trigger fires mid-pass
                }
            },
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });
        await scheduler.runNow();
        expect(passes[0].aborted()).to.equal(true);
        expect(published).to.deep.equal([]);
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(true);
        // The restart (host reschedule path) publishes against the new stamp.
        await scheduler.runNow();
        expect(published).to.deep.equal([1]);
        expect(passes[1].aborted()).to.equal(false);
        scheduler.dispose();
    });

    test("edit mid-pass is a stale cancel but NOT drift (version moved)", async () => {
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
                if (passes.length === 1 && passes[0].stepCount() === 2) {
                    version = 2; // edit arrives mid-pass
                }
            },
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });
        await scheduler.runNow();
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(false);
        scheduler.dispose();
    });

    test("cancel() with an unchanged stamp is NOT drift", async () => {
        const cancels: StaleCancelRecord[] = [];
        const pass = scriptedPass(10);
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: "1:1" }),
            createPass: () => pass,
            publish: () => undefined,
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (pass.stepCount() === 2) {
                    scheduler.cancel();
                }
            },
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });
        await scheduler.runNow();
        expect(pass.aborted()).to.equal(true);
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(false);
        scheduler.dispose();
    });

    test("dispose mid-pass never reports a stale cancel", async () => {
        const cancels: StaleCancelRecord[] = [];
        const pass = scriptedPass(10);
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp: "1:1" }),
            createPass: () => pass,
            publish: () => undefined,
            sliceBudgetMs: 0,
            yieldSlice: async () => {
                if (pass.stepCount() === 2) {
                    scheduler.dispose();
                }
            },
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });
        await scheduler.runNow();
        expect(pass.aborted()).to.equal(true);
        expect(cancels).to.have.length(0);
    });

    test("async pass factory: staleness re-checked after the await (no work on stale text)", async () => {
        let stamp = "1:1";
        const cancels: StaleCancelRecord[] = [];
        const published: number[] = [];
        const pass = scriptedPass(3);
        const scheduler = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp }),
            createPass: async () => {
                stamp = "1:2"; // generation moves WHILE the verdict resolves
                return pass;
            },
            publish: (_result, version) => published.push(version),
            onStaleCancel: (started, current) => cancels.push({ started, current }),
        });
        await scheduler.runNow();
        expect(pass.stepCount()).to.equal(0); // aborted before any work
        expect(pass.aborted()).to.equal(true);
        expect(published).to.deep.equal([]);
        expect(cancels).to.have.length(1);
        expect(isMetadataDriftCancel(cancels[0].started, cancels[0].current)).to.equal(true);
        // A later run against the settled stamp publishes normally.
        const pass2 = scriptedPass(2);
        const scheduler2 = new SlicedDiagnosticsScheduler({
            snapshot: () => ({ text: "x", version: 1, stamp }),
            createPass: async () => pass2,
            publish: (_result, version) => published.push(version),
        });
        await scheduler2.runNow();
        expect(published).to.deep.equal([1]);
        scheduler.dispose();
        scheduler2.dispose();
    });
});

// ---------------------------------------------------------------------------
// Host publisher: ensureFresh(diagnosticsBinder) is the verdict source
// ---------------------------------------------------------------------------

function stubConfiguration(sandbox: sinon.SinonSandbox, overrides: Record<string, unknown>): void {
    sandbox.stub(vscode.workspace, "getConfiguration").callsFake(
        () =>
            ({
                get: <T>(key: string, defaultValue?: T): T | undefined =>
                    key in overrides ? (overrides[key] as T) : defaultValue,
            }) as vscode.WorkspaceConfiguration,
    );
}

function tick(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSqlDocument(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: "sql", content });
}

function makeFreshResult(
    freshness: FreshCatalogResult["freshness"],
    generation = 1,
): FreshCatalogResult {
    return { snapshot: undefined, generation, source: "memory", freshness, waitedMs: 0 };
}

/**
 * Minimal document→lease binding double: exposes exactly the surface the
 * facade consumes (connectionState, onDidChange, metadataHandleForConsumers
 * with status/current/ensureFresh). Recorded policies prove the preset.
 */
function fakeLeaseBinding(options?: { generation?: () => number }): {
    binding: DocumentSessionBinding;
    policies: MetadataFreshnessPolicy[];
    setEnsureFresh: (
        impl: (policy: MetadataFreshnessPolicy) => Promise<FreshCatalogResult>,
    ) => void;
    fireChange: () => void;
} {
    const listeners = new Set<() => void>();
    const policies: MetadataFreshnessPolicy[] = [];
    let impl: (policy: MetadataFreshnessPolicy) => Promise<FreshCatalogResult> = () =>
        Promise.resolve(makeFreshResult("validated"));
    const lease = {
        status: () => ({ generation: options?.generation?.() ?? 1 }),
        current: () => undefined,
        ensureFresh: (policy: MetadataFreshnessPolicy): Promise<FreshCatalogResult> => {
            policies.push(policy);
            return impl(policy);
        },
    };
    const binding = {
        connectionState: { database: "FixtureDb" },
        onDidChange: (listener: () => void) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
        metadataHandleForConsumers: lease,
    };
    return {
        binding: binding as unknown as DocumentSessionBinding,
        policies,
        setEnsureFresh: (next): void => {
            impl = next;
        },
        fireChange: (): void => {
            for (const listener of [...listeners]) {
                listener();
            }
        },
    };
}

suite("queryStudio diagnostics freshness publish path (CACHE-5)", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        sandbox.restore();
    });

    function serviceFor(
        document: vscode.TextDocument,
        binding: DocumentSessionBinding,
    ): QueryStudioLanguageService {
        return new QueryStudioLanguageService({
            backingDocument: () => document,
            sessionBinding: () => binding,
            databases: () => undefined,
        });
    }

    test("the publisher calls ensureFresh with the diagnosticsBinder preset", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT 1");
        const harness = fakeLeaseBinding();
        const service = serviceFor(document, harness.binding);
        try {
            await service.diagnostics();
            expect(harness.policies).to.have.length(1);
            const policy = harness.policies[0];
            expect(policy).to.equal(MetadataPolicies.diagnosticsBinder);
            expect(policy.mode).to.equal("requireValidated");
            expect(policy.reason).to.equal("diagnostics");
            expect(policy.timeoutMs).to.equal(250);
            expect(policy.sections).to.deep.equal(["objects", "columns"]);
        } finally {
            service.dispose();
        }
    });

    test("stale/unavailable verdict suppresses binder claims (metadataNotValidated counted)", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT (1 + 2))\nSELECT x FROM T");
        const harness = fakeLeaseBinding();
        harness.setEnsureFresh(() => Promise.resolve(makeFreshResult("stale")));
        const service = serviceFor(document, harness.binding);
        try {
            const result = await service.diagnostics();
            expect(result).to.not.equal(undefined);
            // T1 survives; no binder warnings.
            expect(result!.diagnostics.map((d) => d.code)).to.deep.equal(["mssql(102)"]);
            expect(result!.suppressed?.metadataNotValidated ?? 0).to.be.at.least(1);
        } finally {
            service.dispose();
        }
    });

    test("validated verdict never trips the freshness gate", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT x FROM T");
        const harness = fakeLeaseBinding();
        harness.setEnsureFresh(() => Promise.resolve(makeFreshResult("validated")));
        const service = serviceFor(document, harness.binding);
        try {
            const result = await service.diagnostics();
            expect(result!.suppressed?.metadataNotValidated).to.equal(undefined);
            // Honesty stays with the readiness ladder (no snapshot bound here).
            expect(result!.suppressed?.providerNotReady ?? 0).to.be.at.least(1);
        } finally {
            service.dispose();
        }
    });

    test("a lease that never settles cannot block: T1-only within a bounded time", async function () {
        this.timeout(10000);
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT (1 + 2))\nSELECT x FROM T");
        const harness = fakeLeaseBinding();
        harness.setEnsureFresh(() => new Promise<FreshCatalogResult>(() => undefined)); // never
        const service = serviceFor(document, harness.binding);
        try {
            const startedAt = Date.now();
            const result = await service.diagnostics();
            const elapsed = Date.now() - startedAt;
            expect(elapsed, "publisher must not block past the wait budget").to.be.below(5000);
            expect(result!.diagnostics.map((d) => d.code)).to.deep.equal(["mssql(102)"]);
            expect(result!.suppressed?.metadataNotValidated ?? 0).to.be.at.least(1);
        } finally {
            service.dispose();
        }
    });

    test("ensureFresh rejection is a notValidated verdict, never an error", async () => {
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT x FROM T");
        const harness = fakeLeaseBinding();
        harness.setEnsureFresh(() => Promise.reject(new Error("validation lane failed")));
        const service = serviceFor(document, harness.binding);
        try {
            const result = await service.diagnostics();
            expect(result!.suppressed?.metadataNotValidated ?? 0).to.be.at.least(1);
        } finally {
            service.dispose();
        }
    });

    test("drift mid-flight: pass restarts and metadataStale is counted in status", async function () {
        this.timeout(15000);
        stubConfiguration(sandbox, {
            "mssql.queryStudio.languageService.engine": "nativeTypeScript",
        });
        const document = await openSqlDocument("SELECT 1");
        let generation = 1;
        let calls = 0;
        const harness = fakeLeaseBinding({ generation: () => generation });
        harness.setEnsureFresh(() => {
            calls++;
            if (calls === 1) {
                // Drift trigger lands while the pass is in flight: the
                // generation moves and the provider-change listener fires
                // (the pre-existing restart path).
                generation = 2;
                harness.fireChange();
            }
            return Promise.resolve(makeFreshResult("validated", generation));
        });
        const service = serviceFor(document, harness.binding);
        try {
            harness.fireChange(); // kick the debounced native pass
            let status = service.status();
            for (
                let i = 0;
                i < 100 && (status.diagnostics.suppressionCounts.metadataStale ?? 0) === 0;
                i++
            ) {
                await tick(100);
                status = service.status();
            }
            expect(status.diagnostics.suppressionCounts.metadataStale ?? 0).to.be.at.least(1);
            // The restart published against the moved generation.
            expect(status.diagnostics.lastPassVersion).to.equal(document.version);
            expect(calls).to.be.at.least(2);
        } finally {
            service.dispose();
        }
    });
});
