/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
} = require("../../dist/index.js");

const uri = "file:///node-matrix.sql";
const corpusRoot = join(__dirname, "..", "corpus", "tsql-conformance");

/**
 * A cross-feature sweep over the grammar.
 *
 * Every feature is asked about every grammar node the corpus produces. The point is not that each
 * one answers — most nodes are not hover targets — but that none of them throws, returns a range
 * outside the document, or disagrees with the snapshot it was given. A feature that only works on
 * the shapes its own tests chose is a feature that breaks on real SQL.
 */
function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            {
                ref: { id: "t", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
        ],
        columns: new Map([["t", [{ name: "Id", typeDisplay: "int", nullable: false }]]]),
    });
}

/** The corpus files, capped so the sweep stays inside the fast lane's budget. */
function corpusDocuments(limit) {
    const manifest = JSON.parse(readFileSync(join(corpusRoot, "manifest.json"), "utf8"));
    const documents = [];
    for (const file of manifest.files) {
        if (documents.length >= limit) break;
        if (file.expectation !== "parseable") continue;
        const text = readFileSync(join(corpusRoot, file.path), "utf8");
        if (text.length > 8_000) continue;
        documents.push({ path: file.path, text });
    }
    return documents;
}

/** One representative offset per node kind: the first occurrence's start. */
function nodeKindOffsets(snapshot) {
    const offsets = new Map();
    const walk = (node) => {
        if (!offsets.has(node.kind)) offsets.set(node.kind, node.start);
        for (const child of node.children()) walk(child);
    };
    walk(snapshot.root());
    return offsets;
}

async function analyze(text) {
    const provider = metadata();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(uri, 1, text);
    return {
        snapshot,
        features: new TsqlLanguageFeatureService(runtime, provider),
        coloring: new TsqlColorizationService(),
    };
}

/** Every range a feature returned, flattened, so one rule can check them all. */
function rangesOf(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(rangesOf);
    const ranges = [];
    if (typeof value.start === "number" && typeof value.end === "number") {
        ranges.push({ start: value.start, end: value.end });
    }
    for (const key of ["range", "edit", "selectionRange", "originRange", "locations", "children"]) {
        if (key in value) ranges.push(...rangesOf(value[key]));
    }
    return ranges;
}

suite("grammar node matrix across features", () => {
    // Coloring, folding, hover, definition, and signature help are asked at one offset per node
    // kind the corpus produces. None may throw, and none may name text outside the document.
    test("answers safely at every grammar node kind the corpus produces", async () => {
        const documents = corpusDocuments(40);
        assert.ok(documents.length > 0, "the corpus manifest resolved to files");
        const covered = new Set();

        for (const document of documents) {
            const { snapshot, features, coloring } = await analyze(document.text);
            const length = snapshot.text.length;

            const colors = coloring.provideDocumentColors(snapshot);
            for (const token of colors.tokens) {
                assert.ok(
                    token.start >= 0 && token.end <= length && token.start <= token.end,
                    `${document.path}: colour token outside the document`,
                );
            }
            for (const fold of features.foldingRanges(uri, 1)) {
                assert.ok(
                    fold.start >= 0 && fold.end <= length,
                    `${document.path}: fold outside the document`,
                );
            }

            for (const [kind, offset] of nodeKindOffsets(snapshot.syntax)) {
                covered.add(kind);
                for (const answer of [
                    features.hover(uri, 1, offset),
                    features.definitionTarget(uri, 1, offset),
                    features.signatureHelp(uri, 1, offset),
                    features.completion(uri, 1, offset),
                    features.references(uri, 1, offset),
                    features.prepareRename(uri, 1, offset),
                ]) {
                    for (const range of rangesOf(answer)) {
                        assert.ok(
                            range.start >= 0 && range.end <= length && range.start <= range.end,
                            `${document.path}: ${kind} produced a range outside the document`,
                        );
                    }
                }
            }
        }

        // The sweep is only meaningful if it actually reached a broad slice of the grammar.
        assert.ok(covered.size > 120, `only ${covered.size} node kinds were exercised`);
    });
});

suite("incomplete typing and recovery across features", () => {
    /**
     * Prefixes of real statements, plus shapes with a missing name, delimiter, or list.
     *
     * Every feature has to survive them: this is what an editor sees on every keystroke, and a
     * feature that reconstructs damaged syntax for itself is the one that answers differently
     * from its neighbours.
     */
    const incomplete = [
        "SELECT ",
        "SELECT * FROM ",
        "SELECT * FROM dbo.",
        "SELECT * FROM dbo.Customers WHERE ",
        "SELECT Id, FROM dbo.Customers;",
        "SELECT dbo.Total(",
        "SELECT dbo.Total(1,",
        "SELECT CAST(1 AS ",
        "SELECT [unclosed",
        'SELECT "unclosed',
        "SELECT 'unterminated",
        "INSERT INTO dbo.Customers (",
        "CREATE TABLE dbo.T (",
        "EXEC dbo.",
        "WITH cte AS (SELECT 1) SELECT * FROM ",
        "SELECT * FROM dbo.Customers AS c WHERE c.",
        "GO\nSELECT ",
        "DECLARE @v ",
        "SELECT TOP (",
    ];

    test("keeps every feature answering inside the document", async () => {
        for (const text of incomplete) {
            const { snapshot, features, coloring } = await analyze(text);
            const length = snapshot.text.length;

            const colors = coloring.provideDocumentColors(snapshot);
            for (const token of colors.tokens) {
                assert.ok(
                    token.start >= 0 && token.end <= length,
                    `${JSON.stringify(text)}: colour token outside the document`,
                );
            }

            // Every caret position, not only the end: an editor asks wherever the user clicks.
            for (let offset = 0; offset <= length; offset++) {
                for (const answer of [
                    features.completion(uri, 1, offset),
                    features.hover(uri, 1, offset),
                    features.signatureHelp(uri, 1, offset),
                    features.definitionTarget(uri, 1, offset),
                ]) {
                    for (const range of rangesOf(answer)) {
                        assert.ok(
                            range.start >= 0 && range.end <= length && range.start <= range.end,
                            `${JSON.stringify(text)}@${offset}: range outside the document`,
                        );
                    }
                }
            }
        }
    });

    // The cursor context records whether the parser had to recover, so a caller that must not
    // guess can tell. A complete document must not claim recovery, and a damaged one must not
    // hide it.
    test("reports recovery honestly", async () => {
        const { snapshot: clean } = await analyze("SELECT Id FROM dbo.Customers;");
        assert.equal(clean.syntax.statistics.rawErrorNodeCount, 0);

        const { snapshot: damaged } = await analyze("SELECT Id, FROM dbo.Customers;");
        assert.ok(
            damaged.syntax.statistics.rawErrorNodeCount > 0,
            "a missing select element is recovered syntax",
        );
        // Binding still produces a model over damaged input rather than refusing to answer.
        assert.ok(damaged.semantics.model.scopes.length > 0);
    });
});
