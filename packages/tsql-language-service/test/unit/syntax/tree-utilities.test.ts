/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    descendantsOfKind,
    descendantsOwnedByKind,
    sameSyntaxNode,
} from "../../../src/index.ts";

suite("typed syntax tree utilities", () => {
    // An outer query must not claim table sources owned by a nested derived query.
    test("keeps nested descendants with their nearest structural owner", () => {
        const sql =
            "SELECT * FROM (SELECT * FROM dbo.InnerTable) AS d JOIN dbo.OuterTable o ON 1=1;";
        const syntax = new LezerSyntaxService().parse(
            new ImmutableTextSnapshot("tree:///owners.sql", 1, sql),
        );
        const queries = descendantsOfKind(syntax.root(), "QuerySpecification");
        assert.equal(queries.length, 2);
        const outer = queries.find((query) => query.start === 0);
        assert.ok(outer);
        const owned = descendantsOwnedByKind(outer, "NamedTableSource", outer);
        assert.deepEqual(
            owned.map((node) => sql.slice(node.start, node.end)),
            ["dbo.OuterTable o"],
        );
        assert.equal(sameSyntaxNode(outer, queries[0]), true);
    });
});
