/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-7: capability/catalog probes, the capability service, and the
 * auxiliary-session seam.
 *
 * Part 1 — unit tests over a scripted fake ISqlSession (FakeBackend): the
 * tolerant behaviors the verified provider matrix mandates — missing DMV is
 * honest absence, phantom sys.vector_indexes rows are excluded by the
 * sys.indexes gate, health-DMV column names resolve to the ACTUAL (Azure)
 * names, egress classes derive from API_FORMAT, and a probe NEVER throws.
 *
 * Part 2 — LIVE gated tests (skip-not-fail, SqlClientEngineTests pattern):
 * run the EXACT probe SQL over a raw connection (the `mssql` npm package
 * when installed, else sqlcmd) against the environments named by
 * STS2_SQLSERVER_CONNSTRING / STS2_AZURESQLSERVER_CONNSTRING. They skip with
 * a log when the variable is unset, the server is unreachable, or the
 * VectorLab fixture is absent. Connection strings and passwords are never
 * printed — sqlcmd failures surface stdout only (never the argv, which
 * carries credentials for SQL auth).
 */

import { expect } from "chai";
import * as sinon from "sinon";
import * as cp from "child_process";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
} from "../../src/services/sqlDataPlane/api";
import {
    extractBuildParametersVersion,
    probeVectorCapabilities,
    resolveHealthColumns,
    VECTOR_PROBE_SQL,
    VectorProbeTarget,
} from "../../src/queryResults/vector/vectorCatalogProbes";
import {
    AuxiliarySessionLease,
    VectorCapabilityService,
} from "../../src/queryResults/vector/vectorCapabilityService";
import { classifyModelEgress } from "../../src/sharedInterfaces/vectorCatalog";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";
import { SqlDataPlaneService } from "../../src/services/sqlDataPlane/sqlDataPlaneService";

// ---------------------------------------------------------------------------
// Scripted fake sessions
// ---------------------------------------------------------------------------

type Rows = (string | number | boolean | null)[][];

const ok = (columns: string[], rows: Rows): FakeScript["events"] => [
    { type: "resultSet", columns, rows },
    { type: "complete", status: "succeeded" },
];

const fail = (text: string): FakeScript["events"] => [
    { type: "message", kind: "error", text },
    { type: "complete", status: "failed" },
];

/** Matchers keyed to distinctive fragments of VECTOR_PROBE_SQL. */
type ProbeScriptKey =
    | "identity"
    | "scoped"
    | "vectorType"
    | "columnMetadata"
    | "indexes"
    | "dmvPresence"
    | "dmvColumns"
    | "dmvRows"
    | "models"
    | "serverConfig"
    | "discovery"
    | "tvf"
    | "approx";

const PROBE_MATCHERS: Record<ProbeScriptKey, (t: string) => boolean> = {
    identity: (t) => t.includes("SERVERPROPERTY('ProductVersion')"),
    scoped: (t) => t.includes("sys.database_scoped_configurations"),
    vectorType: (t) => t.includes("VECTORPROPERTY"),
    columnMetadata: (t) => t.includes("OBJECT_ID(N'sys.columns')"),
    indexes: (t) => t.includes("FROM sys.vector_indexes"),
    dmvPresence: (t) => t.includes("IS NULL THEN 0"),
    dmvColumns: (t) => t.includes("sys.all_columns") && t.includes("dm_db_vector_indexes"),
    dmvRows: (t) => t.includes("FROM sys.dm_db_vector_indexes"),
    models: (t) => t.includes("FROM sys.external_models"),
    serverConfig: (t) => t.includes("FROM sys.configurations"),
    discovery: (t) => t.includes("t.name = N'vector'"),
    tvf: (t) => t.includes("VECTOR_SEARCH("),
    approx: (t) => t.includes("WITH APPROXIMATE"),
};

const probeScript = (key: ProbeScriptKey, events: FakeScript["events"]): FakeScript => ({
    match: PROBE_MATCHERS[key],
    events,
});

/** Rebuild a script set with per-key event overrides. */
function withOverrides(
    base: FakeScript[],
    overrides: Partial<Record<ProbeScriptKey, FakeScript["events"]>>,
): FakeScript[] {
    return base.map((script) => {
        for (const [key, events] of Object.entries(overrides)) {
            if (script.match === PROBE_MATCHERS[key as ProbeScriptKey] && events) {
                return probeScript(key as ProbeScriptKey, events);
            }
        }
        return script;
    });
}

async function sessionFor(scripts: FakeScript[]): Promise<ISqlSession> {
    const backend = new FakeBackend({ scripts });
    return backend.openSession({
        profile: { profileFingerprint: "fp", server: "srv", authKind: "integrated" },
        applicationName: "test-vector-probe",
    });
}

const RTM_BUILD_PARAMS = '{"StartId":"787", "L":"48", "M":"8", "R":"48"}';
const AZURE_BUILD_PARAMS = '{"StartId":"0", "L":"48", "R":"48", "Version":"3"}';

