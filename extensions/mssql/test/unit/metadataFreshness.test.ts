/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-0 freshness policy API (cache/drift design §5, addendum §4):
 * - T-A4 (H-2): the lane survives a completion that never comes — watchdog
 *   fails the operation (never empty), the session recycles, and a
 *   subsequent requireLive succeeds.
 * - T-A5 (§4.3): N concurrent requireValidated callers coalesce onto ONE
 *   digest query.
 * - T-A6 (C-9): a caller's timeout is a race, never a cancellation — the
 *   shared validation completes for the patient waiter.
 * - T-A13 (C-3): readiness "stale" stays reserved for refresh-in-flight;
 *   age-based staleness only ever appears in FreshCatalogResult.freshness.
 * - Decision-procedure matrix: requireLive C-7 row, offlineSnapshot
 *   no-network, section gate + allowPartial interplay.
 */

import { expect } from "chai";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { ISqlSession, QueryHandle } from "../../src/services/sqlDataPlane/api";
import {
    MetadataService,
    MetadataSessionSource,
} from "../../src/services/metadata/metadataService";
import { ServerMetadataService } from "../../src/services/metadata/serverMetadataService";

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

/** Small catalog: H0 + H1 + H2 + digest (BEFORE H2 — matcher discipline). */
function baseScripts(counters: { digest: number }): FakeScript[] {
    return [
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
                    counters.digest++;
                }
                return hit;
            },
            events: [
                {
                    type: "resultSet",
                    columns: ["current_db", "object_count", "object_hash"],
                    rows: [["Db1", 1, 4242]],
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
                    rows: [[101, 1, "Orders", "U", "2026-01-01T00:00:00"]],
                },
                { type: "complete", status: "succeeded" },
            ],
        },
    ];
}

/**
 * Session source with interception hooks: `swallow` returns a handle whose
 * completion NEVER settles (the H-2 wedge); `gate` delays a matching query
 * until the test releases it. Counts opens so recycle is observable.
 */
class ControlledSource implements MetadataSessionSource {
    opens = 0;
    swallow: ((text: string) => boolean) | undefined;
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
                        if (source.swallow?.(text)) {
                            return {
                                clientQueryId: "swallowed",
                                completion: new Promise(() => {}),
                                cancel: () => new Promise(() => {}),
                                dispose: () => Promise.resolve(),
                            } as unknown as QueryHandle;
                        }
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
    counters: { digest: number },
    options?: ConstructorParameters<typeof MetadataService>[1],
) {
    const backend = new FakeBackend({ scripts: baseScripts(counters) });
    const source = new ControlledSource(backend);
    const service = new MetadataService(source, { pollSeconds: 0, ...options });
    return { service, source };
}

