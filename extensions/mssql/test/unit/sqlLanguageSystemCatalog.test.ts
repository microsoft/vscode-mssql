/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Static system-object catalog suite: the data helpers, the pinned-view
 * fallback precedence (live metadata always wins; system schemas only), and
 * the diagnostics contract — catalog-resolved objects are clean, everything
 * under sys NOT in the catalog stays suppressed (the catalog is not
 * exhaustive), and column absence is never claimed against curated subsets.
 */

import { expect } from "chai";
import { DiagnosticsResult } from "../../src/sqlLanguage/api";
import {
    findSystemObject,
    isSystemSchemaName,
    systemObjectsInSchema,
} from "../../src/sqlLanguage/data/systemObjectCatalog";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import { withSystemObjectCatalog } from "../../src/sqlLanguage/provider/systemCatalogView";
import { ISqlLanguageMetadataProvider } from "../../src/sqlLanguage/provider/types";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);

/** Standard catalog with a LIVE sys.databases (live-wins precedence). */
const liveSysProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    objects: [
        ...STANDARD_FIXTURE_CATALOG.objects,
        {
            schema: "sys",
            name: "databases",
            kind: "view" as const,
            columns: [{ name: "LiveCol", typeDisplay: "int", nullable: false }],
        },
    ],
});

/** Standard catalog on an Azure SQL DB engine edition (broad DMV scope). */
const azureEditionProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    env: { ...STANDARD_FIXTURE_CATALOG.env, engineEdition: 5 },
});