/** SQL Server 2025 RTM 17.0.1000.7 shape (verified 2026-07-11 matrix). */
function rtmScripts(): FakeScript[] {
    return [
        probeScript(
            "identity",
            ok(
                ["v", "e", "ee", "db", "cl"],
                [["17.0.1000.7", "Developer Edition (64-bit)", 3, "VectorLab", 170]],
            ),
        ),
        // ALLOW_STALE_VECTOR_INDEX row is ABSENT on RTM (verified).
        probeScript("scoped", ok(["name", "value"], [["PREVIEW_FEATURES", 1]])),
        probeScript("vectorType", ok(["dims"], [[3]])),
        probeScript(
            "columnMetadata",
            ok(["name"], [["vector_base_type"], ["vector_base_type_desc"], ["vector_dimensions"]]),
        ),
        probeScript(
            "indexes",
            ok(
                [
                    "object_id",
                    "index_id",
                    "schema",
                    "table",
                    "index",
                    "column",
                    "type",
                    "metric",
                    "params",
                    "vector_column_id",
                    "raw_present",
                    "usable",
                ],
                [
                    [
                        101,
                        2,
                        "dbo",
                        "VectorLabSearchCorpus",
                        "IX_VectorLabSearchCorpus_Embedding",
                        "embedding",
                        "DiskANN",
                        "COSINE",
                        RTM_BUILD_PARAMS,
                        2,
                        1,
                        1,
                    ],
                ],
            ),
        ),
        probeScript("dmvPresence", ok(["present"], [[0]])), // DMV absent on RTM
        probeScript(
            "models",
            ok(
                ["name", "owner", "api", "type", "model", "location", "modified"],
                [
                    [
                        "VectorLabEmbeddingModel",
                        "dbo",
                        "OpenAI",
                        "EMBEDDINGS",
                        "text-embedding-3-small",
                        "https://api.openai.com/v1/embeddings?api-key=CANARY_SECRET",
                        "2026-07-11T00:00:00",
                    ],
                ],
            ),
        ),
        probeScript(
            "serverConfig",
            ok(
                ["name", "value"],
                [
                    ["external rest endpoint enabled", 1],
                    ["external AI runtimes enabled", 0],
                ],
            ),
        ),
        probeScript(
            "discovery",
            ok(
                ["schema", "table", "column", "dims"],
                [
                    ["dbo", "VectorLabChunks", "embedding", 64],
                    ["dbo", "VectorLabSearchCorpus", "embedding", 64],
                ],
            ),
        ),
        probeScript("tvf", ok(["distance"], [])),
        probeScript("approx", fail("Incorrect syntax near 'APPROXIMATE'.")),
    ];
}

/** Azure SQL DB shape (verified 2026-07-11 matrix): DMV present with the
 *  AZURE column names, Version in build_parameters, phantom index residue,
 *  VECTOR_SEARCH parse-gated by PREVIEW_FEATURES (OFF here). */
function azureScripts(): FakeScript[] {
    const dmvColumns = [
        "object_id",
        "index_id",
        "rows_indexed",
        "graph_catchup_pending_percent",
        "last_background_task_execution_time",
        "last_background_task_succeeded",
    ];
    return [
        probeScript(
            "identity",
            ok(["v", "e", "ee", "db", "cl"], [["12.0.2000.8", "SQL Azure", 5, "ninjadb", 170]]),
        ),
        probeScript(
            "scoped",
            ok(
                ["name", "value"],
                [
                    ["PREVIEW_FEATURES", 0],
                    ["ALLOW_STALE_VECTOR_INDEX", 0],
                ],
            ),
        ),
        probeScript("vectorType", ok(["dims"], [[3]])),
        probeScript(
            "columnMetadata",
            ok(["name"], [["vector_base_type"], ["vector_base_type_desc"], ["vector_dimensions"]]),
        ),
        probeScript(
            "indexes",
            ok(
                [
                    "object_id",
                    "index_id",
                    "schema",
                    "table",
                    "index",
                    "column",
                    "type",
                    "metric",
                    "params",
                    "vector_column_id",
                    "raw_present",
                    "usable",
                ],
                [
                    // Confirmed current-format index (Version 3).
                    [
                        1525580473,
                        5,
                        "vectorlab",
                        "VectorLabSearchCorpus",
                        "IX_ok",
                        "embedding",
                        "DiskANN",
                        "COSINE",
                        AZURE_BUILD_PARAMS,
                        2,
                        1,
                        1,
                    ],
                    // Phantom residue of a failed build: in sys.vector_indexes,
                    // NOT in sys.indexes (verified live on GP_S serverless).
                    [
                        202,
                        7,
                        "vectorlab",
                        "Phantoms",
                        "IX_phantom",
                        "embedding",
                        "DiskANN",
                        "EUCLIDEAN",
                        '{"StartId":"0"}',
                        2,
                        0,
                        0,
                    ],
                ],
            ),
        ),
        probeScript("dmvPresence", ok(["present"], [[1]])),
        probeScript(
            "dmvColumns",
            ok(
                ["name"],
                dmvColumns.map((c) => [c]),
            ),
        ),
        probeScript(
            "dmvRows",
            ok(dmvColumns, [["1525580473", "5", "4959", "2.5", "2026-07-11 01:00:00", "1"]]),
        ),
        probeScript(
            "models",
            ok(
                ["name", "owner", "api", "type", "model", "location", "modified"],
                [
                    [
                        "VectorLabEmbeddingModel",
                        "dbo",
                        "Azure OpenAI",
                        "EMBEDDINGS",
                        "text-embedding-3-small",
                        "https://sqlninja.openai.azure.com/openai/deployments/x/embeddings?api-version=2024-02-01",
                        "2026-07-11T00:00:00",
                    ],
                ],
            ),
        ),
        probeScript(
            "serverConfig",
            ok(
                ["name", "value"],
                [
                    ["external rest endpoint enabled", 1],
                    ["external AI runtimes enabled", 0],
                ],
            ),
        ),
        probeScript(
            "discovery",
            ok(
                ["schema", "table", "column", "dims"],
                [["vectorlab", "VectorLabSearchCorpus", "embedding", 64]],
            ),
        ),
        // Preview OFF: parse rejection (Msg 102 shape) → needsPreview.
        probeScript("tvf", fail("Incorrect syntax near '('.")),
        probeScript("approx", fail("Incorrect syntax near 'APPROXIMATE'.")),
    ];
}

