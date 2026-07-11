/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-9: the Index workspace state machine + generated-only script builders.
 *
 * The matrix mirrors the VERIFIED provider surface (evidence/
 * vector-provider-matrix.md) rather than the guide's assumptions:
 * - RTM shape: no health DMV, no $.Version key → healthyCurrent with an
 *   honest version-absent-is-current property, NO migration script, and a
 *   "current catalog snapshot only" health finding — never an invented
 *   staleness.
 * - Azure shape: DMV present with the RESOLVED column names
 *   (graph_catchup_pending_percent / last_background_task_execution_time),
 *   Version 3 → healthyCurrent with the staleness property labeled by the
 *   resolved name.
 * - Phantom sys.vector_indexes residue → noIndex + explanatory finding.
 * - PREVIEW_FEATURES OFF + no index → noIndex + enablement script.
 * - Permission-degraded catalog → "Health unavailable" and NEVER the word
 *   "Healthy" anywhere in the emitted strings.
 * - Simulated $.Version = 2 → legacyFormat + migration script whose
 *   service-impact comment block is asserted verbatim.
 *
 * Scripts-never-execute is STRUCTURAL: the service's only collaborator is a
 * capability thunk (type-level assertion below), and the compiled module is
 * scanned for the absence of any sqlDataPlane require — there is nothing in
 * this service capable of executing SQL.
 */

import { expect } from "chai";
import * as fs from "fs";
import {
    VectorCapabilityProbe,
    VectorHealthDmvProbe,
    VectorIndexProbeRow,
    VectorProbeEvidence,
} from "../../src/sharedInterfaces/vectorCatalog";
import { VectorIndexWorkspaceView } from "../../src/sharedInterfaces/vectorIndex";
import {
    buildCreateVectorIndexScript,
    buildEnablePreviewScript,
    buildHealthSnapshotScript,
    buildMigrationScript,
    buildSupportingIndexScript,
    deriveIndexName,
    deriveVectorIndexView,
    MIGRATION_SERVICE_IMPACT_COMMENT,
    SCRIPT_REVIEW_HEADER,
    VectorCapabilityThunk,
    VectorIndexService,
    VectorIndexTargetFacts,
} from "../../src/queryResults/vector/vectorIndexService";

// ---------------------------------------------------------------------------
// Fixtures (shapes copied from the verified matrix, 2026-07-11)
// ---------------------------------------------------------------------------

const stamp = (): VectorProbeEvidence => ({ source: "catalog", capturedEpochMs: 0 });

function makeProbe(overrides: Partial<VectorCapabilityProbe> = {}): VectorCapabilityProbe {
    return {
        evidence: { source: "diagnosticQuery", capturedEpochMs: 0 },
        engine: {
            evidence: stamp(),
            productVersion: "17.0.1000.7",
            edition: "Enterprise Edition",
            engineEditionId: 3,
            database: "VectorLab",
            compatibilityLevel: 170,
        },
        previewFeatures: { evidence: stamp(), present: true, enabled: true },
        allowStaleVectorIndex: { evidence: stamp(), present: false },
        vectorType: { evidence: stamp(), usable: true },
        columnMetadata: {
            evidence: stamp(),
            vectorDimensionsPresent: true,
            columns: ["vector_dimensions"],
        },
        indexes: { evidence: stamp(), available: true, indexes: [], phantomCount: 0 },
        healthDmv: { evidence: stamp(), present: false, columns: [] },
        externalModels: { evidence: stamp(), available: true, models: [] },
        serverConfig: { evidence: stamp(), externalRestEndpointEnabled: false },
        vectorSearchTvf: { evidence: stamp(), status: "accepted", target: "dbo.DocumentChunks" },
        topNWithApproximate: { evidence: stamp(), status: "rejected" },
        ...overrides,
    };
}

/** RTM-built DiskANN index: build_parameters carries NO $.Version key. */
const RTM_INDEX: VectorIndexProbeRow = {
    schemaName: "dbo",
    tableName: "DocumentChunks",
    indexName: "vec_DocumentChunks_embedding",
    indexType: "DiskANN",
    distanceMetric: "COSINE",
    buildParameters: '{"StartId":"0","L":"48","M":"48","R":"48"}',
};

/** Azure-built index: $.Version = 3 (and no M key — verified). */
const AZURE_INDEX: VectorIndexProbeRow = {
    ...RTM_INDEX,
    buildParameters: '{"StartId":"0","L":"48","R":"48","Version":"3"}',
    version: 3,
};