suite("Metadata freshness policy (CACHE-0)", () => {
    test("T-A13: readiness 'stale' means refresh-in-flight; allowStale reports 'refreshing'", async () => {
        const counters = { digest: 0 };
        const { service, source } = makeService(counters);
        const handle = service.acquire(KEY);
        await handle.refresh();
        expect(handle.status().readiness).to.equal("ready");

        const hold = deferred();
        let armed = true;
        source.gate = (t) => (armed && t.includes("SERVERPROPERTY") ? hold.promise : undefined);
        const refreshing = handle.refresh();
        await sleep(10);
        // C-3: the as-built meaning — an in-flight re-hydration OVER an
        // existing snapshot — not "old data".
        expect(handle.status().readiness).to.equal("stale");
        const early = await handle.ensureFresh({ mode: "allowStale", reason: "completion" });
        expect(early.freshness).to.equal("refreshing");
        expect(early.snapshot, "the previous generation keeps serving").to.not.equal(undefined);

        armed = false;
        hold.resolve();
        await refreshing;
        expect(handle.status().readiness).to.equal("ready");
        const after = await handle.ensureFresh({ mode: "allowStale", reason: "completion" });
        // Age-based staleness lives HERE, never in readiness.
        expect(after.freshness).to.equal("stale");
        expect(after.staleAgeMs).to.be.a("number");
        handle.dispose();
        service.dispose();
    });

    test("T-A5: N concurrent requireValidated coalesce onto exactly one digest query", async () => {
        const counters = { digest: 0 };
        const { service } = makeService(counters);
        const handle = service.acquire(KEY);
        await handle.refresh();
        await sleep(10); // step past the full-refresh validation instant
        counters.digest = 0;

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                handle.ensureFresh({
                    mode: "requireValidated",
                    reason: "oeBrowse",
                    validationTtlMs: 1,
                }),
            ),
        );
        for (const result of results) {
            expect(result.freshness).to.equal("validated");
        }
        expect(counters.digest, "coalesced validation runs one digest").to.equal(1);

        // Within the TTL the memory tier answers — still one digest total.
        const cached = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 60_000,
        });
        expect(cached.freshness).to.equal("validated");
        expect(counters.digest).to.equal(1);
        handle.dispose();
        service.dispose();
    });

    test("T-A6: timeout is a race — the shared validation completes for patient waiters", async () => {
        const counters = { digest: 0 };
        const { service, source } = makeService(counters);
        const handle = service.acquire(KEY);
        await handle.refresh();
        await sleep(10);
        counters.digest = 0;

        const hold = deferred();
        source.gate = (t) => (t.includes("CHECKSUM_AGG") ? hold.promise : undefined);
        const impatient = handle.ensureFresh({
            mode: "requireValidated",
            reason: "diagnostics",
            validationTtlMs: 1,
            timeoutMs: 15,
        });
        const patient = handle.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 1,
        });
        const early = await impatient;
        // C-9: stop waiting, keep honesty — snapshot present, not validated.
        expect(early.freshness).to.equal("stale");
        expect(early.validation?.result).to.equal("notChecked");
        expect(early.snapshot).to.not.equal(undefined);

        source.gate = undefined;
        hold.resolve();
        const late = await patient;
        expect(late.freshness).to.equal("validated");
        expect(counters.digest, "one shared digest, not cancelled by the race").to.equal(1);
        handle.dispose();
        service.dispose();
    });

    test("T-A4: watchdog fails a swallowed completion, recycles the session, and requireLive recovers", async () => {
        const counters = { digest: 0 };
        const { service, source } = makeService(counters, {
            hydrationTimeoutMs: 60,
            laneOpTimeoutMs: 50,
        });
        let wedge = true;
        source.swallow = (t) => wedge && t.includes("sys.schemas");
        const handle = service.acquire(KEY); // kicks the doomed hydration
        await sleep(150);
        // H-2: the operation FAILS (never pretend-empty), the lane survives.
        expect(handle.status().readiness).to.equal("failed");
        expect(handle.current()).to.equal(undefined);
        const opensBefore = source.opens;

        wedge = false;
        const recovered = await handle.ensureFresh({ mode: "requireLive", reason: "scripting" });
        expect(recovered.freshness).to.equal("live");
        expect(recovered.snapshot).to.not.equal(undefined);
        expect(handle.status().readiness).to.equal("ready");
        expect(source.opens, "wedged session was recycled before the retry").to.be.greaterThan(
            opensBefore,
        );
        handle.dispose();
        service.dispose();
    });

    test("requireLive C-7 row: refresh timeout returns the retained snapshot as 'unavailable'", async () => {
        const counters = { digest: 0 };
        const { service, source } = makeService(counters);
        const handle = service.acquire(KEY);
        await handle.refresh();
        const generation = handle.status().generation;

        const hold = deferred();
        let armed = true;
        source.gate = (t) => (armed && t.includes("SERVERPROPERTY") ? hold.promise : undefined);
        const strict = await handle.ensureFresh({
            mode: "requireLive",
            reason: "scripting",
            timeoutMs: 20,
        });
        // Strict callers refuse on FRESHNESS — the snapshot stays readable
        // so the caller can offer the explicit offline path.
        expect(strict.freshness).to.equal("unavailable");
        expect(strict.snapshot).to.not.equal(undefined);
        expect(strict.generation).to.equal(generation);

        armed = false;
        hold.resolve();
        await sleep(25);
        handle.dispose();
        service.dispose();
    });

    test("offlineSnapshot never touches the network", async () => {
        const counters = { digest: 0 };
        const { service, source } = makeService(counters);
        const handle = service.acquire(KEY);
        await handle.refresh();
        const opens = source.opens;
        counters.digest = 0;

        const offline = await handle.ensureFresh({ mode: "offlineSnapshot", reason: "oeBrowse" });
        expect(offline.source).to.equal("offline");
        expect(offline.freshness).to.equal("stale");
        expect(source.opens).to.equal(opens);
        expect(counters.digest).to.equal(0);

        handle.dispose();
        service.dispose();
    });

    test("section gate (C-12): unready requested sections downgrade require* to 'unavailable' unless allowPartial", async () => {
        const counters = { digest: 0 };
        const { service } = makeService(counters);
        const handle = service.acquire(KEY);
        await handle.refresh();
        // baseScripts has no H3 fixture: columns hydration fails ⇒ section
        // "failed", mode "partial" — the honest shape the gate must respect.
        expect(handle.current()!.readiness.columns).to.equal("failed");

        const objectsOnly = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "diagnostics",
            sections: ["objects"],
            validationTtlMs: 60_000,
        });
        expect(objectsOnly.freshness).to.equal("validated");

        const needsColumns = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "diagnostics",
            sections: ["objects", "columns"],
            validationTtlMs: 60_000,
        });
        expect(needsColumns.freshness).to.equal("unavailable");
        expect(needsColumns.snapshot, "snapshot still travels with the verdict").to.not.equal(
            undefined,
        );

        const partialOk = await handle.ensureFresh({
            mode: "requireValidated",
            reason: "hover",
            sections: ["objects", "columns"],
            allowPartial: true,
            validationTtlMs: 60_000,
        });
        expect(partialOk.freshness).to.equal("validated");
        handle.dispose();
        service.dispose();
    });

    test("server catalog §4.4: TTL reuse, re-hydration on expiry, allowStale never blocks", async () => {
        const scripts: FakeScript[] = [
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
                        rows: [[5, "Db1", "ONLINE", false, "MULTI_USER", 160, 1]],
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ];
        const backend = new FakeBackend({ scripts });
        const source = new ControlledSource(backend);
        const service = new ServerMetadataService(source);
        await service.ensureHydrated();
        const generation = service.status().generation;

        const withinTtl = await service.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 60_000,
        });
        expect(withinTtl.freshness).to.equal("validated");
        expect(withinTtl.generation).to.equal(generation);

        await sleep(10);
        const expired = await service.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs: 1,
        });
        expect(expired.freshness).to.equal("live");
        expect(expired.generation).to.equal(generation + 1);

        const stale = await service.ensureFresh({
            mode: "allowStale",
            reason: "completion",
            validationTtlMs: 1,
        });
        expect(stale.freshness).to.be.oneOf(["stale", "validated"]);
        expect(stale.generation).to.equal(generation + 1);
        service.dispose();
    });
});
