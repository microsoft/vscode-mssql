/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Completion against a catalog that has not loaded its columns yet.
//
// The neighbouring expansion tests start from metadata where every column is already resident, so
// they never reach the code that asks for hydration. That is the opposite of a user's first
// keystroke in a freshly opened file, and it let a fault in the hydration request path pass a full
// suite while making SELECT * and INSERT expansion fail in the product.
//
// These drive the same features from the cold state: nothing loaded, hydration requested, and the
// request recorded so a wrong one is visible rather than merely absent.

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
    type MetadataHydrationRequest,
    type MetadataProvider,
} from "../../../../src/index.ts";
import { object } from "../../support/catalogFeatureHarness.ts";

/**
 * The catalog the shared harness builds, minus its resident columns.
 *
 * Mirrors that harness deliberately -- same objects, same schemas, same environment -- so the only
 * difference from the passing expansion tests is the one that matters: nothing has loaded columns
 * yet, which is the state a user's first keystroke in a new file actually finds.
 */
function coldProvider(): {
    readonly requests: MetadataHydrationRequest[];
    readonly provider: MetadataProvider;
} {
    const requests: MetadataHydrationRequest[] = [];
    const inner = new InMemoryMetadataProvider({
        environment: {
            currentDatabase: "CustomerDb",
            defaultSchema: "sales",
            caseSensitive: false,
        },
        completeness: { objects: "ready", schemas: "ready", databases: "ready" },
        schemas: [
            { database: "CustomerDb", name: "dbo" },
            { database: "CustomerDb", name: "sales" },
        ],
        databases: [{ name: "CustomerDb" }],
        objects: [
            object("users", "dbo", "Users", "table"),
            object("orders", "sales", "Orders", "table"),
        ],
        // Stated rather than omitted. An absent entry reads as loaded-and-empty, which is why the
        // existing expansion tests never reach the hydration request at all: the provider tells them
        // the columns are already known to be none.
        columnStates: new Map([
            ["users", { kind: "notLoaded" }],
            ["orders", { kind: "notLoaded" }],
        ]),
    });
    return {
        requests,
        provider: {
            get id() {
                return inner.id;
            },
            pin: () => inner.pin(),
            requestHydration: (request) => requests.push(request),
            refresh: (signal) => inner.refresh(signal),
            onDidChange: (listener) => inner.onDidChange(listener),
        },
    };
}

function analyze(_sql: string, provider: MetadataProvider) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const features = new TsqlLanguageFeatureService(runtime, provider);
    return { runtime, features };
}

suite("completion before the catalog has hydrated", () => {
    test("asks for the columns SELECT * needs instead of failing", async () => {
        const sql = "SELECT * FROM sales.Orders;";
        const { requests, provider } = coldProvider();
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///cold-star.sql", 1, sql);

        // Before the fix this recursed until the stack was exhausted, so the assertion that matters
        // most is simply that the call returns.
        const result = features.completion("file:///cold-star.sql", 1, sql.indexOf("*") + 1);

        assert.ok(result, "completion must return rather than throw while metadata is loading");
        assert.ok(
            requests.some((request) => request.section === "columns"),
            "the columns SELECT * would expand to must actually be requested",
        );
        assert.equal(result.incomplete, true);
        assert.deepEqual(
            result.items,
            [],
            "a slow expansion must not fall through to an unrelated table-source suggestion",
        );
    });

    test("asks for the columns an INSERT column list needs", async () => {
        const sql = "INSERT INTO sales.Orders () VALUES ();";
        const { requests, provider } = coldProvider();
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///cold-insert.sql", 1, sql);

        const result = features.completion("file:///cold-insert.sql", 1, sql.indexOf("(") + 1);

        assert.ok(result);
        assert.ok(requests.some((request) => request.section === "columns"));
    });

    // The reason a hydration was requested is what makes the fetch log an explanation rather than a
    // list of queries, so a request that loses it is a regression in its own right.
    test("attributes the request to the feature that needed it", async () => {
        const sql = "SELECT * FROM sales.Orders;";
        const { requests, provider } = coldProvider();
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///cold-reason.sql", 1, sql);

        features.completion("file:///cold-reason.sql", 1, sql.indexOf("*") + 1);

        const columns = requests.find((request) => request.section === "columns");
        assert.equal(columns?.reason, "completion");
    });

    test("hover asks under its own name", async () => {
        const sql = "SELECT * FROM sales.Orders;";
        const { requests, provider } = coldProvider();
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///cold-hover.sql", 1, sql);

        features.hover("file:///cold-hover.sql", 1, sql.indexOf("Orders") + 1);

        assert.ok(
            requests.every((request) => request.reason === undefined || request.reason === "hover"),
            "a hover must not be reported as a completion",
        );
    });
});

