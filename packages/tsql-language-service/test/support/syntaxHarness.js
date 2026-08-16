/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} = require("../../dist/index.js");

/** Creates one small, public-API syntax harness for a grammar domain. */
function createSyntaxHarness(fileName = "syntax.sql", defaultProfile) {
    const uri = fileName.includes(":") ? fileName : `file:///${fileName}`;

    function document(version, text) {
        return new ImmutableTextSnapshot(uri, version, text);
    }

    function parse(sql, profile = defaultProfile) {
        return new LezerSyntaxService(undefined, profile).parse(document(1, sql));
    }

    function assertValid(value, profile = defaultProfile) {
        const snapshot = typeof value === "string" ? parse(value, profile) : value;
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, []);
        return snapshot;
    }

    return Object.freeze({ assertValid, document, parse, uri });
}

/** Verifies that applying an edit incrementally produces the same public syntax result as fresh parsing. */
function assertIncrementalEquivalent({
    service,
    previousDocument,
    previousSnapshot,
    version,
    changes,
    assertReuse = true,
}) {
    const nextDocument = applyTextChanges(previousDocument, version, changes);
    const incremental = service.update(previousSnapshot, nextDocument, changes);
    const fresh = service.parse(nextDocument);

    if (assertReuse) assert.ok(incremental.statistics.reusedChunkCount > 0);
    assert.equal(incremental.tree.toString(), fresh.tree.toString());
    assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
    assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    return { fresh, incremental, nextDocument };
}

module.exports = { assertIncrementalEquivalent, createSyntaxHarness };
