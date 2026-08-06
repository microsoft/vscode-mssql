/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MetadataStore (OE v2 B15): non-reversible fingerprints, shared profile
 * preparation, KEY-CORRECT multi-database catalog acquisition (A/B isolation
 * over per-database sessions), lease refcounting + idle TTL + LRU cap,
 * server catalog readiness honesty (failure ≠ empty), the key-correctness
 * violation tripwire, and a privacy canary over store status.
 */

import { expect } from "chai";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import type { DiagEvent } from "../../src/sharedInterfaces/debugConsole";
import {
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
} from "../../src/services/sqlDataPlane/api";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    identityDigest,
    profileFingerprint,
    serverFingerprint,
} from "../../src/services/metadata/profileFingerprint";
import {
    prepareConnection,
    resolveAuthKind,
    StoredConnectionProfile,
    UnsupportedProfileAuthenticationError,
} from "../../src/services/metadata/profileAuthAdapter";
import { MetadataStore } from "../../src/services/metadata/metadataStore";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal H-series scripts for one user table (H4/H5B before H3 — the
 *  "sys.columns" substring matches those first; H7 uses COL_NAME so it
 *  collides with nothing). */
function catalogScripts(tableName: string): FakeScript[] {
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
        {
            match: (t) => t.includes("sys.schemas"),
            events: [
                { type: "resultSet", columns: ["schema_id", "name"], rows: [[1, "dbo"]] },
                { type: "complete", status: "succeeded" },
            ],
        },
        {
            // digest — BEFORE H2: CHEAP_DIGEST contains "FROM sys.objects o
            // WHERE" too (a digest fixture ordered after H2 is dead).
            match: (t) => t.includes("CHECKSUM_AGG"),
            events: [
                {
                    type: "resultSet",
                    columns: ["current_db", "object_count", "object_hash"],
                    rows: [["Db1", 1, 111]],
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

/** Routes openSession to a per-database FakeBackend (key-correctness tests). */
class RoutingFakeService implements ISqlConnectionService {
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
        const backend = (params.database && this.byDatabase[params.database]) || this.fallback;
        return backend.openSession(params);
    }
}

/** Drops params.database — simulates a backend that ignores the requested
 *  database (the key-correctness violation the tripwire must catch). */
class DatabaseIgnoringService implements ISqlConnectionService {
    constructor(readonly backend: FakeBackend) {}
    get availability() {
        return this.backend.availability;
    }
    get onDidChangeAvailability() {
        return this.backend.onDidChangeAvailability;
    }
    get backendInfo() {
        return this.backend.backendInfo;
    }
    canOpen() {
        return this.backend.canOpen();
    }
    openSession(params: OpenSessionParams): Promise<ISqlSession> {
        const stripped: OpenSessionParams = { ...params };
        delete stripped.database;
        return this.backend.openSession(stripped);
    }
}

const INTEGRATED: StoredConnectionProfile = {
    server: "srv-alpha.example.internal",
    database: "DbDefault",
    authenticationType: "Integrated",
    profileName: "Alpha",
};

const NO_SECRETS = {
    lookupPassword: async () => {
        throw new Error("integrated auth must not look up a password");
    },
};

suite("MetadataStore (B15)", () => {
    test("fingerprints: stable, scope-correct, non-reversible", () => {
        const input = {
            server: "srv-alpha.example.internal",
            database: "DbA",
            user: "sa-admin",
            authKind: "sql",
        };
        expect(profileFingerprint(input)).to.equal(profileFingerprint({ ...input }));
        expect(profileFingerprint(input)).to.match(/^pfp_[A-Za-z0-9_-]{22}$/);
        expect(serverFingerprint(input)).to.match(/^sfp_[A-Za-z0-9_-]{22}$/);
        // database changes the profile fingerprint but NOT the server one
        const otherDb = { ...input, database: "DbB" };
        expect(profileFingerprint(otherDb)).to.not.equal(profileFingerprint(input));
        expect(serverFingerprint(otherDb)).to.equal(serverFingerprint(input));
        // different server = different server identity
        expect(serverFingerprint({ ...input, server: "other" })).to.not.equal(
            serverFingerprint(input),
        );
        // non-reversible: no identity substrings survive
        for (const value of [
            profileFingerprint(input),
            serverFingerprint(input),
            identityDigest("x", "srv-alpha.example.internal|sa-admin"),
        ]) {
            expect(value).to.not.contain("srv-alpha");
            expect(value).to.not.contain("sa-admin");
            expect(value).to.not.contain("DbA");
        }
    });

    test("prepareConnection: ref shape, auth closure, integrated never touches secrets", async () => {
        const prepared = prepareConnection(INTEGRATED, NO_SECRETS);
        expect(prepared.authKind).to.equal("integrated");
        expect(prepared.profileRef.server).to.equal(INTEGRATED.server);
        expect(prepared.profileRef.database).to.equal("DbDefault");
        expect(prepared.profileRef.displayName).to.equal("Alpha");
        expect(prepared.serverFingerprint).to.match(/^sfp_/);
        expect(prepared.defaultDatabase).to.equal("DbDefault");
        // Integrated auth has no provider and never touches the credential store.
        expect(prepared.auth.passwordProvider).to.equal(undefined);
        expect(prepared.auth.tokenProvider).to.equal(undefined);

        let lookups = 0;
        const sqlPrepared = prepareConnection(
            { server: "s", user: "u", authenticationType: "SqlLogin" },
            { lookupPassword: async () => (lookups++, "pw-value") },
        );
        expect(resolveAuthKind({ authenticationType: "SqlLogin" })).to.equal("sql");
        expect(await sqlPrepared.auth.passwordProvider!()).to.equal("pw-value");
        expect(lookups).to.equal(1);

        const portPrepared = prepareConnection(
            {
                server: "localhost",
                port: 31433,
                user: "sa",
                authenticationType: "SqlLogin",
            },
            { lookupPassword: async () => "run-scoped-secret" },
        );
        expect(portPrepared.profileRef.server).to.equal("localhost,31433");
        expect(portPrepared.profileRef.profileFingerprint).to.not.equal(
            prepareConnection(
                { server: "localhost", port: 31434, user: "sa", authenticationType: "SqlLogin" },
                NO_SECRETS,
            ).profileRef.profileFingerprint,
        );
    });

    test("prepareConnection: AzureMFA uses deferred SQL token and isolates Entra identities", async () => {
        let passwordLookups = 0;
        let tokenLookups = 0;
        const profile: StoredConnectionProfile = {
            server: "ninja.database.windows.net",
            database: "ninjadb",
            authenticationType: "AzureMFA",
            // Classic profile normalization may persist an empty user for AzureMFA.
            user: "",
            email: "ninja@example.test",
            accountId: "account-a",
            tenantId: "tenant-a",
        };
        const prepared = prepareConnection(
            profile,
            { lookupPassword: async () => (passwordLookups++, "wrong-secret") },
            { acquireSqlAccessToken: async () => (tokenLookups++, "sql-token") },
        );

        expect(prepared.authKind).to.equal("aad");
        expect(prepared.profileRef.authKind).to.equal("aad");
        expect(prepared.profileRef.user).to.equal("ninja@example.test");
        expect(prepared.auth.passwordProvider).to.equal(undefined);
        expect(passwordLookups).to.equal(0);
        expect(tokenLookups).to.equal(0);
        expect(await prepared.auth.tokenProvider!()).to.equal("sql-token");
        expect(tokenLookups).to.equal(1);

        const otherAccount = prepareConnection({ ...profile, accountId: "account-b" }, NO_SECRETS, {
            acquireSqlAccessToken: async () => "other-token",
        });
        expect(otherAccount.profileRef.profileFingerprint).to.not.equal(
            prepared.profileRef.profileFingerprint,
        );
        expect(otherAccount.serverFingerprint).to.not.equal(prepared.serverFingerprint);
        for (const fingerprint of [
            prepared.profileRef.profileFingerprint,
            prepared.serverFingerprint,
        ]) {
            expect(fingerprint).to.not.include("ninja");
            expect(fingerprint).to.not.include("account-a");
            expect(fingerprint).to.not.include("tenant-a");
        }
    });

    test("profile auth mapping is exhaustive and never coerces unsupported Entra modes", () => {
        expect(resolveAuthKind({})).to.equal("sql");
        expect(resolveAuthKind({ authenticationType: "SqlLogin" })).to.equal("sql");
        expect(resolveAuthKind({ authenticationType: "Integrated" })).to.equal("integrated");
        expect(resolveAuthKind({ authenticationType: "AzureMFA" })).to.equal("aad");
        expect(resolveAuthKind({ authenticationType: "ActiveDirectoryInteractive" })).to.equal(
            "aad",
        );
        for (const authenticationType of [
            "ActiveDirectoryDefault",
            "ActiveDirectoryServicePrincipal",
            "unknown-auth",
        ]) {
            expect(() => resolveAuthKind({ authenticationType })).to.throw(
                UnsupportedProfileAuthenticationError,
            );
        }
    });

    test("acquireDatabase: A and B are key-correct and isolated (concurrent)", async () => {
        const backendA = new FakeBackend({ scripts: catalogScripts("AlphaOnly") });
        const backendB = new FakeBackend({ scripts: catalogScripts("BetaOnly") });
        const service = new RoutingFakeService(
            { DbA: backendA, DbB: backendB },
            new FakeBackend({}),
        );
        const store = new MetadataStore(async () => service, { pollSeconds: 0 });
        const prepared = prepareConnection(INTEGRATED, NO_SECRETS);

        const [leaseA, leaseB] = await Promise.all([
            store.acquireDatabase(prepared, "DbA"),
            store.acquireDatabase(prepared, "DbB"),
        ]);
        await Promise.all([leaseA.refresh(), leaseB.refresh()]);

        // Sessions opened IN the keyed database (key-correct by construction)
        expect(backendA.sessions[0].info.database).to.equal("DbA");
        expect(backendB.sessions[0].info.database).to.equal("DbB");

        const namesA = leaseA
            .current()!
            .listObjects()
            .map((o) => o.name);
        const namesB = leaseB
            .current()!
            .listObjects()
            .map((o) => o.name);
        expect(namesA).to.deep.equal(["AlphaOnly"]);
        expect(namesB).to.deep.equal(["BetaOnly"]);

        // Refresh A while B re-hydrates — still no cross-contamination
        await Promise.all([leaseA.refresh(), leaseB.refresh()]);
        expect(
            leaseA
                .current()!
                .listObjects()
                .map((o) => o.name),
        ).to.deep.equal(["AlphaOnly"]);

        leaseA.dispose();
        leaseB.dispose();
        store.dispose();
    });

    test("leases share one engine per key; warm re-acquire is a cache hit", async () => {
        const backend = new FakeBackend({ scripts: catalogScripts("T") });
        const store = new MetadataStore(async () => backend, {
            pollSeconds: 0,
            idleTtlMs: 60_000,
        });
        const prepared = prepareConnection(INTEGRATED, NO_SECRETS);

        const first = await store.acquireDatabase(prepared, "DbA");
        const second = await store.acquireDatabase(prepared, "DbA");
        expect(store.status().databases).to.have.length(1);
        expect(backend.sessions).to.have.length(1); // one dedicated session

        first.dispose();
        expect(store.status().databases[0].refCount).to.equal(1);
        second.dispose();
        second.dispose(); // double-dispose is inert
        const status = store.status();
        expect(status.databases).to.have.length(1); // warm within TTL
        expect(status.databases[0].idle).to.equal(true);

        const third = await store.acquireDatabase(prepared, "DbA");
        expect(store.status().databases[0].refCount).to.equal(1);
        expect(backend.sessions).to.have.length(1); // reused, not reopened
        third.dispose();
        store.dispose();
    });

    test("idle TTL disposes the engine; LRU cap evicts oldest idle first", async () => {
        const backend = new FakeBackend({ scripts: catalogScripts("T") });
        const ttlStore = new MetadataStore(async () => backend, {
            pollSeconds: 0,
            idleTtlMs: 5,
        });
        const prepared = prepareConnection(INTEGRATED, NO_SECRETS);
        (await ttlStore.acquireDatabase(prepared, "DbA")).dispose();
        await sleep(30);
        expect(ttlStore.status().databases).to.have.length(0);
        ttlStore.dispose();

        const lruStore = new MetadataStore(async () => backend, {
            pollSeconds: 0,
            idleTtlMs: 60_000,
            maxIdleDatabases: 1,
        });
        (await lruStore.acquireDatabase(prepared, "DbA")).dispose();
        await sleep(2); // distinct release timestamps
        (await lruStore.acquireDatabase(prepared, "DbB")).dispose();
        const keys = lruStore.status().databases;
        expect(keys).to.have.length(1); // DbA (oldest idle) evicted
        lruStore.dispose();
    });

    test("server catalog: access states + system classification; failure is not empty", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("sys.databases"),
                    events: [
                        {
                            type: "resultSet",
                            columns: [
                                "database_id",
                                "name",
                                "state_desc",
                                "is_read_only",
                                "user_access_desc",
                                "compatibility_level",
                                "has_dbaccess",
                            ],
                            rows: [
                                [5, "AppDb", "ONLINE", false, "MULTI_USER", 160, 1],
                                [6, "Locked", "ONLINE", false, "MULTI_USER", 160, 0],
                                [1, "master", "ONLINE", false, "MULTI_USER", 160, 1],
                                [7, "Mystery", "RESTORING", true, "MULTI_USER", 150, null],
                            ],
                        },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const store = new MetadataStore(async () => backend, { pollSeconds: 0 });
        const prepared = prepareConnection(INTEGRATED, NO_SECRETS);
        const lease = await store.acquireServer(prepared);
        await lease.refresh();

        expect(lease.status().readiness).to.equal("ready");
        expect(lease.status().generation).to.be.greaterThan(0);
        const pinned = lease.pin();
        const list = pinned.listDatabases()!;
        expect(list.map((d) => d.name)).to.deep.equal(["AppDb", "Locked", "master", "Mystery"]);
        expect(pinned.getDatabase("Locked")!.accessState).to.equal("inaccessible");
        expect(pinned.getDatabase("Mystery")!.accessState).to.equal("unknown");
        expect(pinned.getDatabase("Mystery")!.state).to.equal("RESTORING");
        expect(pinned.getDatabase("AppDb")!.accessState).to.equal("accessible");
        expect(pinned.getDatabase("master")!.isSystem).to.equal(true);
        expect(pinned.getDatabase("AppDb")!.isSystem).to.equal(false);
        lease.dispose();
        store.dispose();

        // failure path: readiness failed, list undefined — NOT an empty array
        const failing = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("sys.databases"),
                    events: [
                        { type: "message", kind: "error", text: "permission denied" },
                        { type: "complete", status: "failed" },
                    ],
                },
            ],
        });
        const failStore = new MetadataStore(async () => failing, { pollSeconds: 0 });
        const failLease = await failStore.acquireServer(prepared);
        await failLease.refresh();
        expect(failLease.status().readiness).to.equal("failed");
        expect(failLease.pin().listDatabases()).to.equal(undefined);
        failLease.dispose();
        failStore.dispose();
    });

    test("key-correctness tripwire: backend ignoring the database is counted", async () => {
        const backend = new FakeBackend({
            scripts: catalogScripts("T"),
            database: "WrongDb",
        });
        const service = new DatabaseIgnoringService(backend);
        const store = new MetadataStore(async () => service, { pollSeconds: 0 });
        const prepared = prepareConnection({ ...INTEGRATED, database: undefined }, NO_SECRETS);
        const lease = await store.acquireDatabase(prepared, "DbX");
        await lease.refresh().catch(() => undefined);
        expect(store.status().keyCorrectnessViolations).to.be.greaterThan(0);
        lease.dispose();
        store.dispose();
    });

    test("privacy canary: fingerprints and status dumps leak no identity", async () => {
        const stored: StoredConnectionProfile = {
            server: "secret-server.example.internal",
            database: "SecretDb",
            user: "user@example.com",
            authenticationType: "SqlLogin",
        };
        const prepared = prepareConnection(stored, {
            lookupPassword: async () => "Password=hunter2",
        });
        expect(prepared.profileRef.profileFingerprint).to.not.contain("secret-server");
        expect(prepared.serverFingerprint).to.not.contain("secret-server");

        const backend = new FakeBackend({ scripts: catalogScripts("T") });
        const store = new MetadataStore(async () => backend, { pollSeconds: 0 });
        const lease = await store.acquireDatabase(prepared, "SecretDb");
        await lease.refresh();
        const dump = JSON.stringify(store.status());
        for (const leak of ["secret-server", "user@example.com", "hunter2", "Password="]) {
            expect(dump).to.not.contain(leak);
        }
        lease.dispose();
        store.dispose();
    });

    test("metadata failure spans keep provider identity messages out of diagnostics", async () => {
        const events: DiagEvent[] = [];
        const sinkId = `metadata-auth-privacy-${Date.now()}`;
        diag.addSink({ id: sinkId, tryWrite: (event) => events.push(event) });
        const canary = "account-canary@example.test tenant-canary provider details";
        const service = {
            availability: { state: "available" as const, backend: "test", capabilities: {} },
            onDidChangeAvailability: () => ({ dispose: () => undefined }),
            backendInfo: { kind: "test" },
            canOpen: async () => ({ ok: true }),
            openSession: async () => {
                const error = new Error(canary);
                (error as Error & { code: string }).code = "SqlDataPlane.Auth";
                throw error;
            },
        } as unknown as ISqlConnectionService;
        const store = new MetadataStore(async () => service, { pollSeconds: 0 });
        const prepared = prepareConnection(INTEGRATED, NO_SECRETS);
        try {
            const lease = await store.acquireDatabase(prepared, "DbDefault");
            await lease.refresh().catch(() => undefined);
            const serialized = JSON.stringify(events);
            expect(serialized).to.not.include("account-canary@example.test");
            expect(serialized).to.not.include("tenant-canary");
            expect(serialized).to.include("SqlDataPlane.Auth");
            lease.dispose();
        } finally {
            store.dispose();
            diag.removeSink(sinkId);
        }
    });
});