// ---------------------------------------------------------------------------
// Part 1a — probe unit tests
// ---------------------------------------------------------------------------

suite("Vector catalog probes (VEC-7)", () => {
    test("vector-index confirmation excludes disabled and hypothetical catalog rows", () => {
        const sql = VECTOR_PROBE_SQL.vectorIndexes();
        expect(sql).to.contain("iusable.is_disabled = 0");
        expect(sql).to.contain("iusable.is_hypothetical = 0");
    });

    test("target-scoped index confirmation is authoritative beyond the global preview cap", () => {
        const globalSql = VECTOR_PROBE_SQL.vectorIndexes();
        const scopedSql = VECTOR_PROBE_SQL.vectorIndexes({
            schema: "vectorlab",
            table: "VectorLabSearchCorpus",
        });
        expect(globalSql).to.contain("SELECT TOP (64)");
        expect(scopedSql).to.match(/^SELECT\r?\n/);
        expect(scopedSql).to.not.contain("TOP (64)");
        expect(scopedSql).to.contain("WHERE v.object_id = OBJECT_ID");

        const scopedHealth = VECTOR_PROBE_SQL.healthDmvRows(
            ["object_id", "index_id", "graph_catchup_pending_percent"],
            { schema: "vectorlab", table: "VectorLabSearchCorpus" },
        );
        expect(scopedHealth).to.not.contain("TOP (16)");
        expect(scopedHealth).to.contain("WHERE [object_id] = OBJECT_ID");
    });

    test("RTM shape: DMV honestly absent, no $.Version, TVF accepted on the indexed table, WITH APPROXIMATE rejected", async () => {
        const probe = await probeVectorCapabilities(await sessionFor(rtmScripts()));

        expect(probe.engine.productVersion).to.equal("17.0.1000.7");
        expect(probe.engine.engineEditionId).to.equal(3);
        expect(probe.engine.compatibilityLevel).to.equal(170);
        expect(probe.previewFeatures).to.deep.include({ present: true, enabled: true });
        // ALLOW_STALE_VECTOR_INDEX does not exist on RTM — present:false is
        // the fact, not an error.
        expect(probe.allowStaleVectorIndex.present).to.equal(false);
        expect(probe.allowStaleVectorIndex.error).to.equal(undefined);
        expect(probe.vectorType.usable).to.equal(true);
        expect(probe.columnMetadata.vectorDimensionsPresent).to.equal(true);

        expect(probe.indexes.available).to.equal(true);
        expect(probe.indexes.indexes).to.have.length(1);
        expect(probe.indexes.indexes[0]).to.deep.include({
            tableName: "VectorLabSearchCorpus",
            indexType: "DiskANN",
            distanceMetric: "COSINE",
        });
        // RTM build_parameters has NO Version key — must stay undefined.
        expect(probe.indexes.indexes[0].version).to.equal(undefined);
        expect(probe.indexes.phantomCount).to.equal(0);

        // Health DMV absent on RTM: present false, no rows, no error.
        expect(probe.healthDmv.present).to.equal(false);
        expect(probe.healthDmv.rows).to.equal(undefined);
        expect(probe.healthDmv.error).to.equal(undefined);

        expect(probe.externalModels.models).to.have.length(1);
        expect(probe.externalModels.models[0]).to.deep.include({
            name: "VectorLabEmbeddingModel",
            owner: "dbo",
            egress: "externalEgress",
            endpointHost: "api.openai.com",
        });
        // The endpoint query string (which can carry keys) never escapes.
        expect(JSON.stringify(probe)).to.not.include("CANARY_SECRET");
        expect(JSON.stringify(probe)).to.not.include("api-key");

        expect(probe.serverConfig.externalRestEndpointEnabled).to.equal(true);
        expect(probe.serverConfig.externalAiRuntimesEnabled).to.equal(false);

        // The syntax probe prefers the table with a CONFIRMED index (clean
        // acceptance) over the alphabetically-first vector column.
        expect(probe.vectorSearchTvf.status).to.equal("accepted");
        expect(probe.vectorSearchTvf.target).to.equal("dbo.VectorLabSearchCorpus");
        // Preview is ON, so a parse rejection is a plain rejection.
        expect(probe.topNWithApproximate.status).to.equal("rejected");
        expect(probe.topNWithApproximate.message).to.include("Incorrect syntax");
    });

    test("Azure shape: DMV column names resolve to the ACTUAL names, phantom index excluded, Version extracted, TVF needsPreview when preview is OFF", async () => {
        const probe = await probeVectorCapabilities(await sessionFor(azureScripts()));

        expect(probe.engine.engineEditionId).to.equal(5);
        expect(probe.previewFeatures).to.deep.include({ present: true, enabled: false });
        expect(probe.allowStaleVectorIndex).to.deep.include({ present: true, enabled: false });

        // Phantom gate: sys.vector_indexes row missing from sys.indexes is
        // counted, never surfaced as a usable index.
        expect(probe.indexes.indexes).to.have.length(1);
        expect(probe.indexes.indexes[0].indexName).to.equal("IX_ok");
        expect(probe.indexes.indexes[0].version).to.equal(3);
        expect(probe.indexes.phantomCount).to.equal(1);

        // Column-name resolution picks the verified Azure names — NOT the
        // guide's assumed approximate_staleness_percent.
        expect(probe.healthDmv.present).to.equal(true);
        expect(probe.healthDmv.stalenessColumn).to.equal("graph_catchup_pending_percent");
        expect(probe.healthDmv.lastTaskColumn).to.equal("last_background_task_execution_time");
        expect(probe.healthDmv.rows).to.have.length(1);
        expect(probe.healthDmv.rows![0]["graph_catchup_pending_percent"]).to.equal("2.5");
        expect(probe.healthDmv.rows![0]["last_background_task_succeeded"]).to.equal("1");

        expect(probe.externalModels.models[0]).to.deep.include({
            name: "VectorLabEmbeddingModel",
            apiFormat: "Azure OpenAI",
            egress: "externalEgress",
            endpointHost: "sqlninja.openai.azure.com",
        });

        // Parse rejection while PREVIEW_FEATURES is known OFF → needsPreview.
        expect(probe.vectorSearchTvf.status).to.equal("needsPreview");
        expect(probe.topNWithApproximate.status).to.equal("needsPreview");
    });

    test("bare engine (no scripts): every section is an honest absence and the probe never throws", async () => {
        const probe = await probeVectorCapabilities(await sessionFor([]));

        expect(probe.engine.error).to.be.a("string").and.not.equal("");
        expect(probe.engine.productVersion).to.equal(undefined);
        expect(probe.previewFeatures.present).to.equal(false);
        expect(probe.previewFeatures.error).to.be.a("string");
        expect(probe.vectorType.usable).to.equal(false);
        expect(probe.vectorType.error).to.be.a("string");
        expect(probe.columnMetadata.vectorDimensionsPresent).to.equal(false);
        expect(probe.indexes.available).to.equal(false);
        expect(probe.indexes.indexes).to.have.length(0);
        expect(probe.healthDmv.present).to.equal(false);
        expect(probe.healthDmv.error).to.be.a("string");
        expect(probe.externalModels.available).to.equal(false);
        expect(probe.serverConfig.error).to.be.a("string");
        // No discoverable vector column → placeholder probe; unclassifiable
        // failure text is a rejection with the message carried, no target.
        expect(probe.vectorSearchTvf.status).to.equal("rejected");
        expect(probe.vectorSearchTvf.message).to.be.a("string");
        expect(probe.vectorSearchTvf.target).to.equal(undefined);
        expect(probe.topNWithApproximate.status).to.equal("rejected");
    });

    test("a bind-time 'cannot find a vector index' still proves TVF syntax acceptance", async () => {
        // No confirmed index anywhere, and the TVF probe fails at BIND with
        // the verified Msg 42227 text — syntax was accepted; the limitation
        // is carried on the message (and on the index probe itself).
        const custom = withOverrides(rtmScripts(), {
            indexes: ok(
                [
                    "object_id",
                    "index_id",
                    "schema",
                    "table",
                    "index",
                    "column",
                    "type",
                    "metric",
                    "params",
                    "vector_column_id",
                    "raw_present",
                    "usable",
                ],
                [],
            ),
            tvf: fail("Cannot find a vector index with metric 'cosine' on column 'embedding'."),
        });
        const probe = await probeVectorCapabilities(await sessionFor(custom));
        expect(probe.vectorSearchTvf.status).to.equal("accepted");
        expect(probe.vectorSearchTvf.message).to.include("Cannot find a vector index");
        // Fell back to the first discovered vector column.
        expect(probe.vectorSearchTvf.target).to.equal("dbo.VectorLabChunks");
    });

    test("egress classification per API_FORMAT (A4/P0-5)", async () => {
        expect(classifyModelEgress("Azure OpenAI")).to.equal("externalEgress");
        expect(classifyModelEgress("OpenAI")).to.equal("externalEgress");
        expect(classifyModelEgress("Ollama")).to.equal("hostLocal");
        expect(classifyModelEgress("ONNX")).to.equal("inProcess");
        expect(classifyModelEgress("ONNX Runtime")).to.equal("inProcess");
        expect(classifyModelEgress("SomethingNew")).to.equal("unknown");
        expect(classifyModelEgress(undefined)).to.equal("unknown");

        const custom = withOverrides(rtmScripts(), {
            models: ok(
                ["name", "owner", "api", "type", "model", "location", "modified"],
                [
                    ["A", "dbo", "Azure OpenAI", "EMBEDDINGS", "m1", null, null],
                    [
                        "B",
                        "appuser",
                        "Ollama",
                        "EMBEDDINGS",
                        "m2",
                        "http://localhost:11434/api/embed",
                        null,
                    ],
                    ["C", "dbo", "ONNX Runtime", "EMBEDDINGS", "m3", null, null],
                    ["D", "dbo", "FutureFormat", "EMBEDDINGS", "m4", null, null],
                ],
            ),
        });
        const probe = await probeVectorCapabilities(await sessionFor(custom));
        expect(probe.externalModels.models.map((m) => m.egress)).to.deep.equal([
            "externalEgress",
            "hostLocal",
            "inProcess",
            "unknown",
        ]);
        expect(probe.externalModels.models[1].owner).to.equal("appuser");
    });

    test("resolveHealthColumns matches both documented and verified-Azure names", () => {
        expect(
            resolveHealthColumns([
                "object_id",
                "approximate_staleness_percent",
                "last_background_task_time",
            ]),
        ).to.deep.equal({
            stalenessColumn: "approximate_staleness_percent",
            lastTaskColumn: "last_background_task_time",
        });
        expect(
            resolveHealthColumns([
                "object_id",
                "graph_catchup_pending_percent",
                "last_background_task_execution_time",
            ]),
        ).to.deep.equal({
            stalenessColumn: "graph_catchup_pending_percent",
            lastTaskColumn: "last_background_task_execution_time",
        });
        expect(resolveHealthColumns(["object_id"])).to.deep.equal({});
    });

    test("extractBuildParametersVersion tolerates every verified shape", () => {
        expect(extractBuildParametersVersion(RTM_BUILD_PARAMS)).to.equal(undefined);
        expect(extractBuildParametersVersion(AZURE_BUILD_PARAMS)).to.equal(3);
        expect(extractBuildParametersVersion('{"Version": 2}')).to.equal(2);
        expect(extractBuildParametersVersion("not json")).to.equal(undefined);
        expect(extractBuildParametersVersion(undefined)).to.equal(undefined);
    });
});