// The other half of the same decision: what happens when the columns ARE resident.
//
// This is the case the panel's "answered from memory" figure counts, and it is invisible from the
// provider's own vantage point -- a feature that finds what it needs returns without asking for
// anything, so a provider watching only its hydration requests sees nothing at all and reports every
// request as a round trip to the server.
suite("completion when the catalog is already resident", () => {
    function warmProvider(): {
        readonly resident: MetadataHydrationRequest[];
        readonly hydrations: MetadataHydrationRequest[];
        readonly provider: MetadataProvider;
    } {
        const resident: MetadataHydrationRequest[] = [];
        const hydrations: MetadataHydrationRequest[] = [];
        const inner = new InMemoryMetadataProvider({
            environment: {
                currentDatabase: "CustomerDb",
                defaultSchema: "sales",
                caseSensitive: false,
            },
            completeness: { objects: "ready", schemas: "ready", databases: "ready" },
            schemas: [{ database: "CustomerDb", name: "sales" }],
            databases: [{ name: "CustomerDb" }],
            objects: [object("orders", "sales", "Orders", "table")],
            columns: new Map([
                ["orders", [{ name: "OrderId", typeDisplay: "int", nullable: false }]],
            ]),
        });
        return {
            resident,
            hydrations,
            provider: {
                get id() {
                    return inner.id;
                },
                pin: () => inner.pin(),
                requestHydration: (request) => hydrations.push(request),
                noteResidentUse: (request) => resident.push(request),
                refresh: (signal) => inner.refresh(signal),
                onDidChange: (listener) => inner.onDidChange(listener),
            } satisfies MetadataProvider,
        };
    }

    test("reports the columns it found in memory rather than staying silent", async () => {
        const sql = "SELECT * FROM sales.Orders;";
        const { resident, hydrations, provider } = warmProvider();
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///warm-star.sql", 1, sql);

        features.completion("file:///warm-star.sql", 1, sql.indexOf("*") + 1);

        assert.ok(
            resident.some((request) => request.section === "columns"),
            "a cache hit must be observable, or the memory figure is permanently zero",
        );
        assert.equal(
            hydrations.length,
            0,
            "nothing should be fetched when the columns are already held",
        );
    });

    test("attributes the hit to the feature that used it", async () => {
        const sql = "SELECT * FROM sales.Orders;";
        const { resident, provider } = warmProvider();
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///warm-reason.sql", 1, sql);

        features.completion("file:///warm-reason.sql", 1, sql.indexOf("*") + 1);

        assert.equal(resident.find((r) => r.section === "columns")?.reason, "completion");
    });

    // A provider that records nothing must not be required to implement the hook.
    test("works against a provider that does not implement the hook", async () => {
        const sql = "SELECT * FROM sales.Orders;";
        const { provider } = warmProvider();
        delete provider.noteResidentUse;
        const { runtime, features } = analyze(sql, provider);
        await runtime.open("file:///warm-optional.sql", 1, sql);

        assert.ok(features.completion("file:///warm-optional.sql", 1, sql.indexOf("*") + 1));
    });
});
