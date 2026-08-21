/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The catalog fetch log, which is the record a support view reads.
//
// The statistics contract described this stream before anything produced it, so the metadata
// section was structurally complete and permanently empty. These tests exist to keep it wired:
// every assertion here failed before the instrumentation, and each one corresponds to a question
// the view answers -- what ran, how long it took, what came back, and why it failed.

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    CatalogObserver,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    redactCatalogFetch,
    redactStats,
    SimpleQueryMetadataAdapter,
    type CatalogFetch,
    type CatalogScope,
    type CatalogStatsSnapshot,
    type LanguageServiceStats,
    type SimpleQueryCell,
    type SimpleQueryColumn,
    type SimpleQueryExecutor,
    type SimpleQueryMetadataLoader,
} from "../../../src/index.ts";
import { defined } from "../support/assertions.ts";

/**
 * A loader that issues exactly the queries a test wants to see recorded.
 *
 * `refresh` publishes with `replace` because that is what a refresh means and what the shipped
 * loader does: a coherent identity snapshot. The adapter reads that to tell a connection opening
 * from the same connection's catalog being rebuilt, so a loader that only merged would make the
 * reload case untestable and, worse, look like it worked.
 */
function loaderIssuing(queries: readonly string[]): SimpleQueryMetadataLoader {
    return {
        async refresh(executor, publisher) {
            for (const query of queries) await executor.execute(query);
            publisher.replace({ environment: { currentDatabase: "AdventureWorks" } });
        },
        async hydrate(executor, _request, publisher) {
            for (const query of queries) await executor.execute(query);
            publisher.merge({});
        },
    };
}

function catalogStats(adapter: SimpleQueryMetadataAdapter): CatalogStatsSnapshot {
    return defined(adapter.catalogStats(), "expected collected catalog statistics");
}

function firstFetch(stats: CatalogStatsSnapshot): CatalogFetch {
    return defined(stats.fetches[0], "expected a catalog fetch");
}

function firstScope(stats: CatalogStatsSnapshot): CatalogScope {
    return defined(stats.scopes[0], "expected a catalog scope");
}

function executorReturning(
    rows: readonly (readonly SimpleQueryCell[])[],
    columns: readonly SimpleQueryColumn[] = [{ name: "name" }],
): SimpleQueryExecutor {
    return {
        async execute() {
            return { columns, rows };
        },
    };
}

suite("catalog fetch log", () => {
    test("records the query, its duration, and what it returned", async () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            executorReturning([["Sales"], ["dbo"]]),
            loaderIssuing(["SELECT s.name FROM sys.schemas s"]),
            observer,
        );

        await adapter.refresh();

        const stats = catalogStats(adapter);
        assert.equal(stats.observedFetches, 1, "the refresh issued one query");
        const fetch = firstFetch(stats);
        assert.equal(fetch.query, "SELECT s.name FROM sys.schemas s");
        assert.equal(fetch.rowCount, 2);
        assert.equal(fetch.source, "server");
        assert.equal(fetch.outcome, "loaded");
        assert.ok(fetch.elapsedMs >= 0, "a duration is measured rather than left undefined");
        assert.ok(fetch.at > 0, "the fetch carries a wall-clock time");
    });

    // The reason this feature exists: a preview feature that silently returns nothing is the
    // hardest kind of bug to report, and the catalog layer otherwise discards the message.
    test("keeps the message when a query fails", async () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            {
                async execute() {
                    throw new Error("The SELECT permission was denied on object 'Employee'.");
                },
            },
            loaderIssuing(["SELECT * FROM sys.columns"]),
            observer,
        );

        await assert.rejects(() => adapter.refresh());

        const fetch = firstFetch(catalogStats(adapter));
        assert.equal(fetch.outcome, "failed");
        assert.match(defined(fetch.error).message, /SELECT permission was denied/u);
        assert.equal(fetch.query, "SELECT * FROM sys.columns");
    });

    // A server can report an error in the result rather than by throwing, and a view that only
    // watched for thrown errors would show that fetch as a success returning nothing.
    test("treats an error message in the result as a failure", async () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            {
                async execute() {
                    return {
                        columns: [],
                        rows: [],
                        messages: [{ error: true, message: "Invalid object name 'sys.columns'." }],
                    };
                },
            },
            loaderIssuing(["SELECT * FROM sys.columns"]),
            observer,
        );

        await adapter.refresh();

        const fetch = firstFetch(catalogStats(adapter));
        assert.equal(fetch.outcome, "failed");
        assert.match(defined(fetch.error).message, /Invalid object name/u);
    });

    test("counts an empty result apart from a loaded one", async () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            executorReturning([]),
            loaderIssuing(["SELECT s.name FROM sys.schemas s"]),
            observer,
        );

        await adapter.refresh();

        assert.equal(firstFetch(catalogStats(adapter)).outcome, "empty");
    });

    test("folds per-database totals over every observation", async () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            executorReturning([["a"]]),
            loaderIssuing(["SELECT 1", "SELECT 2", "SELECT 3"]),
            observer,
        );

        await adapter.refresh();

        const stats = catalogStats(adapter);
        assert.equal(stats.observedFetches, 3);
        const scope = firstScope(stats);
        assert.equal(scope.observedFetches, 3);
        assert.equal(scope.serverFetches, 3);
        assert.equal(scope.residentHits, 0);
        assert.ok(scope.elapsedMs >= 0);
        assert.ok(
            scope.neverRequested.includes("collations"),
            "sections nothing asked for are named, so their emptiness proves nothing",
        );
    });

    test("records a reload with what rebuilding it cost", async () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            executorReturning([["a"]]),
            loaderIssuing(["SELECT 1"]),
            observer,
        );

        // The first load is the connection opening; the second is the catalog being rebuilt.
        await adapter.refresh();
        await adapter.refresh();

        const { invalidations } = catalogStats(adapter);
        assert.equal(invalidations.length, 1, "only the rebuild is a reload");
        const invalidation = defined(invalidations[0]);
        assert.equal(invalidation.cause, "connectionChanged");
        assert.ok(invalidation.rebuildMs >= 0);
    });

    test("reports nothing when the provider was built without an observer", () => {
        const adapter = new SimpleQueryMetadataAdapter(executorReturning([]), loaderIssuing([]));

        assert.equal(
            adapter.catalogStats(),
            undefined,
            "absent means this provider records nothing, never that nothing was fetched",
        );
    });
});