// ---------------------------------------------------------------------------
// Part 1b — capability service (caching policy layer)
// ---------------------------------------------------------------------------

suite("VectorCapabilityService (VEC-7)", () => {
    interface Harness {
        service: VectorCapabilityService;
        acquires: number;
        disposals: number;
        setIdentity(identity: { connectionId: string; database?: string } | undefined): void;
        setNow(epochMs: number): void;
    }

    function harness(ttlMs = 60_000): Harness {
        let identity: { connectionId: string; database?: string } | undefined = {
            connectionId: "conn1",
            database: "VectorLab",
        };
        let now = 1_000_000;
        const state = {
            acquires: 0,
            disposals: 0,
        };
        const service = new VectorCapabilityService(
            {
                identity: () => identity,
                acquire: async (): Promise<AuxiliarySessionLease | undefined> => {
                    state.acquires++;
                    const session = await sessionFor(rtmScripts());
                    return {
                        session,
                        dispose: () => {
                            state.disposals++;
                            void session.close();
                        },
                    };
                },
            },
            ttlMs,
            () => now,
        );
        return {
            service,
            get acquires() {
                return state.acquires;
            },
            get disposals() {
                return state.disposals;
            },
            setIdentity: (value) => (identity = value),
            setNow: (epochMs) => (now = epochMs),
        };
    }

    test("caches per (connectionId, database) within the TTL; refresh and expiry re-probe", async () => {
        const h = harness(60_000);
        const first = await h.service.capabilities();
        expect(first.probe).to.not.equal(undefined);
        expect(h.acquires).to.equal(1);
        expect(h.disposals).to.equal(1); // aux session disposed after the pass

        const second = await h.service.capabilities();
        expect(second.probe).to.equal(first.probe); // served from cache
        expect(h.acquires).to.equal(1);

        const refreshed = await h.service.capabilities(true);
        expect(h.acquires).to.equal(2);
        expect(refreshed.probe).to.not.equal(undefined);

        h.setNow(1_000_000 + 61_000); // past the TTL
        await h.service.capabilities();
        expect(h.acquires).to.equal(3);
    });

    test("a database switch re-keys the cache", async () => {
        const h = harness();
        await h.service.capabilities();
        h.setIdentity({ connectionId: "conn1", database: "OtherDb" });
        await h.service.capabilities();
        expect(h.acquires).to.equal(2);
        // Switching back inside the TTL serves the original entry.
        h.setIdentity({ connectionId: "conn1", database: "VectorLab" });
        await h.service.capabilities();
        expect(h.acquires).to.equal(2);
    });

    test("table-scoped probes use independent cache entries", async () => {
        const h = harness();
        const table = { schema: "dbo", table: "VectorLabChunks" };
        await h.service.capabilities(false, table);
        await h.service.capabilities(false, table);
        expect(h.acquires).to.equal(1);

        await h.service.capabilities(false, { schema: "dbo", table: "OtherVectors" });
        await h.service.capabilities();
        expect(h.acquires).to.equal(3);
    });

    test("concurrent callers coalesce onto one probe pass", async () => {
        const h = harness();
        const [a, b] = await Promise.all([h.service.capabilities(), h.service.capabilities()]);
        expect(h.acquires).to.equal(1);
        expect(a.probe).to.equal(b.probe);
    });

    test("refuses honestly: no identity / no aux session", async () => {
        const h = harness();
        h.setIdentity(undefined);
        const noConnection = await h.service.capabilities();
        expect(noConnection.error).to.include("No active connection");
        expect(h.acquires).to.equal(0);

        const refusingService = new VectorCapabilityService({
            identity: () => ({ connectionId: "c", database: "d" }),
            acquire: async () => undefined,
        });
        const refused = await refusingService.capabilities();
        expect(refused.error).to.include("auxiliary diagnostic session");
        expect(refused.probe).to.equal(undefined);
    });
});

