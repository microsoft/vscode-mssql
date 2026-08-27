/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-3 store integration (cache/drift design §10.1/§17.1, addendum
 * C-2.4/C-4/C-7/H-7):
 * - a fresh acquire loads the disk snapshot BEFORE live hydration and
 *   publishes it at the manifest's generation; the next live publish is
 *   strictly greater;
 * - C-4.1: a disk-published entry ALWAYS schedules a background live
 *   hydration (unless offline) — cached data never becomes forever-truth;
 * - C-4.2: the digest baseline is never seeded from the manifest — the
 *   first live digest compares AGAINST the manifest's recorded digest
 *   (match ⇒ validated cheaply; mismatch ⇒ forced refresh);
 * - T-A12 (C-4.3): a failed refresh over a retained snapshot re-arms with
 *   backoff and recovers;
 * - live generations save back through the coordinator (manifest advances);
 * - offline mode publishes the disk snapshot with NO background refresh;
 * - T-A18: key-correctness A/B isolation and the tripwire hold with the
 *   cache enabled.
 */

import { expect } from "chai";
import { MemFs } from "./support/memFsLike";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
} from "../../src/services/sqlDataPlane/api";
import { CatalogBuilder } from "../../src/services/metadata/catalogModel";
import {
    DataPlaneMetadataSessionSource,
    MetadataService,
} from "../../src/services/metadata/metadataService";
import { MetadataStore } from "../../src/services/metadata/metadataStore";
import { prepareConnection } from "../../src/services/metadata/profileAuthAdapter";
import { MetadataCacheStore } from "../../src/services/metadata/cache/metadataCacheStore";
import { MetadataCacheCoordinator } from "../../src/services/metadata/cache/metadataCacheCoordinator";
import {
    cachePolicyId,
    DEFAULT_METADATA_CACHE_SETTINGS,
    MetadataCacheSettings,
} from "../../src/services/metadata/cache/metadataCacheSettings";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROFILE = {
    server: "srv-alpha",
    database: "DbA",
    authenticationType: "Integrated",
    profileName: "Alpha",
};
const NO_SECRETS = {
    lookupPassword: async () => {
        throw new Error("integrated auth must not look up a password");
    },
};

function cacheSettings(overrides?: Partial<MetadataCacheSettings>): MetadataCacheSettings {
    return {
        ...DEFAULT_METADATA_CACHE_SETTINGS,
        enabled: true,
        writeDelayMs: 15,
        ...overrides,
        policyId: cachePolicyId({ persistDescriptions: false, persistModuleDefinitions: false }),
    };
}

function makeCache(fs = new MemFs()) {
    const store = new MetadataCacheStore(fs, "root");
    const coordinator = new MetadataCacheCoordinator(store, () => cacheSettings());
    return { fs, coordinator };
}