async function diagnose(
    text: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<DiagnosticsResult> {
    const engine = new NativeSqlLanguageEngine(provider);
    const result = await engine.diagnostics({ text, version: 1 });
    expect(result).to.not.equal(undefined);
    return result!;
}

function expectClean(result: DiagnosticsResult): void {
    expect(
        result.diagnostics,
        `unexpected diagnostics: ${result.diagnostics.map((d) => `${d.code ?? "?"} ${d.message}`).join(" | ")}`,
    ).to.have.length(0);
}

suite("sqlLanguage system catalog: data helpers", () => {
    test("system schema names match case-insensitively", () => {
        expect(isSystemSchemaName("sys")).to.equal(true);
        expect(isSystemSchemaName("SYS")).to.equal(true);
        expect(isSystemSchemaName("information_schema")).to.equal(true);
        expect(isSystemSchemaName("Sales")).to.equal(false);
        expect(isSystemSchemaName("dbo")).to.equal(false);
    });

    test("finds catalog objects with curated columns, case-insensitively", () => {
        const databases = findSystemObject("SyS", "DaTaBaSeS", undefined);
        expect(databases).to.not.equal(undefined);
        expect(databases!.objectId).to.be.lessThan(0); // never a live id
        expect(databases!.columns).to.include.members(["name", "database_id", "state_desc"]);
    });

    test("never answers user schemas or unknown system names", () => {
        expect(findSystemObject("Sales", "Orders", undefined)).to.equal(undefined);
        expect(findSystemObject("dbo", "databases", undefined)).to.equal(undefined);
        expect(findSystemObject("sys", "databasez", undefined)).to.equal(undefined);
    });

    test("engine edition gates DMV visibility", () => {
        // scope=broad requires a known broad-surface edition.
        expect(findSystemObject("sys", "dm_exec_requests", undefined)).to.equal(undefined);
        expect(findSystemObject("sys", "dm_exec_requests", 5)).to.not.equal(undefined);
        expect(findSystemObject("sys", "dm_exec_cached_plans", 5)?.columns).to.include.members([
            "plan_handle",
            "cacheobjtype",
            "usecounts",
        ]);
        // scope=full excludes Azure SQL DB (edition 5).
        expect(findSystemObject("sys", "dm_os_wait_stats", 5)).to.equal(undefined);
        expect(findSystemObject("sys", "dm_os_wait_stats", 2)).to.not.equal(undefined);
        // scope=all is always present.
        expect(findSystemObject("sys", "databases", undefined)).to.not.equal(undefined);
        expect(
            systemObjectsInSchema("INFORMATION_SCHEMA", undefined).map((o) => o.name),
        ).to.include.members(["TABLES", "COLUMNS"]);
    });
});

suite("sqlLanguage system catalog: pinned-view fallback precedence", () => {
    test("catalog fallback resolves schema-qualified system names", () => {
        const view = withSystemObjectCatalog(standardProvider.pin());
        const resolution = view.resolveObject(["sys", "databases"]);
        expect(resolution.kind).to.equal("resolved");
        if (resolution.kind === "resolved") {
            expect(resolution.ref.objectId).to.be.lessThan(0);
            const info = view.getObject(resolution.ref);
            expect(info?.schema).to.equal("sys");
            expect(info?.name).to.equal("databases");
            expect(info?.kind).to.equal("view");
            const columns = view.getColumns(resolution.ref);
            expect(columns?.map((c) => c.name)).to.include.members(["name", "database_id"]);
            // No type/nullability facts exist in the curated data.
            expect(columns?.every((c) => c.typeDisplay === undefined)).to.equal(true);
        }
    });

    test("live metadata always wins over the catalog", () => {
        const view = withSystemObjectCatalog(liveSysProvider.pin());
        const resolution = view.resolveObject(["sys", "databases"]);
        expect(resolution.kind).to.equal("resolved");
        if (resolution.kind === "resolved") {
            expect(resolution.ref.objectId).to.be.greaterThan(0); // the live ref
            const columns = view.getColumns(resolution.ref);
            expect(columns?.map((c) => c.name)).to.deep.equal(["LiveCol"]);
        }
    });

    test("user schemas and bare names are never served", () => {
        const view = withSystemObjectCatalog(standardProvider.pin());
        expect(view.resolveObject(["dbo", "databases"]).kind).to.equal("notFound");
        expect(view.resolveObject(["databases"]).kind).to.equal("notFound");
        // Unqualified searches stay live-only (no sys flooding).
        const unqualified = view.searchObjects({});
        expect(unqualified.some((o) => o.name === "databases")).to.equal(false);
    });

    test("system schemas appear in listSchemas exactly once", () => {
        const view = withSystemObjectCatalog(standardProvider.pin());
        const names = view.listSchemas().map((s) => s.name.toLowerCase());
        expect(names).to.include.members(["sys", "information_schema"]);
        expect(names.filter((n) => n === "sys")).to.have.length(1);
    });
});

suite("sqlLanguage system catalog: diagnostics", () => {
    test("catalog-resolved sys object is clean (no 208)", async () => {
        const result = await diagnose("SELECT name FROM sys.databases");
        expectClean(result);
    });

    test("catalog-resolved INFORMATION_SCHEMA view is clean", async () => {
        expectClean(await diagnose("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES AS t"));
    });

    test("unknown sys object stays suppressed — the catalog is not exhaustive", async () => {
        const result = await diagnose("SELECT x FROM sys.databasez");
        expectClean(result);
        expect(result.suppressed?.systemObject ?? 0).to.be.at.least(1);
    });

    test("column misses against curated subsets never claim 207", async () => {
        const result = await diagnose("SELECT d.namez FROM sys.databases d");
        expectClean(result);
        expect(result.suppressed?.systemObject ?? 0).to.be.at.least(1);
    });

    test("user schema is never shadowed: dbo.databases still warns 208", async () => {
        const result = await diagnose("SELECT * FROM dbo.databases");
        expect(result.diagnostics).to.have.length(1);
        expect(result.diagnostics[0].code).to.equal("mssql(208)");
    });

    test("edition-gated DMVs resolve under a matching edition, suppress otherwise", async () => {
        const gated = await diagnose("SELECT session_id FROM sys.dm_exec_requests");
        expectClean(gated);
        expect(gated.suppressed?.systemObject ?? 0).to.be.at.least(1);
        expectClean(
            await diagnose("SELECT session_id FROM sys.dm_exec_requests", azureEditionProvider),
        );
    });

    test("live sys object still suppresses column checks (system schema rule)", async () => {
        const result = await diagnose("SELECT d.NotLiveCol FROM sys.databases d", liveSysProvider);
        expectClean(result);
        expect(result.suppressed?.systemObject ?? 0).to.be.at.least(1);
    });
});