// ---------------------------------------------------------------------------
// Part 1c — auxiliary-session seam on the binding
// ---------------------------------------------------------------------------

suite("DocumentSessionBinding auxiliary sessions (VEC-7)", () => {
    let sandbox: sinon.SinonSandbox;
    let backend: FakeBackend;
    let opened: OpenSessionParams[];

    setup(() => {
        sandbox = sinon.createSandbox();
        backend = new FakeBackend({});
        opened = [];
        const connectionService: Pick<ISqlConnectionService, "openSession"> = {
            openSession: (params) => {
                opened.push(params);
                return backend.openSession(params);
            },
        };
        sandbox.stub(SqlDataPlaneService, "get").returns({
            service: async () => connectionService,
        } as unknown as SqlDataPlaneService);
    });

    teardown(() => {
        sandbox.restore();
    });

    /** Wire a binding into the connected state without the interactive flow. */
    async function connectedBinding(): Promise<{
        binding: DocumentSessionBinding;
        userSession: ISqlSession;
    }> {
        const binding = new DocumentSessionBinding();
        const userSession = await backend.openSession({
            profile: { profileFingerprint: "fp", server: "srv", authKind: "integrated" },
            applicationName: "vscode-mssql-querystudio",
            database: "UserDb",
        });
        const internals = binding as unknown as {
            lastStoredProfile?: Record<string, unknown>;
            lastStore?: unknown;
            lastProfileRef?: unknown;
            stateKind: string;
            session?: ISqlSession;
        };
        internals.lastStoredProfile = {
            server: "srv",
            database: "ProfileDb",
            authenticationType: "Integrated",
        };
        internals.lastStore = {
            readAllConnections: async () => [],
            lookupPassword: async () => "",
        };
        internals.lastProfileRef = {
            profileFingerprint: "fp",
            server: "srv",
            authKind: "integrated",
        };
        internals.session = userSession;
        internals.stateKind = "connected";
        return { binding, userSession };
    }

    test("refuses honestly when there is no active profile", async () => {
        const binding = new DocumentSessionBinding();
        expect(await binding.acquireAuxiliarySession("vectorDiagnostics")).to.equal(undefined);
        binding.dispose();
    });

    test("opens a NARROW purpose-tagged session on the user's CURRENT database — never the user session", async () => {
        const { binding, userSession } = await connectedBinding();
        const lease = await binding.acquireAuxiliarySession("vectorDiagnostics");
        expect(lease).to.not.equal(undefined);
        // A fresh session — not the user session, not the metadata session.
        expect(lease!.session).to.not.equal(userSession);
        expect(lease!.session).to.not.equal(binding.activeSession);
        // Follows the CURRENT database (post-USE), not the profile default.
        const params = opened[opened.length - 1];
        expect(params.database).to.equal("UserDb");
        expect(params.applicationName).to.equal("vscode-mssql-querystudio-vectordiag");
        expect(params.profile.server).to.equal("srv");

        const modelLease = await binding.acquireAuxiliarySession("vectorModelCall");
        expect(opened[opened.length - 1].applicationName).to.equal(
            "vscode-mssql-querystudio-vectormodel",
        );
        lease!.dispose();
        modelLease!.dispose();
        binding.dispose();
    });

    test("caps at 2 auxiliary sessions; dispose releases the slot (idempotent) and closes the session", async () => {
        const { binding } = await connectedBinding();
        const first = await binding.acquireAuxiliarySession("vectorDiagnostics");
        const second = await binding.acquireAuxiliarySession("vectorModelCall");
        expect(first).to.not.equal(undefined);
        expect(second).to.not.equal(undefined);
        expect(binding.auxiliarySessionCount).to.equal(2);
        expect(await binding.acquireAuxiliarySession("vectorDiagnostics")).to.equal(undefined);

        first!.dispose();
        first!.dispose(); // idempotent
        expect(binding.auxiliarySessionCount).to.equal(1);
        expect(first!.session.state).to.equal("closed");

        const third = await binding.acquireAuxiliarySession("vectorDiagnostics");
        expect(third).to.not.equal(undefined);
        third!.dispose();
        second!.dispose();
        binding.dispose();
    });

    test("binding dispose closes outstanding auxiliary sessions", async () => {
        const { binding } = await connectedBinding();
        const lease = await binding.acquireAuxiliarySession("vectorDiagnostics");
        expect(lease).to.not.equal(undefined);
        binding.dispose();
        expect(binding.auxiliarySessionCount).to.equal(0);
        expect(lease!.session.state).to.equal("closed");
    });
});