suite("catalog fetch redaction", () => {
    const fetch: CatalogFetch = Object.freeze({
        at: 1,
        section: "columns",
        databaseHandle: "db:1",
        trigger: "completion",
        elapsedMs: 18.4,
        rowCount: 26,
        source: "server",
        outcome: "failed",
        databaseName: "AdventureWorks",
        objectName: "Sales.SalesOrderHeader",
        query: "SELECT c.name FROM sys.columns c WHERE c.object_id = @objectId",
        error: {
            message: "Invalid object name 'Secret.Customer'. Query: SELECT * FROM Secret.Customer",
            code: 208,
        },
    });

    test("removes exactly the identifying fields", () => {
        const redacted = redactCatalogFetch(fetch);

        assert.equal(redacted.databaseName, undefined);
        assert.equal(redacted.objectName, undefined);
        assert.equal(redacted.query, undefined);
        // Everything that makes the record diagnostic survives.
        assert.equal(redacted.section, "columns");
        assert.equal(redacted.databaseHandle, "db:1");
        assert.equal(redacted.elapsedMs, 18.4);
        assert.equal(redacted.rowCount, 26);
        assert.equal(redacted.outcome, "failed");
        assert.deepEqual(redacted.error, {
            message: "Server metadata request failed.",
            code: 208,
        });
        assert.doesNotMatch(JSON.stringify(redacted), /Secret|Customer|SELECT/u);
    });

    test("redacts the document path but keeps its extension", async () => {
        const stats = await statsWith([fetch]);

        const redacted = redactStats(stats);
        const redactedFetch = defined(redacted.metadata.fetches[0]);
        const redactedScope = defined(redacted.metadata.scopes[0]);

        assert.equal(redacted.document.uri, "document.sql");
        assert.equal(redactedFetch.query, undefined);
        assert.equal(redactedScope.databaseName, undefined);
        assert.equal(redactedScope.handle, "db:1");
    });

    test("keeps everything when identifiers are explicitly requested", async () => {
        const stats = await statsWith([fetch]);

        const kept = redactStats(stats, { includeIdentifiers: true });

        assert.equal(defined(kept.metadata.fetches[0]).query, fetch.query);
        assert.equal(kept.document.uri, stats.document.uri);
    });

    async function statsWith(fetches: readonly CatalogFetch[]): Promise<LanguageServiceStats> {
        const metadata = new InMemoryMetadataProvider();
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        await runtime.open("file:///c:/work/report.sql", 3, "SELECT 1;");
        const stats = defined(runtime.getStats("file:///c:/work/report.sql"));
        const scope: CatalogScope = {
            handle: "db:1",
            databaseName: "AdventureWorks",
            isCurrent: true,
            reason: "connection",
            observedFetches: fetches.length,
            elapsedMs: 0,
            residentHits: 0,
            serverFetches: fetches.length,
            hydrated: { withColumns: 0, withParameters: 0, withDefinitions: 0 },
            neverRequested: [],
        };
        return {
            ...stats,
            document: { uri: "file:///c:/work/report.sql", version: 3, utf16Length: 10 },
            metadata: {
                ...stats.metadata,
                fetches,
                scopes: [scope],
            },
        };
    }
});

suite("resident hits reach the fold", () => {
    test("a section used from memory counts against the server fetches", () => {
        const observer = new CatalogObserver();
        const adapter = new SimpleQueryMetadataAdapter(
            executorReturning([["a"]]),
            loaderIssuing([]),
            observer,
        );

        adapter.noteResidentUse({
            section: "columns",
            object: { id: "orders" },
            priority: "interactive",
            reason: "completion",
        });

        const stats = catalogStats(adapter);
        const scope = firstScope(stats);
        const fetch = firstFetch(stats);
        assert.equal(scope.residentHits, 1);
        assert.equal(scope.serverFetches, 0);
        assert.equal(fetch.source, "resident");
        assert.equal(
            fetch.elapsedMs,
            0,
            "a hit costs nothing, which is a measurement rather than a missing value",
        );
        assert.equal(fetch.trigger, "completion");
    });
});
