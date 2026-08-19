/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// What a narrowed bind is still required to publish.
//
// Binding a keystroke builds scopes and expression types only for the batches it is rebinding,
// because building them for the whole script was the largest cost in a bind. Those narrowed tables
// are for binding and validation alone: every feature reads the model, and the model has to
// describe the whole document however little of it was rebound.
//
// The neighbouring incremental-binding tests compare units and diagnostics, which both stay correct
// when the model is truncated -- publishing the narrowed scopes leaves the units untouched and the
// diagnostics untouched, and reduces the model to the one batch that changed. So these assert on
// the model itself, which is the only place the mistake shows.

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    applyTextChanges,
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    LezerSyntaxService,
} = require("../../../dist/index.js");

/** Enough batches that an edit in one leaves the rest reused. */
const BATCH_COUNT = 12;

function script() {
    const batches = [];
    for (let index = 0; index < BATCH_COUNT; index += 1) {
        batches.push(
            `SELECT c${index}, alias${index}.name AS n${index}\n` +
                `FROM tbl${index} AS alias${index}\n` +
                `WHERE alias${index}.value > ${index} AND CAST(alias${index}.amount AS int) = ${index};\n` +
                "GO",
        );
    }
    return batches.join("\n");
}

suite("model completeness after a narrowed bind", () => {
    test("publishes every batch's scopes, not only the rebound one", () => {
        const { incremental, full, statistics } = editLastBatch();

        assert.ok(statistics.unitsReused > 0, "the edit must leave batches reused");
        assert.equal(statistics.unitsRebound, 1, "only the edited batch should rebind");
        assert.equal(
            incremental.model.scopes.length,
            full.model.scopes.length,
            "a narrowed bind must not publish a model missing the untouched batches",
        );
        assert.deepEqual(
            incremental.model.scopes.map((scope) => scope.range.start).sort(compareNumbers),
            full.model.scopes.map((scope) => scope.range.start).sort(compareNumbers),
        );
    });

    test("publishes every batch's relations", () => {
        const { incremental, full } = editLastBatch();

        assert.equal(incremental.model.relations.length, BATCH_COUNT);
        assert.deepEqual(
            incremental.model.relations.map((relation) => relation.exposedName).sort(),
            full.model.relations.map((relation) => relation.exposedName).sort(),
        );
    });

    test("types expressions across the whole document", () => {
        const { incremental, full } = editLastBatch();

        assert.deepEqual(
            incremental.model.expressions
                .map((entry) => `${entry.range.start}-${entry.range.end}:${entry.type.displayName}`)
                .sort(),
            full.model.expressions
                .map((entry) => `${entry.range.start}-${entry.range.end}:${entry.type.displayName}`)
                .sort(),
        );
    });

    // The narrowing is driven by the rebound ranges, so an edit that rebinds everything takes the
    // unnarrowed path. Both paths have to agree, or the model would depend on how it was reached.
    test("agrees with a full bind when every batch rebinds", () => {
        const sql = script();
        const analysis = analyze(sql);
        const offset = sql.indexOf("tbl0");
        const change = { start: offset, end: offset + 4, text: "renamed0" };
        const updated = update(analysis, change);
        const fresh = analyze(applyTextChanges(analysis.document, 2, [change]).text);

        assert.equal(updated.semantics.model.scopes.length, fresh.semantics.model.scopes.length);
        assert.deepEqual(
            updated.semantics.model.relations.map((relation) => relation.exposedName).sort(),
            fresh.semantics.model.relations.map((relation) => relation.exposedName).sort(),
        );
    });
});

/** Edits the final batch so the earlier ones are reused and the bind takes the narrowed path. */
function editLastBatch() {
    const sql = script();
    const analysis = analyze(sql);
    const offset = sql.lastIndexOf("value");
    const change = { start: offset, end: offset + "value".length, text: "valve" };
    const updated = update(analysis, change);
    const fresh = analyze(applyTextChanges(analysis.document, 2, [change]).text);
    return {
        incremental: updated.semantics,
        full: fresh.semantics,
        statistics: updated.semantics.statistics,
    };
}

function compareNumbers(left, right) {
    return left - right;
}

function analyze(sql, metadata = new InMemoryMetadataProvider()) {
    const document = new ImmutableTextSnapshot("file:///narrowed-bind-model.sql", 1, sql);
    const syntaxService = new LezerSyntaxService();
    const binder = new CatalogSemanticBinder();
    const syntax = syntaxService.parse(document);
    const semantics = binder.bind({ syntax, metadata: metadata.pin() });
    return { document, syntaxService, binder, metadata, syntax, semantics };
}

function update(analysis, change) {
    const document = applyTextChanges(analysis.document, 2, [change]);
    const syntax = analysis.syntaxService.update(analysis.syntax, document, [change]);
    const semantics = analysis.binder.update(analysis.semantics, {
        syntax,
        metadata: analysis.metadata.pin(),
        previous: analysis.semantics,
        changedRanges: syntax.changedRanges,
    });
    return { ...analysis, document, syntax, semantics };
}
