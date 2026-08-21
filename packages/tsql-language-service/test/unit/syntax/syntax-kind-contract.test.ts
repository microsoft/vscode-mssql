/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { ImmutableTextSnapshot, LezerSyntaxService } from "../../../src/index.ts";
import type { SyntaxNode } from "../../../src/syntax/contracts.ts";
import * as generatedTerms from "../../../src/syntax/lezer/generated/tsqlParser.terms.js";

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
        const walk = (node: SyntaxNode): void => {
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
