/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-5 poll governance + rename identity (addendum H-3/H-5):
 * - T-A16 (H-3.1): window-focus loss beyond the grace suspends the digest
 *   poll; refocus resumes with an IMMEDIATE tick.
 * - H-3.2: consecutive no-change polls stretch the per-entry cadence toward
 *   the cap; user execution against the database resets it to base.
 * - H-3.3: serverless/auto-pause engine editions (5/8/11/12) poll AT the
 *   cap from the first scheduled digest.
 * - H-3.4: the store-wide semaphore caps concurrent digest validations
 *   across entries (default 2); intervals carry ±10% jitter (pure bounds).
 * - T-A15 (H-5): a database rename under a live lease fires driftRename
 *   EXACTLY once, strict modes fail actionably with accessChanged,
 *   allowStale keeps serving the retained snapshot, and the poll stops.
 */

import { expect } from "chai";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { ISqlSession, QueryHandle } from "../../src/services/sqlDataPlane/api";
import {
    DEFAULT_POLL_BACKOFF_MULTIPLIERS,
    jitteredPollDelayMs,
    MetadataService,
    MetadataSessionSource,
    MetadataValidationLimiter,
} from "../../src/services/metadata/metadataService";
import { MetadataStore } from "../../src/services/metadata/metadataStore";
import { prepareConnection } from "../../src/services/metadata/profileAuthAdapter";

const KEY = { serverFingerprint: "sha256:test", database: "Db1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}
function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
}

interface FixtureOptions {
    /** H0 engine edition (3 = on-prem default; 5/8/11/12 = serverless family). */
    edition?: number;
    /** Live DB_NAME() answer for the digest identity rider (H-5). */
    currentDb?: () => string;
    counters: { digest: number };
}