// ---------------------------------------------------------------------------
// Part 2 — LIVE gated tests (skip-not-fail; never print secrets)
// ---------------------------------------------------------------------------

interface LiveTarget {
    readonly server: string;
    readonly database?: string;
    readonly user?: string;
    readonly password?: string;
    readonly integrated: boolean;
}

function parseConnString(raw: string | undefined): LiveTarget | undefined {
    if (!raw) {
        return undefined;
    }
    const map = new Map<string, string>();
    for (const segment of raw.split(";")) {
        const idx = segment.indexOf("=");
        if (idx > 0) {
            map.set(segment.slice(0, idx).trim().toLowerCase(), segment.slice(idx + 1).trim());
        }
    }
    const server = map.get("data source") ?? map.get("server");
    if (!server) {
        return undefined;
    }
    const database = map.get("initial catalog") ?? map.get("database");
    const user = map.get("user id") ?? map.get("uid");
    const password = map.get("password") ?? map.get("pwd");
    return {
        server,
        ...(database ? { database } : {}),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
        integrated: /^(true|sspi|yes)$/i.test(map.get("integrated security") ?? ""),
    };
}

interface LiveSqlResult {
    readonly ok: boolean;
    readonly text: string;
}

let sqlcmdChecked: boolean | undefined;
function sqlcmdAvailable(): boolean {
    if (sqlcmdChecked === undefined) {
        try {
            cp.execFileSync("sqlcmd", ["-?"], { stdio: "pipe", timeout: 10_000 });
            sqlcmdChecked = true;
        } catch {
            sqlcmdChecked = false;
        }
    }
    return sqlcmdChecked;
}