/** Fixture catalog: one table, healthy digest, mutable H1 failure flag. */
function catalogScripts(tableName: string, state?: { h1Fails?: () => boolean }): FakeScript[] {
    return [
        {
            match: (t) => t.includes("extended_properties"),
            events: [
                {
                    type: "resultSet",
                    columns: ["major_id", "minor_id", "column_name", "description"],
                    rows: [],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("SERVERPROPERTY"),
            events: [
                {
                    type: "resultSet",
                    columns: ["engine_edition", "default_schema", "collation_name"],
                    rows: [[5, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("is_primary_key"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "object_id",
                        "name",
                        "index_name",
                        "is_primary_key",
                        "is_unique_constraint",
                    ],
                    rows: [],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("foreign_key_columns"),
            events: [
                {
                    type: "resultSet",
                    columns: ["constraint_object_id", "parent_column", "referenced_column"],
                    rows: [],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.parameters"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "object_id",
                        "parameter_id",
                        "name",
                        "type_name",
                        "max_length",
                        "precision",
                        "scale",
                        "is_output",
                    ],
                    rows: [],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        state?.h1Fails
            ? {
                  match: (t) => t.includes("sys.schemas"),
                  events: [], // replaced dynamically below (evaluated per test)
              }
            : {
                  match: (t) => t.includes("sys.schemas"),
                  events: [
                      { type: "resultSet", columns: ["schema_id", "name"], rows: [[1, "dbo"]] },
                      { type: "complete", status: "succeeded" },
                  ],
              },
        {
            // digest — BEFORE H2 (CHEAP_DIGEST contains H2's substring)
            match: (t) => t.includes("CHECKSUM_AGG"),
            events: [
                {
                    type: "resultSet",
                    columns: ["current_db", "object_count", "object_hash"],
                    rows: [["DbA", 1, 4242]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("FROM sys.objects o WHERE"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_id", "schema_id", "name", "type", "modify_date"],
                    rows: [[101, 1, tableName, "U", "2026-01-01T00:00:00"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.columns"),
            events: [
                {
                    type: "resultSet",
                    columns: [
                        "object_id",
                        "column_id",
                        "name",
                        "type_name",
                        "max_length",
                        "precision",
                        "scale",
                        "is_nullable",
                        "is_identity",
                        "is_computed",
                    ],
                    rows: [[101, 1, "Id", "int", 4, 10, 0, false, false, false]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            match: (t) => t.includes("sys.foreign_keys"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_id", "name", "parent_object_id", "referenced_object_id"],
                    rows: [],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
    ];
}

/** A gen-42 snapshot eligible for the §14 save rule. */
function diskSnapshot(tableName: string, generation = 42) {
    const b = new CatalogBuilder();
    b.setEnvironment({ defaultSchema: "dbo", caseSensitive: false });
    b.addSchema(1, "dbo");
    b.addObject(9001, 1, tableName, "table");
    b.addColumn(9001, "Id", "int", false);
    return b.build(generation, { schemas: "ready", objects: "ready", columns: "ready" }, "partial");
}

const ENGINE_KEY = { serverFingerprint: "sfp_cacheTest", database: "DbA" };

suite("MetadataStore cache integration (CACHE-3)", () => {
    test("engine: publishExternalSnapshot serves with ZERO sessions; never clobbers live data", async () => {
        const backend = new FakeBackend({ scripts: catalogScripts("LiveTable") });
        const source = new DataPlaneMetadataSessionSource(backend, {
            profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
            applicationName: "test",
        });
        const service = new MetadataService(source, { pollSeconds: 0 });
        const applied = service.publishExternalSnapshot(ENGINE_KEY, diskSnapshot("DiskTable"));
        expect(applied).to.equal(true);
        const handle = service.acquire(ENGINE_KEY);
        expect(handle.status().readiness).to.equal("ready");
        expect(handle.status().generation).to.equal(42);
        expect(handle.current()!.listObjects()[0].name).to.equal("DiskTable");
        // No network was touched to serve the disk snapshot.
        expect(backend.sessions.length).to.equal(0);
        // A second publish must not clobber the existing snapshot.
        expect(service.publishExternalSnapshot(ENGINE_KEY, diskSnapshot("Other", 99))).to.equal(
            false,
        );
        expect(handle.status().generation).to.equal(42);
        handle.dispose();
        service.dispose();
    });

    test("C-4.2: first digest compares against the MANIFEST digest — match validates, mismatch refreshes", async () => {
        // Match case: manifest digest equals what the live digest will say.
        {
            const backend = new FakeBackend({ scripts: catalogScripts("LiveTable") });
            const source = new DataPlaneMetadataSessionSource(backend, {
                profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
                applicationName: "test",
            });
            const service = new MetadataService(source, { pollSeconds: 0 });
            service.publishExternalSnapshot(ENGINE_KEY, diskSnapshot("DiskTable"), {
                manifestDigest: "1:4242",
            });
            const handle = service.acquire(ENGINE_KEY);
            const result = await handle.ensureFresh({
                mode: "requireValidated",
                reason: "oeBrowse",
                validationTtlMs: 1,
            });
            expect(result.freshness).to.equal("validated");
            expect(result.validation?.result).to.equal("unchanged");
            // Validated WITHOUT a full re-hydration: generation unchanged.
            expect(handle.status().generation).to.equal(42);
            handle.dispose();
            service.dispose();
        }
        // Mismatch case: the cache was already wrong ⇒ forced refresh.
        {
            const backend = new FakeBackend({ scripts: catalogScripts("LiveTable") });
            const source = new DataPlaneMetadataSessionSource(backend, {
                profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
                applicationName: "test",
            });
            const service = new MetadataService(source, { pollSeconds: 0 });
            service.publishExternalSnapshot(ENGINE_KEY, diskSnapshot("DiskTable"), {
                manifestDigest: "1:9999",
            });
            const handle = service.acquire(ENGINE_KEY);
            const result = await handle.ensureFresh({
                mode: "requireValidated",
                reason: "oeBrowse",
                validationTtlMs: 1,
            });
            expect(result.validation?.result).to.equal("changed");
            expect(result.validation?.staleReason).to.equal("digestMismatch");
            // The refresh published a strictly greater LIVE generation.
            expect(handle.status().generation).to.equal(43);
            expect(handle.current()!.listObjects()[0].name).to.equal("LiveTable");
            handle.dispose();
            service.dispose();
        }
    });

    test("T-A12 (C-4.3): failed refresh over a retained snapshot re-arms with backoff and recovers", async () => {
        let h1Fails = false;
        const scripts = catalogScripts("LiveTable");
        // Make H1 responses controllable (replace the static fixture).
        const h1Index = scripts.findIndex((s) =>
            (s.match as (t: string) => boolean)("SELECT schema_id, name FROM sys.schemas x"),
        );
        const okEvents = scripts[h1Index].events;
        const failEvents: FakeScript["events"] = [
            { type: "message", kind: "error", text: "transient failure" },
            { type: "complete", status: "failed" },
        ];
        scripts[h1Index] = {
            match: (t) => t.includes("sys.schemas"),
            get events() {
                return h1Fails ? failEvents : okEvents;
            },
        } as unknown as FakeScript;

        const backend = new FakeBackend({ scripts });
        const source = new DataPlaneMetadataSessionSource(backend, {
            profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
            applicationName: "test",
        });
        const service = new MetadataService(source, {
            pollSeconds: 0,
            retryBackoffMs: [25, 50, 75],
        });
        const handle = service.acquire(ENGINE_KEY);
        await handle.refresh();
        expect(handle.status().readiness).to.equal("ready");
        const baseGeneration = handle.status().generation;

        h1Fails = true;
        await handle.refresh(); // H1 is a HARD pass: hydration fails
        expect(handle.status().readiness).to.equal("failed");
        expect(handle.current(), "snapshot retained through the failure").to.not.equal(undefined);

        h1Fails = false;
        // The 25ms backoff retry recovers without any new acquire/refresh.
        await sleep(120);
        expect(handle.status().readiness).to.equal("ready");
        expect(handle.status().generation).to.be.greaterThan(baseGeneration);
        handle.dispose();
        service.dispose();
    });

    test("store: disk snapshot serves at manifest generation, C-4.1 background refresh follows, live saves back", async () => {
        const { fs, coordinator } = makeCache();
        // Seed disk under the SAME key the acquire path derives.
        const prepared = prepareConnection(PROFILE, NO_SECRETS);
        const key = { serverFingerprint: prepared.serverFingerprint, database: "DbA" };
        const real = await coordinator.saveNow(key, diskSnapshot("DiskTable"));
        expect(real.result).to.equal("saved");

        const backend = new FakeBackend({ scripts: catalogScripts("LiveTable") });
        const store = new MetadataStore(async () => backend, {
            pollSeconds: 0,
            cache: { coordinator },
        });
        const lease = await store.acquireDatabase(prepared, "DbA");

        // Disk generation 42 was published into the entry (status may have
        // already advanced if the background refresh won the race — accept
        // either, but the store MUST record the disk load).
        expect(store.status().cache).to.deep.equal({ enabled: true, loadedFromDisk: 1 });

        // C-4.1: the background live hydration lands a strictly greater
        // generation and flips the source to "live".
        await sleep(80);
        expect(lease.status().generation).to.be.greaterThan(42);
        expect(lease.current()!.listObjects()[0].name).to.equal("LiveTable");
        expect(store.status().databases[0].source).to.equal("live");

        // The live generation saved BACK to disk (debounced).
        await sleep(120);
        const manifestPath = [...fs.files.keys()].find(
            (p) => p.includes("databases/") && p.endsWith("manifest.json"),
        )!;
        const manifest = JSON.parse(Buffer.from(fs.files.get(manifestPath)!).toString("utf8"));
        expect(manifest.capture.publishedGeneration).to.be.greaterThan(42);

        lease.dispose();
        store.dispose();
    });

    test("store: offline mode serves the disk snapshot with NO background refresh", async () => {
        const { coordinator } = makeCache();
        const prepared = prepareConnection(PROFILE, NO_SECRETS);
        const key = { serverFingerprint: prepared.serverFingerprint, database: "DbA" };
        expect((await coordinator.saveNow(key, diskSnapshot("DiskTable"))).result).to.equal(
            "saved",
        );

        const backend = new FakeBackend({ scripts: catalogScripts("LiveTable") });
        const store = new MetadataStore(async () => backend, {
            pollSeconds: 0,
            cache: { coordinator, offlineMode: () => true },
        });
        const lease = await store.acquireDatabase(prepared, "DbA");
        await sleep(60);
        expect(lease.status().generation).to.equal(42);
        expect(lease.current()!.listObjects()[0].name).to.equal("DiskTable");
        expect(store.status().databases[0].source).to.equal("disk");
        // No metadata session was ever opened.
        expect(backend.sessions.length).to.equal(0);
        lease.dispose();
        store.dispose();
    });

    test("T-A18: A/B isolation and the key-correctness tripwire hold with the cache enabled", async () => {
        class RoutingService implements ISqlConnectionService {
            constructor(
                private readonly byDatabase: Record<string, FakeBackend>,
                readonly fallback: FakeBackend,
            ) {}
            get availability() {
                return this.fallback.availability;
            }
            get onDidChangeAvailability() {
                return this.fallback.onDidChangeAvailability;
            }
            get backendInfo() {
                return this.fallback.backendInfo;
            }
            canOpen() {
                return this.fallback.canOpen();
            }
            openSession(params: OpenSessionParams): Promise<ISqlSession> {
                const backend =
                    (params.database && this.byDatabase[params.database]) || this.fallback;
                return backend.openSession(params);
            }
        }
        const { coordinator } = makeCache(); // EMPTY disk: every load is a miss
        const backendA = new FakeBackend({ scripts: catalogScripts("AlphaOnly") });
        const backendB = new FakeBackend({ scripts: catalogScripts("BetaOnly") });
        const service = new RoutingService({ DbA: backendA, DbB: backendB }, new FakeBackend({}));
        const store = new MetadataStore(async () => service, {
            pollSeconds: 0,
            cache: { coordinator },
        });
        const prepared = prepareConnection(PROFILE, NO_SECRETS);
        const [leaseA, leaseB] = await Promise.all([
            store.acquireDatabase(prepared, "DbA"),
            store.acquireDatabase(prepared, "DbB"),
        ]);
        await Promise.all([leaseA.refresh(), leaseB.refresh()]);
        expect(backendA.sessions[0].info.database).to.equal("DbA");
        expect(backendB.sessions[0].info.database).to.equal("DbB");
        expect(
            leaseA
                .current()!
                .listObjects()
                .map((o) => o.name),
        ).to.deep.equal(["AlphaOnly"]);
        expect(
            leaseB
                .current()!
                .listObjects()
                .map((o) => o.name),
        ).to.deep.equal(["BetaOnly"]);
        expect(store.status().keyCorrectnessViolations).to.equal(0);
        leaseA.dispose();
        leaseB.dispose();
        store.dispose();
    });
});
