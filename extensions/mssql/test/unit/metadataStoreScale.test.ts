/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MetadataStore scale tests (B16): the deterministic LARGE-CATALOG fixture
 * (10k tables round-robin over 10 schemas, 8 columns each, a 1000-column
 * dbo.WideTable, 200 procedures, 2000 chained FKs) hydrated through the real
 * MetadataStore + FakeBackend. Asserts exact counts and generous unit-lane
 * wall-clock ceilings (actual timings logged for the journal), snapshot read
 * paths at scale (listObjects / search / getColumns), and that a warm
 * re-acquire is a cache hit with no second hydration.
 *
 * The suite hydrates ONCE in suiteSetup and awaits readiness via status
 * events — calling lease.refresh() here would chain a SECOND full hydration
 * after the auto-started one and double the measured wall time.
 */

import { expect } from "chai";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";
import { CatalogSnapshot } from "../../src/services/metadata/catalogModel";
import { DatabaseCatalogLease, MetadataStore } from "../../src/services/metadata/metadataStore";
import {
    prepareConnection,
    PreparedConnection,
    StoredConnectionProfile,
} from "../../src/services/metadata/profileAuthAdapter";
import { expectedCounts, largeCatalogScripts } from "./support/largeCatalogFixture";

const PROFILE: StoredConnectionProfile = {
    server: "srv-scale.example.internal",
    database: "BigDb",
    authenticationType: "Integrated",
    profileName: "Scale",
};

const NO_SECRETS = {
    lookupPassword: async (): Promise<string> => {
        throw new Error("integrated auth must not look up a password");
    },
};

suite("MetadataStore scale (B16)", () => {
    let backend: FakeBackend;
    let store: MetadataStore;
    let prepared: PreparedConnection;
    let lease: DatabaseCatalogLease;
    let snapshot: CatalogSnapshot;
    let hydrationMs = 0;

    suiteSetup(async () => {
        backend = new FakeBackend({ scripts: largeCatalogScripts() });
        store = new MetadataStore(async () => backend, { pollSeconds: 0, idleTtlMs: 60_000 });
        prepared = prepareConnection(PROFILE, NO_SECRETS);

        let settle!: () => void;
        const settled = new Promise<void>((resolve) => (settle = resolve));
        const startedAt = performance.now();
        lease = await store.acquireDatabase(prepared, "BigDb", (status) => {
            if (status.readiness === "ready" || status.readiness === "failed") {
                settle();
            }
        });
        // Hydration could in principle settle before the listener registers.
        if (lease.status().readiness === "ready" || lease.status().readiness === "failed") {
            settle();
        }
        await settled;
        hydrationMs = performance.now() - startedAt;
        if (lease.status().readiness !== "ready") {
            throw new Error(`large-catalog hydration ended ${lease.status().readiness}`);
        }
        snapshot = lease.current()!;
    });

    suiteTeardown(() => {
        lease.dispose();
        store.dispose();
    });

    test("hydration: default 10k catalog reaches ready with exact counts", () => {
        console.log(`[B16 scale] hydration wall time: ${Math.round(hydrationMs)}ms`);
        const status = lease.status();
        expect(status.readiness).to.equal("ready");
        expect(status.mode).to.equal("full"); // every H-section answered — no partial fallback
        expect(status.stats).to.deep.equal(expectedCounts());
        // Generous unit-lane ceiling; the actual time is logged above.
        expect(hydrationMs).to.be.lessThan(30_000);
    });

    test("listObjects: all 10k objects sorted schema-then-name; filters intact", () => {
        const startedAt = performance.now();
        const all = snapshot.listObjects();
        const elapsed = performance.now() - startedAt;
        console.log(`[B16 scale] listObjects(${all.length}): ${Math.round(elapsed)}ms`);
        expect(all).to.have.length(expectedCounts().objects);
        for (let i = 1; i < all.length; i++) {
            const order =
                all[i - 1].schema.localeCompare(all[i].schema) ||
                all[i - 1].name.localeCompare(all[i].name);
            if (order >= 0) {
                expect.fail(
                    `listObjects out of order at ${i}: ` +
                        `${all[i - 1].schema}.${all[i - 1].name} !< ${all[i].schema}.${all[i].name}`,
                );
            }
        }
        expect(elapsed).to.be.lessThan(2_000);

        // Round-robin placement: 10_000 tables / 10 schemas = 1000 tables and
        // 200 procedures / 10 schemas = 20 procedures per schema.
        const inS3 = snapshot.listObjects("s3");
        expect(inS3).to.have.length(1_020);
        expect(inS3.every((o) => o.schema === "s3")).to.equal(true);

        const procedures = snapshot.listObjects(undefined, ["procedure"]);
        expect(procedures).to.have.length(200);
        expect(procedures.every((o) => o.kind === "procedure")).to.equal(true);
    });

    test("search: prefix query over 10k names caps at the limit", () => {
        const startedAt = performance.now();
        const hits = snapshot.search("T0099", 50);
        const elapsed = performance.now() - startedAt;
        console.log(`[B16 scale] search("T0099", 50): ${Math.round(elapsed)}ms`);
        // T009900..T009999 = 100 prefix matches; the limit caps them at 50.
        expect(hits).to.have.length(50);
        expect(hits.every((o) => o.name.startsWith("T0099"))).to.equal(true);
        expect(elapsed).to.be.lessThan(500);
    });

    test("WideTable: exactly 1000 columns returned in ordinal order", () => {
        const resolution = snapshot.resolveName(["dbo", "WideTable"]);
        if (resolution.kind !== "resolved") {
            throw new Error(`dbo.WideTable did not resolve: ${resolution.kind}`);
        }
        const startedAt = performance.now();
        const columns = snapshot.getColumns(resolution.objectId);
        const elapsed = performance.now() - startedAt;
        console.log(`[B16 scale] getColumns(WideTable): ${Math.round(elapsed)}ms`);
        expect(columns).to.have.length(1_000);
        for (let i = 0; i < columns.length; i++) {
            const expectedName = `C${String(i + 1).padStart(4, "0")}`;
            if (columns[i].ordinal !== i || columns[i].name !== expectedName) {
                expect.fail(
                    `column ${i}: got ${columns[i].name} (ordinal ${columns[i].ordinal}), ` +
                        `expected ${expectedName} (ordinal ${i})`,
                );
            }
        }
        expect(elapsed).to.be.lessThan(500);
    });

    test("warm re-acquire: cache hit with no second hydration", async () => {
        const generation = lease.status().generation;
        expect(generation).to.be.greaterThan(0);
        lease.dispose();
        // Zero-ref entries stay warm for idleTtlMs — re-acquiring the same
        // key must be a cache hit with the snapshot immediately available.
        lease = await store.acquireDatabase(prepared, "BigDb");
        expect(lease.current(), "snapshot must be immediately available").to.not.equal(undefined);
        expect(lease.status().readiness).to.equal("ready");
        expect(lease.status().generation).to.equal(generation); // no re-hydration
        expect(backend.sessions).to.have.length(1); // dedicated session reused, not reopened
    });
});