/** Azure health DMV with the RESOLVED (live) column names. */
const AZURE_HEALTH_DMV: VectorHealthDmvProbe = {
    evidence: stamp(),
    present: true,
    columns: [
        "object_id",
        "index_id",
        "graph_catchup_pending_percent",
        "last_background_task_execution_time",
    ],
    stalenessColumn: "graph_catchup_pending_percent",
    lastTaskColumn: "last_background_task_execution_time",
    rows: [
        {
            object_id: "581577110",
            index_id: "2",
            graph_catchup_pending_percent: "7.2",
            last_background_task_execution_time: "2026-07-11 09:00:00",
        },
    ],
};

const TARGET: VectorIndexTargetFacts = {
    schema: "dbo",
    table: "DocumentChunks",
    vectorColumn: "embedding",
    metric: "cosine",
};

const rtmProbe = (indexes: readonly VectorIndexProbeRow[] = [RTM_INDEX]) =>
    makeProbe({
        indexes: { evidence: stamp(), available: true, indexes, phantomCount: 0 },
    });

const azureProbe = (indexes: readonly VectorIndexProbeRow[] = [AZURE_INDEX]) =>
    makeProbe({
        engine: {
            evidence: stamp(),
            productVersion: "12.0.2000.8",
            edition: "SQL Azure",
            engineEditionId: 5,
            database: "ninjadb",
            compatibilityLevel: 170,
        },
        allowStaleVectorIndex: { evidence: stamp(), present: true, enabled: false },
        indexes: { evidence: stamp(), available: true, indexes, phantomCount: 0 },
        healthDmv: AZURE_HEALTH_DMV,
    });

const allStrings = (view: VectorIndexWorkspaceView): string =>
    [
        ...view.properties.map((p) => `${p.label} ${p.value}`),
        ...view.findings.map((f) => `${f.title} ${f.detail}`),
        ...view.scripts.map((s) => `${s.title} ${s.sql}`),
    ].join("\n");

// ---------------------------------------------------------------------------
// State machine matrix
// ---------------------------------------------------------------------------

