/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../../dist/index.js");
const generatedTerms = require("../../dist/syntax/lezer/generated/tsqlParser.terms.js");

suite("generated syntax-kind contract", () => {
    // Every public node and token name must be generated or one of the two documented adapters.
    test("exposes no untyped parser node or token kinds", () => {
        const syntax = new LezerSyntaxService().parse(
            new ImmutableTextSnapshot(
                "kind:/contract.sql",
                1,
                "CREATE TABLE dbo.t (id int); SELECT t.id FROM dbo.t AS t WHERE ;",
            ),
        );
        const generated = new Set(Object.keys(generatedTerms));
        const walk = (node) => {
            assert.ok(node.kind === "⚠" || generated.has(node.kind), node.kind);
            for (const child of node.children()) walk(child);
        };
        walk(syntax.root());
        for (const token of syntax.tokens()) {
            assert.ok(
                token.kind === "Keyword" ||
                    token.kind === "Whitespace" ||
                    generated.has(token.kind),
                token.kind,
            );
        }
    });
});
