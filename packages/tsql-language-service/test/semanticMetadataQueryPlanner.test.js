/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    MetadataQueryCache,
    MetadataQueryCoordinator,
    MetadataQueryPlanner,
    metadataCacheKey,
} = require("../dist/semantic/index.js");

describe("metadata query planning and cache coordination", () => {
    it("normalizes and deduplicates equivalent metadata intent into one cache key", () => {
        const planner = new MetadataQueryPlanner();
        const plans = planner.plan([
            {
                connectionId: "profile-1",
                database: "Main",
                catalogVersion: 8,
                kind: "columnsByObject",
                objectParts: ["dbo", "Users"],
            },
            {
                connectionId: "profile-1",
                database: "main",
                catalogVersion: 8,
                kind: "columnsByObject",
                objectParts: ["DBO", "users"],
            },
        ]);

        assert.equal(plans.length, 1);
        assert.equal(
            plans[0].cacheKey,
            metadataCacheKey({
                connectionId: "profile-1",
                database: "MAIN",
                catalogVersion: 8,
                kind: "columnsByObject",
                objectParts: ["dbo", "users"],
            }),
        );
        assert.doesNotMatch(plans[0].cacheKey, /password|server=/i);
    });

    it("coalesces parallel editor requests, retains fresh results, and invalidates by catalog version", async () => {
        let now = 100;
        const cache = new MetadataQueryCache({ ttlMs: 50, now: () => now });
        let calls = 0;
        const coordinator = new MetadataQueryCoordinator(
            {
                async execute(plan) {
                    calls++;
                    return { key: plan.cacheKey, calls };
                },
            },
            cache,
        );
        const planner = new MetadataQueryPlanner();
        const request = {
            connectionId: "profile-1",
            database: "Main",
            catalogVersion: 1,
            objectParts: ["dbo", "Users"],
        };
        const columns = planner.columns(request);

        const [first, second] = await Promise.all([
            coordinator.execute(columns),
            coordinator.execute(columns),
        ]);
        assert.equal(calls, 1);
        assert.strictEqual(first, second);
        await coordinator.execute(columns);
        assert.equal(calls, 1);

        now += 51;
        await coordinator.execute(columns);
        assert.equal(calls, 2);

        const changedCatalog = planner.columns({ ...request, catalogVersion: 2 });
        await coordinator.execute(changedCatalog);
        assert.equal(calls, 3);

        coordinator.invalidate(changedCatalog.cacheKey);
        await coordinator.execute(changedCatalog);
        assert.equal(calls, 4);
    });

    it("rejects incomplete plans before they can issue an ambiguous database query", () => {
        const planner = new MetadataQueryPlanner();
        assert.throws(
            () => planner.columns({ connectionId: "profile-1", database: "Main" }),
            /requires objectParts/,
        );
        assert.throws(
            () =>
                planner.completionChildren({
                    connectionId: "profile-1",
                    database: "Main",
                    objectParts: ["dbo", "Users"],
                }),
            /accepts prefixParts/,
        );
    });
});