/** The 'mssql' npm package when installed (SQL-auth path); else undefined. */
function tryRequireMssql(): unknown {
    try {
        return require("mssql");
    } catch {
        return undefined;
    }
}

function runViaSqlcmd(target: LiveTarget, database: string, sql: string): LiveSqlResult {
    const args = [
        "-S",
        target.server,
        "-d",
        database,
        // QUOTED_IDENTIFIER ON (ODBC sqlcmd defaults OFF; verified required
        // for the vector surface).
        "-I",
        "-h",
        "-1",
        "-W",
        "-s",
        "|",
        "-l",
        "8",
        "-Q",
        `SET NOCOUNT ON; ${sql}`,
    ];
    if (target.integrated) {
        args.push("-E");
    } else {
        args.push("-U", target.user ?? "", "-P", target.password ?? "");
    }
    try {
        const out = cp.execFileSync("sqlcmd", args, {
            encoding: "utf8",
            timeout: 30_000,
            stdio: ["ignore", "pipe", "pipe"],
        });
        return { ok: !/^Msg \d+/m.test(out), text: out };
    } catch (error) {
        // NEVER surface error.message — it embeds the argv (credentials).
        const stdout = (error as { stdout?: unknown }).stdout;
        const text =
            typeof stdout === "string"
                ? stdout
                : Buffer.isBuffer(stdout)
                  ? stdout.toString("utf8")
                  : "sqlcmd execution failed";
        return { ok: false, text };
    }
}

async function runViaMssqlPackage(
    pkg: unknown,
    target: LiveTarget,
    database: string,
    sql: string,
): Promise<LiveSqlResult> {
    const mssql = pkg as {
        ConnectionPool: new (config: unknown) => {
            connect(): Promise<void>;
            request(): { query(text: string): Promise<{ recordsets: unknown[][] }> };
            close(): Promise<void>;
        };
    };
    const [host, portText] = target.server.split(",");
    const pool = new mssql.ConnectionPool({
        server: host,
        ...(portText ? { port: Number(portText) } : {}),
        database,
        user: target.user,
        password: target.password,
        options: { encrypt: true, trustServerCertificate: true },
        requestTimeout: 30_000,
        connectionTimeout: 15_000,
    });
    try {
        await pool.connect();
        const result = await pool.request().query(sql);
        const lines: string[] = [];
        for (const recordset of result.recordsets ?? []) {
            for (const row of recordset as Record<string, unknown>[]) {
                lines.push(
                    Object.values(row)
                        .map((v) => (v === null || v === undefined ? "NULL" : String(v)))
                        .join("|"),
                );
            }
        }
        return { ok: true, text: lines.join("\n") };
    } catch (error) {
        return { ok: false, text: error instanceof Error ? error.message : "mssql query failed" };
    } finally {
        await pool.close().catch(() => undefined);
    }
}

/** Execute one probe statement against the live target. */
async function runLiveSql(
    target: LiveTarget,
    database: string,
    sql: string,
): Promise<LiveSqlResult> {
    const pkg = tryRequireMssql();
    // Integrated auth needs sqlcmd (the tedious driver has no SSPI).
    if (pkg && !target.integrated && target.user) {
        return runViaMssqlPackage(pkg, target, database, sql);
    }
    if (!sqlcmdAvailable()) {
        return { ok: false, text: "no sql client available (mssql package absent, sqlcmd absent)" };
    }
    return runViaSqlcmd(target, database, sql);
}

/** Data lines → cells (skips messages, blank lines, count footers). */
function dataRows(text: string): string[][] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^Msg \d+/.test(line) && !line.startsWith("("))
        .map((line) => line.split("|").map((cell) => cell.trim()));
}