suite("vectorIndexService state machine", () => {
    test("RTM shape: version-absent index is healthyCurrent, never legacy, no migration", () => {
        const view = deriveVectorIndexView(rtmProbe(), TARGET);
        expect(view.state).to.equal("healthyCurrent");

        const version = view.properties.find((p) => p.label === "Version");
        expect(version, "Version property").to.not.equal(undefined);
        expect(version!.value).to.match(/absent/i);
        expect(version!.value).to.match(/current format/i);
        expect(version!.source).to.equal("catalog");

        // Migration is HIDDEN in the healthy-current state (P0-3).
        expect(view.scripts.some((s) => s.id === "migration")).to.equal(false);

        // The word "legacy" appears NOWHERE for an RTM current-format index.
        expect(allStrings(view)).to.not.match(/legacy/i);

        // Success finding states the format honestly.
        expect(
            view.findings.some(
                (f) => f.severity === "success" && /format is current/i.test(f.title),
            ),
        ).to.equal(true);
    });

    test("RTM shape: DMV absent → 'current catalog snapshot only', NEVER an invented staleness", () => {
        const view = deriveVectorIndexView(rtmProbe(), TARGET);

        // No staleness-like property may exist — there is no DMV to read.
        expect(view.properties.some((p) => /staleness|catchup|pending/i.test(p.label))).to.equal(
            false,
        );

        expect(view.findings.some((f) => /current catalog snapshot only/i.test(f.title))).to.equal(
            true,
        );

        const dmvProp = view.properties.find((p) => p.label === "Health DMV");
        expect(dmvProp!.value).to.match(/absent/i);
    });

    test("Azure shape: Version 3 + staleness property named by the RESOLVED DMV column", () => {
        const view = deriveVectorIndexView(azureProbe(), TARGET);
        expect(view.state).to.equal("healthyCurrent");

        const version = view.properties.find((p) => p.label === "Version");
        expect(version!.value).to.match(/^v3 /);
        expect(version!.value).to.match(/current format/i);

        // The staleness fact is labeled with the LIVE column name — never the
        // guide's assumed approximate_staleness_percent.
        const staleness = view.properties.find((p) => p.label === "graph_catchup_pending_percent");
        expect(staleness, "resolved staleness property").to.not.equal(undefined);
        expect(staleness!.value).to.equal("7.2");
        expect(staleness!.source).to.equal("healthDmv");
        expect(allStrings(view)).to.not.include("approximate_staleness_percent");

        const lastTask = view.properties.find(
            (p) => p.label === "last_background_task_execution_time",
        );
        expect(lastTask!.value).to.equal("2026-07-11 09:00:00");

        // Staleness bands are attributed to documentation, never a threshold.
        const bands = view.findings.find((f) =>
            f.title.startsWith("graph_catchup_pending_percent"),
        );
        expect(bands!.detail).to.match(/attributed to docs/i);
        expect(bands!.detail).to.match(/no universal rebuild threshold/i);

        expect(view.scripts.some((s) => s.id === "migration")).to.equal(false);
    });

    test("phantom sys.vector_indexes row → noIndex + transient-phantom finding", () => {
        const probe = makeProbe({
            indexes: { evidence: stamp(), available: true, indexes: [], phantomCount: 1 },
        });
        const view = deriveVectorIndexView(probe, TARGET);
        expect(view.state).to.equal("noIndex");

        const phantom = view.findings.find((f) => /phantom/i.test(f.title));
        expect(phantom, "phantom finding").to.not.equal(undefined);
        expect(phantom!.severity).to.equal("warning");
        expect(phantom!.detail).to.match(/self-cleans/i);
        expect(phantom!.detail).to.match(/failed/i);

        // Create script is still offered for review (target facts known).
        expect(view.scripts.some((s) => s.id === "createIndex")).to.equal(true);
    });

    test("preview OFF + no index → noIndex with the PREVIEW_FEATURES enablement script", () => {
        const probe = makeProbe({
            previewFeatures: { evidence: stamp(), present: true, enabled: false },
        });
        const view = deriveVectorIndexView(probe, TARGET);
        expect(view.state).to.equal("noIndex");

        const preview = view.scripts.find((s) => s.id === "enablePreview");
        expect(preview, "enablePreview script").to.not.equal(undefined);
        expect(preview!.sql).to.include(
            "ALTER DATABASE SCOPED CONFIGURATION SET PREVIEW_FEATURES = ON;",
        );
        // Explanation comment: database-scoped scope of effect.
        expect(preview!.sql).to.match(/DATABASE-SCOPED configuration/i);

        expect(view.findings.some((f) => /PREVIEW_FEATURES is OFF/.test(f.title))).to.equal(true);
    });

    test("permission-degraded probe → 'Health unavailable', and NEVER the word Healthy", () => {
        const probe = makeProbe({
            indexes: {
                evidence: stamp(),
                available: false,
                indexes: [],
                phantomCount: 0,
                error: "VIEW DATABASE STATE permission was denied on database 'ninjadb'.",
            },
        });
        const view = deriveVectorIndexView(probe, TARGET);
        expect(view.state).to.equal("permissionDegraded");

        expect(view.findings.some((f) => f.title === "Health unavailable")).to.equal(true);
        const health = view.properties.find((p) => p.label === "Health");
        expect(health!.value).to.equal("unavailable");

        // The one non-negotiable word: nothing may read as "Healthy".
        expect(allStrings(view)).to.not.match(/healthy/i);

        // Only the (review-only) health snapshot query is offered.
        expect(view.scripts.map((s) => s.id)).to.deep.equal(["healthSnapshot"]);
    });

    test("simulated $.Version = 2 → legacyFormat + migration script with service-impact block", () => {
        const legacyIndex: VectorIndexProbeRow = {
            ...RTM_INDEX,
            buildParameters: '{"StartId":"0","L":"48","R":"48","Version":"2"}',
            version: 2,
        };
        const view = deriveVectorIndexView(azureProbe([legacyIndex]), TARGET);
        expect(view.state).to.equal("legacyFormat");

        const migration = view.scripts.find((s) => s.id === "migration");
        expect(migration, "migration script").to.not.equal(undefined);
        // The service-impact comment block is REQUIRED verbatim at the top.
        expect(migration!.sql).to.include(MIGRATION_SERVICE_IMPACT_COMMENT);
        expect(migration!.sql).to.include("SERVICE IMPACT");
        expect(migration!.sql).to.match(/disables approximate \(ANN\) search/);
        expect(migration!.sql).to.include("Plan a maintenance window.");
        expect(migration!.sql).to.include(
            "DROP INDEX [vec_DocumentChunks_embedding] ON [dbo].[DocumentChunks];",
        );
        expect(migration!.sql).to.include("CREATE VECTOR INDEX [vec_DocumentChunks_embedding]");
        expect(migration!.sql).to.include("METRIC = 'cosine'");

        // The warning leads the findings so the view renders it ABOVE the
        // script (P0-3).
        expect(view.findings[0].severity).to.equal("warning");
        expect(view.findings[0].title).to.equal("Migration drops and recreates the index");

        // Version property is honest about the earlier format.
        const version = view.properties.find((p) => p.label === "Version");
        expect(version!.value).to.match(/^v2 /);
        expect(version!.value).to.match(/earlier format/i);
    });

    test("host-observed Msg 42234 build failure → buildFailedTier with tier finding", () => {
        const view = deriveVectorIndexView(makeProbe(), {
            ...TARGET,
            recentCreateError: {
                number: 42234,
                text: "DiskANN vector index build failed with an internal error 200.",
            },
        });
        expect(view.state).to.equal("buildFailedTier");

        const finding = view.findings.find((f) => f.severity === "error");
        expect(finding!.title).to.match(/42234/);
        expect(finding!.detail).to.match(/tier/i);
        expect(
            view.properties.some(
                (p) => p.label === "Last CREATE attempt" && /internal error 200/.test(p.value),
            ),
        ).to.equal(true);
        // Create script remains available for review after a tier change.
        expect(view.scripts.some((s) => s.id === "createIndex")).to.equal(true);
    });

    test("no target, no discovery hit, no rows → noVectorColumns with no scripts", () => {
        const probe = makeProbe({
            vectorSearchTvf: { evidence: stamp(), status: "accepted" }, // no target
        });
        const view = deriveVectorIndexView(probe);
        expect(view.state).to.equal("noVectorColumns");
        expect(view.scripts).to.have.length(0);
        expect(view.findings.some((f) => /no vector columns/i.test(f.title))).to.equal(true);
    });

    test("metric mismatch between search target and index is a warning, never silent", () => {
        const view = deriveVectorIndexView(azureProbe(), { ...TARGET, metric: "euclidean" });
        const mismatch = view.findings.find((f) => /metric mismatch/i.test(f.title));
        expect(mismatch!.severity).to.equal("warning");
        expect(mismatch!.detail).to.match(/exact VECTOR_DISTANCE remains available/i);
    });

    test("filter columns produce the review-suggestion finding + supporting-index script", () => {
        const view = deriveVectorIndexView(azureProbe(), {
            ...TARGET,
            filterColumns: ["category"],
        });
        expect(
            view.findings.some(
                (f) => f.title === 'Filter column "category" observed in search filters',
            ),
        ).to.equal(true);
        const supporting = view.scripts.find((s) => s.id === "supportingIndex");
        expect(supporting!.sql).to.include("REVIEW SUGGESTION, NOT A COMMAND");
        expect(supporting!.sql).to.include("CREATE INDEX [ix_DocumentChunks_category]");
    });
});

