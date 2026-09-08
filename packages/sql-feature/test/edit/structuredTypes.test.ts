/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Editing the structured types: xml, json, vector, spatial, hierarchyid and sql_variant.
 *
 * Each has to survive a full round trip. Reading has to produce the exact text the codec can
 * write back, the type must be kept out of any WHERE it cannot appear in, and the grid has to
 * be told the value is a document rather than a scalar.
 */

import * as assert from "node:assert/strict";
import { test } from "node:test";

import { chooseKeyStrategy } from "../../src/edit/metadata/keyStrategy";
import { column, table } from "./fixtures";
import { compileCellQuery, compilePageQuery, resolvePageOrder } from "../../src/edit/query/select";
import { compileUpdate, concurrencyColumnsFor } from "../../src/edit/dml/compile";
import { editorKindFor, isComparableType, isLargeValueType } from "../../src/edit/types/typeTraits";
import { encodeValue, vectorDimensions } from "../../src/edit/types/valueCodec";
import { SqlEditError } from "../../src/edit/core/sql";

const STRUCTURED = ["xml", "json", "vector", "geography", "geometry"] as const;

function structuredTable() {
    return table({
        columns: [
            column("Id", "int", { isNullable: false, ordinal: 1 }),
            column("Doc", "xml", { ordinal: 2 }),
            column("Payload", "json", { ordinal: 3 }),
            column("Embedding", "vector", { ordinal: 4 }),
            column("Where", "geography", { ordinal: 5 }),
            column("Node", "hierarchyid", { ordinal: 6 }),
            column("Any", "sql_variant", { ordinal: 7 }),
            column("Notes", "nvarchar", { maxLength: -1, ordinal: 8 }),
        ],
    });
}

void test("structured types are never used to identify a row", () => {
    // None of them has an equality operator, so a WHERE containing one is a server error.
    for (const typeName of STRUCTURED) {
        assert.equal(isComparableType(typeName), false, `${typeName} must not be comparable`);
    }
    assert.equal(isComparableType("sql_variant"), true);
    assert.equal(isComparableType("hierarchyid"), true);
});

void test("a keyless table with structured columns excludes them from its identity", () => {
    const meta = table({
        indexes: [],
        columns: [
            column("Name", "nvarchar", { maxLength: 50 }),
            column("Doc", "xml"),
            column("Payload", "json"),
        ],
    });
    const key = chooseKeyStrategy(meta);
    assert.deepEqual(key.columns, ["Name"]);
});

void test("editing a structured column does not put it in the concurrency check", () => {
    const meta = structuredTable();
    const columns = concurrencyColumnsFor(meta, {
        rowId: 1,
        kind: "update",
        values: { Doc: "<a/>", Notes: "hello" },
    });
    assert.ok(!columns.includes("Doc"), "xml cannot be compared");
    assert.ok(columns.includes("Notes"));
});

void test("an update to a structured column still addresses the row by its key", () => {
    const meta = structuredTable();
    const statement = compileUpdate(meta, chooseKeyStrategy(table()), {
        rowId: 1,
        kind: "update",
        values: { Doc: "<order id='1'/>" },
        original: { Id: "7" },
    });
    assert.match(statement.sql, /SET \[Doc\] = CONVERT\(xml, N'<order id=''1''\/>'\)/);
    assert.match(statement.sql, /WHERE \[Id\] = 7/);
});

void test("structured columns are read back as the text the codec can write", () => {
    const meta = structuredTable();
    const page = compilePageQuery(meta, chooseKeyStrategy(table()), { pageSize: 10 });
    for (const name of ["Doc", "Payload", "Embedding", "Any"]) {
        assert.match(
            page.sql,
            new RegExp(`CONVERT\\(nvarchar\\(max\\), \\[${name}\\]\\) AS \\[${name}\\]`),
            `${name} must project as text`,
        );
    }
    // Spatial carries its SRID so it can be written back into the right reference system.
    assert.match(page.sql, /N'SRID=' \+ CONVERT\(nvarchar\(16\), \[Where\]\.STSrid\)/);
    // hierarchyid reads as its path form rather than as binary.
    assert.match(page.sql, /\[Node\]\.ToString\(\) AS \[Node\]/);
});

void test("the grid is told which values are documents, not scalars", () => {
    assert.equal(editorKindFor("xml"), "xml");
    assert.equal(editorKindFor("json"), "json");
    assert.equal(editorKindFor("vector"), "vector");
    assert.equal(editorKindFor("geography"), "spatial");
    assert.equal(editorKindFor("varbinary"), "binary");
    assert.equal(editorKindFor("bit"), "boolean");
    assert.equal(editorKindFor("datetime2"), "date");
    assert.equal(editorKindFor("nvarchar", -1), "multiline");
    assert.equal(editorKindFor("nvarchar", 100), "scalar");
    // A column that cannot be written gets no editor at all.
    assert.equal(editorKindFor("int", undefined, false), "readOnly");
});

void test("document types are flagged as large, so a clipped value is expected", () => {
    for (const typeName of ["xml", "json", "vector", "text", "image"]) {
        assert.equal(isLargeValueType(typeName), true, typeName);
    }
    assert.equal(isLargeValueType("nvarchar", -1), true);
    assert.equal(isLargeValueType("nvarchar", 200), false);
    assert.equal(isLargeValueType("int"), false);
});

void test("a full-cell read targets exactly one row by its key", () => {
    const meta = structuredTable();
    const order = resolvePageOrder(undefined, chooseKeyStrategy(table()));
    const sql = compileCellQuery(meta, "Doc", { Id: "7" }, order);
    assert.match(sql, /SELECT TOP \(1\) CONVERT\(nvarchar\(max\), \[Doc\]\) AS \[Doc\]/);
    assert.match(sql, /WHERE \[Id\] = 7/);
});

void test("a full-cell read rejects a column that does not exist", () => {
    const meta = structuredTable();
    const order = resolvePageOrder(undefined, chooseKeyStrategy(table()));
    assert.throws(() => compileCellQuery(meta, "NoSuch", { Id: "7" }, order));
});

void test("a vector cast carries its dimension, which bare `vector` cannot", () => {
    // `CONVERT(vector, ...)` is rejected by the server: vector is not a system type on its own.
    // The catalog does not expose the dimension, but storage is an 8-byte header plus 4 per
    // dimension, so it is recoverable from max_length.
    assert.equal(vectorDimensions(12), 1);
    assert.equal(vectorDimensions(20), 3);
    assert.equal(vectorDimensions(8000), 1998);
    assert.equal(vectorDimensions(8), undefined);
    assert.equal(vectorDimensions(undefined), undefined);

    assert.equal(
        encodeValue("[0.9,0.8,0.7]", column("E", "vector", { maxLength: 20 }), "E"),
        "CONVERT(vector(3), N'[0.9,0.8,0.7]')",
    );
    assert.throws(() => encodeValue("[1]", column("E", "vector"), "E"), SqlEditError);
});

void test("a vector read back in scientific notation is still writable", () => {
    // The server returns [1.0000000e-001,...]; that has to be accepted as valid input.
    assert.doesNotThrow(() =>
        encodeValue(
            "[1.0000000e-001,2.0000000e-001,3.0000001e-001]",
            column("E", "vector", { maxLength: 20 }),
            "E",
        ),
    );
});