suite("Vector catalog probes — LIVE (gated, skip-not-fail)", function () {
    this.timeout(120_000);

    test("SQL Server 2025 RTM: no health DMV, no $.Version, VECTOR_SEARCH TVF accepted", async function () {
        const target = parseConnString(process.env.STS2_SQLSERVER_CONNSTRING);
        if (!target) {
            console.log("[vectorCatalogProbes.live] SKIP RTM: STS2_SQLSERVER_CONNSTRING not set");
            this.skip();
        }
        const reachability = await runLiveSql(
            target,
            target.database ?? "master",
            "SELECT CASE WHEN DB_ID(N'VectorLab') IS NULL THEN 0 ELSE 1 END;",
        );
        if (!reachability.ok) {
            console.log("[vectorCatalogProbes.live] SKIP RTM: server unreachable or query failed");
            this.skip();
        }
        if (dataRows(reachability.text)[0]?.[0] !== "1") {
            console.log("[vectorCatalogProbes.live] SKIP RTM: VectorLab fixture database absent");
            this.skip();
        }

        // 1. Health DMV honestly absent on RTM (matrix row verified).
        const presence = await runLiveSql(target, "VectorLab", VECTOR_PROBE_SQL.healthDmvPresence);
        expect(presence.ok, presence.text).to.equal(true);
        expect(dataRows(presence.text)[0]?.[0]).to.equal("0");

        // 2. The DiskANN index is confirmed by the sys.indexes join and its
        //    build_parameters carries NO $.Version key on RTM.
        const indexes = await runLiveSql(target, "VectorLab", VECTOR_PROBE_SQL.vectorIndexes());
        expect(indexes.ok, indexes.text).to.equal(true);
        const indexRows = dataRows(indexes.text);
        expect(indexRows.length, "expected at least one vector index in VectorLab").to.be.at.least(
            1,
        );
        const confirmed = indexRows.filter((row) => row[11] === "1");
        expect(confirmed.length, "expected a sys.indexes-confirmed vector index").to.be.at.least(1);
        expect(confirmed[0][6]).to.equal("DiskANN");
        for (const row of confirmed) {
            expect(extractBuildParametersVersion(row[8])).to.equal(undefined);
        }

        // 3. VECTOR_SEARCH TVF parse probe on the indexed table: ACCEPTED
        //    (runs empty — WHERE 1 = 0 — with preview ON + index present).
        const discovery = await runLiveSql(
            target,
            "VectorLab",
            VECTOR_PROBE_SQL.discoverVectorColumns,
        );
        expect(discovery.ok, discovery.text).to.equal(true);
        const columns = dataRows(discovery.text);
        const indexedColumn =
            columns.find((row) =>
                confirmed.some((index) => index[2] === row[0] && index[3] === row[1]),
            ) ?? columns[0];
        expect(indexedColumn, "expected a vector column in VectorLab").to.not.equal(undefined);
        const probeTarget: VectorProbeTarget = {
            schema: indexedColumn[0],
            table: indexedColumn[1],
            column: indexedColumn[2],
            dimensions: Number(indexedColumn[3]),
            metric: "cosine",
        };
        const tvf = await runLiveSql(
            target,
            "VectorLab",
            VECTOR_PROBE_SQL.vectorSearchTvf(probeTarget),
        );
        expect(tvf.ok, `TVF probe should parse cleanly, got: ${tvf.text}`).to.equal(true);

        // 4. TOP (n) WITH APPROXIMATE is rejected on RTM (recorded honestly).
        const approx = await runLiveSql(
            target,
            "VectorLab",
            VECTOR_PROBE_SQL.topNWithApproximate(probeTarget),
        );
        expect(approx.ok).to.equal(false);
        expect(approx.text).to.match(/Msg 102|Incorrect syntax/i);
    });

    test("Azure SQL DB: health DMV present with resolved column names; VectorLabEmbeddingModel classifies externalEgress", async function () {
        const target = parseConnString(process.env.STS2_AZURESQLSERVER_CONNSTRING);
        if (!target) {
            console.log(
                "[vectorCatalogProbes.live] SKIP Azure: STS2_AZURESQLSERVER_CONNSTRING not set",
            );
            this.skip();
        }
        const database = target.database ?? "master";
        const reachability = await runLiveSql(target, database, "SELECT 1;");
        if (!reachability.ok) {
            console.log("[vectorCatalogProbes.live] SKIP Azure: server unreachable");
            this.skip();
        }

        // 1. Health DMV present on Azure.
        const presence = await runLiveSql(target, database, VECTOR_PROBE_SQL.healthDmvPresence);
        expect(presence.ok, presence.text).to.equal(true);
        expect(dataRows(presence.text)[0]?.[0]).to.equal("1");

        // 2. Column-name resolution finds the verified Azure names.
        const dmvColumns = await runLiveSql(target, database, VECTOR_PROBE_SQL.healthDmvColumns);
        expect(dmvColumns.ok, dmvColumns.text).to.equal(true);
        const names = dataRows(dmvColumns.text).map((row) => row[0]);
        expect(names).to.include("graph_catchup_pending_percent");
        expect(names).to.include("last_background_task_execution_time");
        const resolved = resolveHealthColumns(names);
        expect(resolved.stalenessColumn).to.equal("graph_catchup_pending_percent");
        expect(resolved.lastTaskColumn).to.equal("last_background_task_execution_time");

        // 3. VectorLabEmbeddingModel (Azure OpenAI) → externalEgress class.
        const models = await runLiveSql(target, database, VECTOR_PROBE_SQL.externalModels);
        expect(models.ok, models.text).to.equal(true);
        const modelRows = dataRows(models.text);
        const lab = modelRows.find((row) => row[0] === "VectorLabEmbeddingModel");
        expect(lab, "expected VectorLabEmbeddingModel in sys.external_models").to.not.equal(
            undefined,
        );
        expect(lab![2]).to.equal("Azure OpenAI");
        expect(lab![3]).to.equal("EMBEDDINGS");
        expect(classifyModelEgress(lab![2])).to.equal("externalEgress");
    });
});