// ---------------------------------------------------------------------------
// Script builders: escaping + honesty text
// ---------------------------------------------------------------------------

suite("vectorIndexService script builders", () => {
    test("create script: QUOTED_IDENTIFIER note, options comment, QUOTENAME escaping of ]-names", () => {
        const sql = buildCreateVectorIndexScript({
            schema: "we]ird",
            table: "Ta]ble",
            vectorColumn: "emb]edding",
        });
        expect(sql).to.include("SET QUOTED_IDENTIFIER ON;");
        expect(sql).to.match(/QUOTED_IDENTIFIER ON \(error 1934/);
        expect(sql).to.match(/METRIC = 'cosine' \| 'euclidean' \| 'dot'/);
        expect(sql).to.include("ON [we]]ird].[Ta]]ble]([emb]]edding])");
        expect(sql).to.include(`CREATE VECTOR INDEX [${"vec_Ta]]ble_emb]]edding"}]`);
        expect(sql).to.include("WITH (METRIC = 'cosine', TYPE = 'diskann');");
    });

    test("migration script escapes every identifier, including ]-names", () => {
        const sql = buildMigrationScript({
            schema: "s]1",
            table: "t]2",
            indexName: "vec_t]2_v",
            vectorColumn: "v]col",
            metric: "EUCLIDEAN",
        });
        expect(sql).to.include("DROP INDEX [vec_t]]2_v] ON [s]]1].[t]]2];");
        expect(sql).to.include("ON [s]]1].[t]]2]([v]]col])");
        expect(sql).to.include("METRIC = 'euclidean'");
        expect(sql).to.include(MIGRATION_SERVICE_IMPACT_COMMENT);
    });

    test("supporting-index script escapes ]-names and stays review-only", () => {
        const sql = buildSupportingIndexScript({
            schema: "dbo",
            table: "Ta]ble",
            filterColumns: ["cat]egory"],
        });
        expect(sql).to.include("[ix_Ta]]ble_cat]]egory]");
        expect(sql).to.include("ON [dbo].[Ta]]ble]([cat]]egory]);");
        expect(sql).to.include("REVIEW SUGGESTION, NOT A COMMAND");
    });

    test("health snapshot uses RESOLVED DMV column names — never the guide's", () => {
        const sql = buildHealthSnapshotScript(AZURE_HEALTH_DMV);
        expect(sql).to.include("[graph_catchup_pending_percent]");
        expect(sql).to.include("[last_background_task_execution_time]");
        expect(sql).to.include("FROM sys.dm_db_vector_indexes;");
        expect(sql).to.not.include("approximate_staleness_percent");
    });

    test("health snapshot on RTM emits the sys.vector_indexes-only variant with the phantom gate", () => {
        const sql = buildHealthSnapshotScript({ evidence: stamp(), present: false, columns: [] });
        expect(sql).to.include("FROM sys.vector_indexes AS v");
        expect(sql).to.not.include("FROM sys.dm_db_vector_indexes");
        expect(sql).to.match(/phantom \(failed-build residue\)/);
        expect(sql).to.include("LEFT JOIN sys.indexes AS i");
    });

    test("every generated script leads with the review-only header", () => {
        const views = [
            deriveVectorIndexView(rtmProbe(), TARGET),
            deriveVectorIndexView(azureProbe([{ ...AZURE_INDEX, version: 2 }]), {
                ...TARGET,
                filterColumns: ["category"],
            }),
            deriveVectorIndexView(
                makeProbe({
                    previewFeatures: { evidence: stamp(), present: true, enabled: false },
                }),
                TARGET,
            ),
        ];
        const scripts = views.flatMap((view) => view.scripts);
        expect(scripts.length).to.be.greaterThan(4);
        for (const script of scripts) {
            expect(script.sql.startsWith(SCRIPT_REVIEW_HEADER), script.id).to.equal(true);
        }
        expect(buildEnablePreviewScript().startsWith(SCRIPT_REVIEW_HEADER)).to.equal(true);
    });

    test("deriveIndexName follows the vec_<table>_<column> convention and the 128 cap", () => {
        expect(deriveIndexName("DocumentChunks", "embedding")).to.equal(
            "vec_DocumentChunks_embedding",
        );
        expect(deriveIndexName("x".repeat(200), "y").length).to.equal(128);
    });
});

// ---------------------------------------------------------------------------
// Service: thunk-only collaborator (scripts can never execute from here)
// ---------------------------------------------------------------------------

suite("vectorIndexService service surface", () => {
    test("indexState derives a view from the probe and forwards the refresh flag", async () => {
        const refreshCalls: (boolean | undefined)[] = [];
        const service = new VectorIndexService(
            async (refresh) => {
                refreshCalls.push(refresh);
                return { probe: rtmProbe() };
            },
            () => TARGET,
        );

        const first = await service.indexState();
        expect(first.view!.state).to.equal("healthyCurrent");
        expect(first.error).to.equal(undefined);

        const second = await service.indexState(true);
        expect(second.view!.state).to.equal("healthyCurrent");
        expect(refreshCalls).to.deep.equal([false, true]);
    });

    test("capability refusal passes through as an honest error — never a fake state", async () => {
        const service = new VectorIndexService(async () => ({
            error: "No active connection. Connect this document before probing vector capabilities.",
        }));
        const result = await service.indexState();
        expect(result.view).to.equal(undefined);
        expect(result.error).to.match(/No active connection/);
    });

    test("structural proof: the service depends on a thunk only — no session anywhere", () => {
        // Type-level: the constructor accepts exactly (thunk, optional target
        // facts thunk). If anyone adds a session parameter this stops
        // compiling against the declared tuple.
        type CtorParams = ConstructorParameters<typeof VectorIndexService>;
        const typeLevelProof: CtorParams extends [
            VectorCapabilityThunk,
            (() => VectorIndexTargetFacts | undefined)?,
        ]
            ? true
            : false = true;
        expect(typeLevelProof).to.equal(true);

        // Module-level: the compiled service never requires the data plane —
        // there is no code path here capable of executing generated SQL.
        const compiled = fs.readFileSync(
            require.resolve("../../src/queryResults/vector/vectorIndexService"),
            "utf8",
        );
        expect(/require\([^)]*sqlDataPlane/.test(compiled)).to.equal(false);
        expect(/require\([^)]*vectorCatalogProbes/.test(compiled)).to.equal(false);
    });
});
