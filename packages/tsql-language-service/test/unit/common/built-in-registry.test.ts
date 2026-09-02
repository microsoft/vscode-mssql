/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    builtInRoutineNames,
    builtInsOfKind,
    formatParameter,
    formatSignature,
    isBuiltInAvailable,
    isSystemDataTypeName,
    lookupBuiltIn,
    normalizeSystemDataTypeName,
    type BuiltInEntry,
    type BuiltInKind,
    type BuiltInSignature,
} from "../../../src/index.ts";

function requiredBuiltIn(name: string, kind?: BuiltInKind): BuiltInEntry {
    const entry = lookupBuiltIn(name, kind);
    assert.ok(entry, `${name} must exist in the built-in registry`);
    return entry;
}

function requiredSignature(name: string): BuiltInSignature {
    const signature = requiredBuiltIn(name, "routine").signatures?.[0];
    assert.ok(signature, `${name} must publish a signature`);
    return signature;
}

suite("built-in registry", () => {
    test("looks a name up however it is written", () => {
        for (const spelling of ["GETDATE", "getdate", " GetDate ", "[GETDATE]"]) {
            assert.equal(lookupBuiltIn(spelling)?.name, "GETDATE", spelling);
        }
        assert.equal(lookupBuiltIn("no_such_name"), undefined);
    });

    test("a lookup may require the kind it expects", () => {
        assert.equal(lookupBuiltIn("int", "dataType")?.kind, "dataType");
        assert.equal(lookupBuiltIn("int", "routine"), undefined);
        assert.equal(lookupBuiltIn("@@ROWCOUNT", "systemVariable")?.kind, "systemVariable");
        assert.equal(lookupBuiltIn("GETDATE", "routine")?.kind, "routine");
    });

    // One canonical catalog prevents completion/hover and semantic validation from disagreeing
    // about system types or their multiword T-SQL synonyms.
    test("owns system data types and their canonical synonyms", () => {
        for (const spelling of [
            "int",
            "SYSNAME",
            "cursor",
            "table",
            "national   character varying",
            "DOUBLE PRECISION",
        ]) {
            assert.equal(isSystemDataTypeName(spelling), true, spelling);
        }
        assert.equal(normalizeSystemDataTypeName("national char varying"), "nvarchar");
        assert.equal(normalizeSystemDataTypeName("integer"), "int");
        assert.equal(normalizeSystemDataTypeName("dbo.CustomType"), undefined);
        assert.equal(isSystemDataTypeName("CustomType"), false);
    });

    test("every kind has entries and no name is duplicated within a kind", () => {
        const kinds: readonly BuiltInKind[] = ["routine", "systemVariable", "dataType"];
        for (const kind of kinds) {
            const seen = new Set<string>();
            const entries = builtInsOfKind(kind);
            assert.ok(entries.length > 0, kind);
            for (const entry of entries) {
                const key = entry.name.toLocaleLowerCase();
                assert.ok(!seen.has(key), `${entry.name} appears twice`);
                seen.add(key);
                assert.equal(entry.kind, kind);
            }
        }
        // T-SQL deliberately reuses some spellings; context must select the right declaration.
        assert.equal(lookupBuiltIn("CHAR", "routine")?.kind, "routine");
        assert.equal(lookupBuiltIn("CHAR", "dataType")?.kind, "dataType");
    });

    test("writes optional and repeated arguments the way they are written in source", () => {
        assert.equal(formatParameter({ name: "style", optional: true }), "[style]");
        assert.equal(formatParameter({ name: "expression", variadic: true }), "...expression");
        assert.equal(formatParameter({ name: "date" }), "date");
        assert.equal(
            formatSignature("convert", requiredSignature("CONVERT")),
            "CONVERT(data_type, expression, [style])",
        );
        // COALESCE needs two values before the repeat: SQL Server rejects a single-argument call,
        // and the same signature is what the arity diagnostic is derived from.
        assert.equal(
            formatSignature("coalesce", requiredSignature("COALESCE")),
            "COALESCE(expression, expression, ...expression)",
        );
    });

    test("a keyword-separated signature is not written with commas", () => {
        assert.equal(
            formatSignature("cast", requiredSignature("CAST")),
            "CAST(expression AS data_type)",
        );
        assert.equal(
            formatSignature("parse", requiredSignature("PARSE")),
            "PARSE(string_value AS data_type [USING culture])",
        );
    });

    test("carries return types where they are known", () => {
        assert.equal(requiredBuiltIn("GETDATE").returnType, "datetime");
        assert.equal(requiredBuiltIn("COUNT").returnType, "int");
        assert.equal(requiredBuiltIn("COUNT_BIG").returnType, "bigint");
    });

    test("availability answers per profile, and an unknown profile accepts everything", () => {
        const modern = requiredBuiltIn("JSON_OBJECT");
        assert.equal(modern.minimumCompatibility, 160);
        assert.equal(isBuiltInAvailable(modern), true);
        assert.equal(isBuiltInAvailable(modern, { compatibilityLevel: 170 }), true);
        assert.equal(isBuiltInAvailable(modern, { compatibilityLevel: 150 }), false);

        const always = requiredBuiltIn("GETDATE");
        assert.equal(isBuiltInAvailable(always, { compatibilityLevel: 100 }), true);
        assert.equal(
            isBuiltInAvailable(
                { engineProfiles: ["fabric-warehouse"] },
                { engineProfile: "sql-server" },
            ),
            false,
        );
        assert.equal(
            isBuiltInAvailable(
                { engineProfiles: ["fabric-warehouse"] },
                { engineProfile: "fabric-warehouse" },
            ),
            true,
        );
    });

    test("the routine name set is exactly the routine entries", () => {
        const fromEntries = new Set(
            builtInsOfKind("routine").map((entry) => entry.name.toLocaleLowerCase()),
        );
        assert.deepEqual([...builtInRoutineNames].sort(), [...fromEntries].sort());
        assert.ok(builtInRoutineNames.has("getdate"));
        assert.ok(!builtInRoutineNames.has("int"));
    });
});
