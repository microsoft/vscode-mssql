/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    TsqlColorizationService,
} = require("../../dist/index.js");
const {
    applyColorEdits,
    colorize,
    countingSyntaxService,
    createColoringMetadata,
    openColorizationSession,
    uri,
} = require("../support/coloringHarness.js");

const document = [
    "-- customer report",
    "DECLARE @since date = '2024-01-01';",
    "SELECT c.Name, o.OrderId",
    "FROM dbo.Customers AS c",
    "  JOIN dbo.Orders AS o ON o.CustomerId = c.Id",
    "WHERE c.Id > 1;",
].join("\n");

async function openSession(sql) {
    const provider = createColoringMetadata();
    const runtime = new InProcessLanguageServiceRuntime(
        undefined,
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    return { runtime, snapshot, service: new TsqlColorizationService() };
}

suite("incremental coloring", () => {
    test("produces the same result for the same snapshot every time", async () => {
        const { snapshot, service } = await openSession(document);
        const first = service.provideDocumentColors(snapshot);
        const second = service.provideDocumentColors(snapshot);
        assert.deepEqual(second.tokens, first.tokens);
        assert.equal(second.resultId, first.resultId);
    });

    test("a range result is exactly the full result restricted to that range", async () => {
        const { snapshot, service } = await openSession(document);
        const full = service.provideDocumentColors(snapshot);
        const start = document.indexOf("SELECT");
        const end = document.indexOf("\nWHERE");
        const ranged = service.provideRangeColors({ ...snapshot, range: { start, end } });
        assert.deepEqual(
            ranged.tokens,
            full.tokens.filter((token) => token.start >= start && token.end <= end),
        );
        assert.ok(ranged.tokens.length > 0);
    });

    test("a range that splits a qualified name keeps every classification", async () => {
        const sql = "SELECT c.Name FROM dbo.Customers AS c;";
        const { snapshot, service } = await openSession(sql);
        const full = service.provideDocumentColors(snapshot);
        for (const token of full.tokens) {
            const ranged = service.provideRangeColors({
                ...snapshot,
                range: { start: token.start, end: token.end },
            });
            assert.deepEqual(ranged.tokens, [token]);
        }
    });

    test("colors an edited document exactly like a freshly opened one", async () => {
        const { runtime, snapshot, service } = await openSession(document);
        const start = document.indexOf("c.Id > 1");
        const change = { start: start + 7, end: start + 8, text: "42" };
        const edited = await runtime.change(uri, 1, 2, [change]);
        const fresh = await colorize(
            document.slice(0, change.start) + change.text + document.slice(change.end),
            { provider: createColoringMetadata() },
        );
        assert.deepEqual(service.provideDocumentColors(edited).tokens, fresh.tokens);
        assert.equal(snapshot.text.version, 1);
    });

    test("edits rebuild the previous token list into the new one", async () => {
        const { runtime, snapshot, service } = await openSession(document);
        const full = service.provideDocumentColors(snapshot);
        const start = document.indexOf("c.Name");
        const change = { start, end: start + 6, text: "c.Name AS customer" };
        const edited = await runtime.change(uri, 1, 2, [change]);
        const delta = service.provideColorEdits(full, edited, [change]);
        assert.equal(delta.kind, "delta");
        assert.deepEqual(
            applyColorEdits(full.tokens, delta.edits),
            service.provideDocumentColors(edited).tokens,
        );
    });

    test("an edit that changes one classification produces one bounded edit", async () => {
        const { runtime, snapshot, service } = await openSession(document);
        const full = service.provideDocumentColors(snapshot);
        const start = document.lastIndexOf("1");
        const change = { start, end: start + 1, text: "x" };
        const edited = await runtime.change(uri, 1, 2, [change]);
        const delta = service.provideColorEdits(full, edited, [change]);
        assert.equal(delta.edits.length, 1);
        assert.equal(delta.edits[0].deleteCount, 1);
        assert.deepEqual(
            delta.edits[0].tokens.map((token) => token.tokenType),
            ["column"],
        );
        assert.deepEqual(
            applyColorEdits(full.tokens, delta.edits),
            service.provideDocumentColors(edited).tokens,
        );
    });

    test("an edit that changes no classification produces no edits", async () => {
        const { runtime, snapshot, service } = await openSession(document);
        const full = service.provideDocumentColors(snapshot);
        const start = document.lastIndexOf("1");
        const change = { start, end: start + 1, text: "2" };
        const edited = await runtime.change(uri, 1, 2, [change]);
        assert.deepEqual(service.provideColorEdits(full, edited, [change]).edits, []);
    });

    test("an unchanged snapshot produces no edits", async () => {
        const { snapshot, service } = await openSession(document);
        const full = service.provideDocumentColors(snapshot);
        const delta = service.provideColorEdits(full, snapshot, []);
        assert.deepEqual(delta.edits, []);
        assert.equal(delta.previousResultId, full.resultId);
    });

    test("coloring performs no parse of its own", async () => {
        const counting = countingSyntaxService();
        const session = await openColorizationSession(document, {
            syntax: counting.service,
            provider: createColoringMetadata(),
        });
        assert.deepEqual(counting.counts, { parse: 1, update: 0 });
        session.service.provideDocumentColors(session.snapshot);
        session.service.provideRangeColors({ ...session.snapshot, range: { start: 0, end: 20 } });
        session.service.provideColorEdits(session.result, session.snapshot, []);
        assert.deepEqual(counting.counts, { parse: 1, update: 0 });
    });

    test("coloring reads no metadata of its own", async () => {
        const provider = createColoringMetadata();
        const session = await openColorizationSession(document, { provider });
        const view = provider.pin();
        let resolves = 0;
        const counted = {
            ...view,
            resolveObject: (parts) => (resolves++, view.resolveObject(parts)),
        };
        provider.pin = () => counted;
        session.service.provideDocumentColors(session.snapshot);
        assert.equal(resolves, 0);
    });
});
