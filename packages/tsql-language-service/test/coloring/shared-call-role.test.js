/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { TsqlLanguageFeatureService } = require("../../dist/index.js");
const { classificationOf, openColorizationSession } = require("../support/coloringHarness.js");

/**
 * `CAST`, `CONVERT`, and `TOP` are keywords in source and routines in meaning.
 *
 * Coloring used to reach that conclusion from the token stream while signature help reached its own
 * from the tree, so the two could describe the same construct differently with nothing tying them
 * together. Both now read the one resolved call, and these are the assertions that keep them tied.
 */
suite("shared conversion and operator roles", () => {
    async function open(sql) {
        const session = await openColorizationSession(sql);
        return {
            ...session,
            features: new TsqlLanguageFeatureService(session.runtime, session.provider),
        };
    }

    test("colors a conversion keyword as a library construct signature help also describes", async () => {
        const sql = "SELECT CAST(1 AS int), CONVERT(int, '2');";
        const { snapshot, result, features, uri } = await open(sql);

        assert.deepEqual(classificationOf(result.tokens, sql, "CAST"), {
            type: "keyword",
            modifiers: ["defaultLibrary"],
        });
        assert.deepEqual(classificationOf(result.tokens, sql, "CONVERT"), {
            type: "keyword",
            modifiers: ["defaultLibrary"],
        });

        // The same offsets the colour came from resolve to the same call for signature help.
        for (const [name, argument] of [
            ["CAST", "1 AS"],
            ["CONVERT", "int, '2'"],
        ]) {
            const call = snapshot.semantics.model.callAt(sql.indexOf(name));
            assert.equal(call.target.kind, "builtin");
            assert.equal(call.target.name, name);
            assert.equal(call.shape, "keywordSeparated");

            const help = features.signatureHelp(uri, 1, sql.indexOf(argument));
            assert.ok(help, `${name} has signature help`);
            assert.match(help.signatures[0].label, new RegExp(`^${name}\\(`, "u"));
        }
    });

    // TOP is an operator, not a routine. It shares the argument shape so signature help can answer
    // for it, and it keeps a keyword colour because that is what it is in source.
    test("colors TOP as a library keyword without making it a function", async () => {
        const sql = "SELECT TOP (1) 1;";
        const { snapshot, result } = await open(sql);

        assert.deepEqual(classificationOf(result.tokens, sql, "TOP"), {
            type: "keyword",
            modifiers: ["defaultLibrary"],
        });
        assert.equal(snapshot.semantics.model.callAt(sql.indexOf("TOP")).target.kind, "operator");
    });

    // An ordinary call keeps its function colour: the shared model did not turn every call into a
    // keyword, only the constructs the grammar spells as one.
    test("leaves an ordinary call colored as a routine", async () => {
        const sql = "SELECT dbo.Total(1);";
        const { result } = await open(sql);

        assert.deepEqual(classificationOf(result.tokens, sql, "Total"), {
            type: "function",
            modifiers: [],
        });
    });
});
