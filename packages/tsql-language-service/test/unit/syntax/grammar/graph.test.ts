/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("graph.sql");

suite("T-SQL graph query grammar", () => {
    // Verifies directed MATCH paths preserve each node and edge in the structural tree.
    test("parses directed MATCH traversals", () => {
        const snapshot = parse(`
SELECT *
FROM Person AS p, Likes AS l, Product AS product
WHERE MATCH(p-(l)->product) OR MATCH(product<-(l)-p);`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/GraphMatchPredicate\(/g) ?? []).length, 2);
        assert.match(tree, /GraphForwardEdge\(/);
        assert.match(tree, /GraphBackwardEdge\(/);
    });

    // Verifies shortest paths, LAST_NODE, and bounded path quantifiers compose in MATCH.
    test("parses shortest-path graph predicates", () => {
        const snapshot = parse(`
SELECT * FROM Node FOR PATH AS n, Edge FOR PATH e, Node FOR PATH n2
WHERE MATCH(
  SHORTEST_PATH(n (-(e)-> n2){1,3})
  AND LAST_NODE(n) = LAST_NODE(n2)
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /GraphPathTableAlias\(/);
        assert.match(tree, /GraphQuantifier\(/);
        assert.match(tree, /GraphLastNodeComparison\(/);
    });

    // Verifies graph-path aggregate ordering remains distinct from ordinary ORDER BY.
    test("parses WITHIN GROUP GRAPH PATH", () => {
        const snapshot = parse(`
SELECT LAST_VALUE(n.Id) WITHIN GROUP (GRAPH PATH)
FROM Node FOR PATH n;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /WithinGroupClause\(/);
    });

    // Verifies malformed arrows are not accepted as valid MATCH traversal syntax.
    test("reports an incomplete graph edge", () => {
        assert.ok(parse("SELECT * FROM n WHERE MATCH(a-(e)-b);").diagnostics.length > 0);
    });
});