/** Small catalog: H0 + H1 + digest (BEFORE H2 — matcher discipline) + H2. */
function baseScripts(opts: FixtureOptions): FakeScript[] {
    return [
        {
            match: (t) => t.includes("SERVERPROPERTY"),
            events: [
                {
                    type: "resultSet",
                    columns: ["engine_edition", "default_schema", "collation_name"],
                    rows: [[opts.edition ?? 3, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
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
            match: (t) => {
                const hit = t.includes("CHECKSUM_AGG");
                if (hit) {
                    opts.counters.digest++;
                }
                return hit;
            },
            get events() {
                return [
                    {
                        type: "resultSet",
                        columns: ["current_db", "object_count", "object_hash"],
                        rows: [[(opts.currentDb ?? (() => "Db1"))(), 1, 4242]],
                    },
                    { type: "complete", status: "succeeded" },
                ];
            },
        } as unknown as FakeScript,
        {
            match: (t) => t.includes("FROM sys.objects o WHERE"),
            events: [
                {
                    type: "resultSet",
                    columns: ["object_id", "schema_id", "name", "type", "modify_date"],
                    rows: [[101, 1, "Orders", "U", "2026-01-01T00:00:00"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
    ];
}

/**
 * Session source with a gate hook (delays a matching query until released)
 * — same harness shape as metadataFreshness.test.ts.
 */
class ControlledSource implements MetadataSessionSource {
    opens = 0;
    gate: ((text: string) => Promise<void> | undefined) | undefined;
    private session: ISqlSession | undefined;

    constructor(private readonly backend: FakeBackend) {}

    async open(): Promise<ISqlSession> {
        if (this.session && this.session.state === "open") {
            return this.session;
        }
        this.opens++;
        const real = await this.backend.openSession({
            profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
            applicationName: "test",
        });
        const source = this;
        this.session = new Proxy(real, {
            get(target, prop) {
                if (prop === "execute") {
                    return (
                        text: string,
                        opts: Parameters<ISqlSession["execute"]>[1],
                        sink: Parameters<ISqlSession["execute"]>[2],
                    ): QueryHandle => {
                        const pending = source.gate?.(text);
                        if (pending) {
                            return {
                                clientQueryId: "gated",
                                completion: pending.then(
                                    () => target.execute(text, opts, sink).completion,
                                ),
                                cancel: () => new Promise(() => {}),
                                dispose: () => Promise.resolve(),
                            } as unknown as QueryHandle;
                        }
                        return target.execute(text, opts, sink);
                    };
                }
                const value = Reflect.get(target, prop, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        }) as ISqlSession;
        return this.session;
    }

    recycle(): void {
        this.session = undefined;
    }
}

function makeService(
    fixture: FixtureOptions,
    options?: ConstructorParameters<typeof MetadataService>[1],
) {
    const backend = new FakeBackend({ scripts: baseScripts(fixture) });
    const source = new ControlledSource(backend);
    const service = new MetadataService(source, { pollSeconds: 0, ...options });
    return { service, source };
}

suite("Metadata poll governance (CACHE-5)", () => {
    test("H-3.4 jitter bounds (pure): 60s→120s→300s ladder stays within ±10%", () => {
        const M = DEFAULT_POLL_BACKOFF_MULTIPLIERS;
        expect(jitteredPollDelayMs(60_000, M, 0, () => 0)).to.equal(54_000);
        expect(jitteredPollDelayMs(60_000, M, 0, () => 1)).to.equal(66_000);
        expect(jitteredPollDelayMs(60_000, M, 1, () => 0)).to.equal(108_000);
        expect(jitteredPollDelayMs(60_000, M, 1, () => 1)).to.equal(132_000);
        expect(jitteredPollDelayMs(60_000, M, 2, () => 0)).to.equal(270_000);
        expect(jitteredPollDelayMs(60_000, M, 2, () => 1)).to.equal(330_000);
        // Levels beyond the ladder clamp at the cap; 0.5 = no jitter.
        expect(jitteredPollDelayMs(60_000, M, 99, () => 0.5)).to.equal(300_000);
    });

    test("T-A16: focus loss beyond the grace suspends the digest poll", async () => {
        const counters = { digest: 0 };
        let active = true;
        const { service } = makeService(
            { counters },
            {
                pollSeconds: 0.05,
                pollBackoffMultipliers: [1], // constant cadence for the test
                isActive: () => active,
                inactiveGraceMs: 30,
                focusRecheckMs: 10,
            },
        );
        const handle = service.acquire(KEY);
        await handle.refresh();
        await sleep(250);
        expect(counters.digest, "focused window polls").to.be.greaterThan(1);

        active = false;
        await sleep(150); // grace (30ms) + recheck (10ms) + in-flight settle
        const frozen = counters.digest;
        await sleep(250);
        expect(counters.digest, "unfocused beyond grace ⇒ suspended").to.equal(frozen);
        handle.dispose();
        service.dispose();
    });

    test("T-A16: refocus resumes with an IMMEDIATE tick (not the next interval)", async () => {
        const counters = { digest: 0 };
        let active = true;
        const { service } = makeService(
            { counters },
            {
                // Base cadence far beyond the test window: any digest after
                // refocus can ONLY come from the immediate resume tick.
                pollSeconds: 600,
                pollBackoffMultipliers: [1],
                isActive: () => active,
                inactiveGraceMs: 20,
                focusRecheckMs: 10,
            },
        );
        const handle = service.acquire(KEY);
        await handle.refresh();
        expect(counters.digest).to.equal(0);

        active = false;
        await sleep(80); // beyond grace ⇒ suspended (pending timer cleared)
        active = true;
        await sleep(120);
        expect(counters.digest, "immediate tick on focus").to.be.greaterThan(0);
        handle.dispose();
        service.dispose();
    });

    test("H-3.2: no-change polls stretch the cadence; user execution resets to base", async () => {
        const counters = { digest: 0 };
        const { service } = makeService(
            { counters },
            {
                pollSeconds: 0.04,
                // Strong contrast: one unchanged poll jumps the interval to
                // ~1s, so a second digest inside the test window proves the
                // reset — it could never be the backoff schedule.
                pollBackoffMultipliers: [1, 25],
            },
        );
        const handle = service.acquire(KEY);
        await handle.refresh();
        await sleep(150);
        expect(counters.digest, "first poll ran, then backed off").to.equal(1);

        handle.notifyExecutedBatch({ text: "select 1", succeeded: true });
        await sleep(200);
        expect(counters.digest, "execution reset the cadence to base").to.be.greaterThan(1);
        handle.dispose();
        service.dispose();
    });

    test("H-3.3: serverless engine editions start polling at the backoff cap", async () => {
        const serverlessCounters = { digest: 0 };
        const { service: serverless } = makeService(
            { counters: serverlessCounters, edition: 5 },
            { pollSeconds: 0.04, pollBackoffMultipliers: [1, 2, 5] },
        );
        const provisionedCounters = { digest: 0 };
        const { service: provisioned } = makeService(
            { counters: provisionedCounters, edition: 3 },
            { pollSeconds: 0.04, pollBackoffMultipliers: [1, 2, 5] },
        );
        const a = serverless.acquire(KEY);
        const b = provisioned.acquire(KEY);
        await Promise.all([a.refresh(), b.refresh()]);

        await sleep(120);
        expect(provisionedCounters.digest, "provisioned polls at base (~40ms)").to.be.greaterThan(
            0,
        );
        expect(serverlessCounters.digest, "serverless waits for the cap (~200ms)").to.equal(0);

        await sleep(350);
        expect(
            serverlessCounters.digest,
            "serverless polls at the cap, not never",
        ).to.be.greaterThan(0);
        a.dispose();
        b.dispose();
        serverless.dispose();
        provisioned.dispose();
    });

    test("H-3.4: shared semaphore caps concurrent digest validations across entries at 2", async () => {
        const limiter = new MetadataValidationLimiter(2);
        const engines = [0, 1, 2].map(() => {
            const counters = { digest: 0 };
            const made = makeService({ counters }, { validationLimiter: limiter });
            return { ...made, counters };
        });
        const handles = engines.map((e, i) =>
            e.service.acquire({ serverFingerprint: `sha256:s${i}`, database: "Db1" }),
        );
        await Promise.all(handles.map((h) => h.refresh()));
        await sleep(10); // step past the full-refresh validation instant

        let issued = 0;
        const holds = engines.map(() => deferred());
        engines.forEach((e, i) => {
            e.source.gate = (text) => {
                if (!text.includes("CHECKSUM_AGG")) {
                    return undefined;
                }
                issued++;
                return holds[i].promise;
            };
        });
        const validations = handles.map((h) =>
            h.ensureFresh({ mode: "requireValidated", reason: "oeBrowse", validationTtlMs: 1 }),
        );
        await sleep(40);
        expect(issued, "third digest queues behind the semaphore").to.equal(2);

        holds[0].resolve();
        await sleep(40);
        expect(issued, "released slot admits the queued digest").to.equal(3);

        holds[1].resolve();
        holds[2].resolve();
        const results = await Promise.all(validations);
        for (const result of results) {
            expect(result.freshness).to.equal("validated");
        }
        handles.forEach((h) => h.dispose());
        engines.forEach((e) => e.service.dispose());
    });

    test("T-A15: rename under a live lease — driftRename once, strict modes fail actionably, allowStale serves", async () => {
        const counters = { digest: 0 };
        let currentDb = "Db1";
        const drifts: { expected: string; actual: string }[] = [];
        const { service } = makeService(
            { counters, currentDb: () => currentDb },
            { onIdentityDrift: (drift) => drifts.push(drift) },
        );
        const handle = service.acquire(KEY);
        await handle.refresh();
        await sleep(10); // step past the full-refresh validation instant
        const generation = handle.status().generation;

        const clean = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 1,
        });
        expect(clean.freshness).to.equal("validated");
        expect(drifts).to.have.length(0);

        currentDb = "Db1_Renamed";
        await sleep(5); // step past the 1ms TTL
        const drifted = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 1,
        });
        // Strict caller fails ACTIONABLY: unavailable + failed + accessChanged,
        // with the retained snapshot still traveling (C-7 shape).
        expect(drifted.freshness).to.equal("unavailable");
        expect(drifted.snapshot).to.not.equal(undefined);
        expect(drifted.validation?.result).to.equal("failed");
        expect(drifted.validation?.staleReason).to.equal("accessChanged");
        expect(drifts).to.deep.equal([{ expected: "Db1", actual: "Db1_Renamed" }]);
        const digestsAtLatch = counters.digest;

        // Latched: repeat strict calls run NO further digests and fire NO
        // further drift events — exactly once per episode.
        const again = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 1,
        });
        expect(again.freshness).to.equal("unavailable");
        expect(again.validation?.staleReason).to.equal("accessChanged");
        expect(counters.digest).to.equal(digestsAtLatch);
        expect(drifts).to.have.length(1);

        // requireLive refuses WITHOUT hydrating (never publishes the renamed
        // database's catalog under the old key — never auto-rekey).
        const live = await handle.ensureFresh({ mode: "requireLive", reason: "scripting" });
        expect(live.freshness).to.equal("unavailable");
        expect(live.snapshot).to.not.equal(undefined);
        expect(live.validation?.staleReason).to.equal("accessChanged");
        expect(handle.status().generation, "no hydration ran").to.equal(generation);

        // allowStale keeps serving the retained snapshot, honestly stale.
        const staleServe = await handle.ensureFresh({ mode: "allowStale", reason: "completion" });
        expect(staleServe.snapshot).to.not.equal(undefined);
        expect(staleServe.freshness).to.equal("stale");

        // Entry status carries the latched verdict for status surfaces.
        expect(handle.status().validation?.staleReason).to.equal("accessChanged");
        handle.dispose();
        service.dispose();
    });

    test("T-A15: the poll STOPS for an identity-drifted entry (it is lying by definition)", async () => {
        const counters = { digest: 0 };
        const drifts: { expected: string; actual: string }[] = [];
        // The digest identity rider disagrees with key.database from the
        // very first poll — one digest latches the drift, then silence.
        const { service } = makeService(
            { counters, currentDb: () => "SomebodyRenamedMe" },
            {
                pollSeconds: 0.04,
                pollBackoffMultipliers: [1],
                onIdentityDrift: (drift) => drifts.push(drift),
            },
        );
        const handle = service.acquire(KEY);
        await handle.refresh();
        await sleep(300);
        expect(counters.digest, "exactly one digest latched the drift, poll stopped").to.equal(1);
        expect(drifts).to.have.length(1);
        handle.dispose();
        service.dispose();
    });

    test("T-A15 store wiring: driftRename counts into keyCorrectnessViolations", async () => {
        const counters = { digest: 0 };
        const backend = new FakeBackend({
            scripts: baseScripts({ counters, currentDb: () => "NotDbA" }),
        });
        const store = new MetadataStore(async () => backend, { pollSeconds: 0 });
        const prepared = prepareConnection(
            { server: "srv-alpha", authenticationType: "Integrated", profileName: "Alpha" },
            {
                lookupPassword: async () => {
                    throw new Error("integrated auth must not look up a password");
                },
            },
        );
        const lease = await store.acquireDatabase(prepared, "DbA");
        await lease.refresh();
        await sleep(10); // step past the full-refresh validation instant
        expect(store.status().keyCorrectnessViolations).to.equal(0);

        const drifted = await lease.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 1,
        });
        expect(drifted.freshness).to.equal("unavailable");
        expect(drifted.validation?.staleReason).to.equal("accessChanged");
        expect(store.status().keyCorrectnessViolations, "driftRename counted").to.equal(1);
        lease.dispose();
        store.dispose();
    });

    test("H-6(b): server accessState transition pokes the live entry with accessChanged", async () => {
        const counters = { digest: 0 };
        let hasAccess = 1;
        const scripts: FakeScript[] = [
            ...baseScripts({ counters, currentDb: () => "DbA" }),
            {
                match: (t) => t.includes("sys.databases"),
                get events() {
                    return [
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
                            rows: [[5, "DbA", "ONLINE", false, "MULTI_USER", 160, hasAccess]],
                        },
                        { type: "complete", status: "succeeded" },
                    ];
                },
            } as unknown as FakeScript,
        ];
        const backend = new FakeBackend({ scripts });
        const store = new MetadataStore(async () => backend, { pollSeconds: 0 });
        const prepared = prepareConnection(
            { server: "srv-alpha", authenticationType: "Integrated", profileName: "Alpha" },
            {
                lookupPassword: async () => {
                    throw new Error("integrated auth must not look up a password");
                },
            },
        );
        const serverLease = await store.acquireServer(prepared);
        await serverLease.refresh();
        const dbLease = await store.acquireDatabase(prepared, "DbA");
        await dbLease.refresh();
        expect(dbLease.status().validation?.staleReason).to.not.equal("accessChanged");

        hasAccess = 0; // permission revoked between server hydrations
        await serverLease.refresh();
        expect(
            dbLease.status().validation?.staleReason,
            "accessState transition poked the entry",
        ).to.equal("accessChanged");

        // The poke revokes the TTL claim: the next requireValidated runs a
        // real digest instead of trusting memory.
        const digestsBefore = counters.digest;
        const revalidated = await dbLease.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 600_000,
        });
        expect(counters.digest).to.equal(digestsBefore + 1);
        expect(revalidated.freshness).to.equal("validated");
        serverLease.dispose();
        dbLease.dispose();
        store.dispose();
    });
});
