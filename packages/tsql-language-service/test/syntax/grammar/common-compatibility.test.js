/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("compatibility.sql", profile());

suite("T-SQL compatibility grammar", () => {
    // Verifies materialized-view distribution and lifecycle syntax for dedicated SQL engines.
    test("parses materialized views for dedicated SQL engines", () => {
        const snapshot = parse(
            `CREATE MATERIALIZED VIEW mv WITH (DISTRIBUTION = HASH(c1, c2), FOR_APPEND)
AS SELECT c1, c2 FROM dbo.t GROUP BY c1, c2;
ALTER MATERIALIZED VIEW mv REBUILD;`,
            profile("azure-synapse-dedicated"),
        );

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CreateMaterializedViewStatement/);
        assert.match(snapshot.tree.toString(), /AlterMaterializedViewStatement/);
    });

    // Verifies returned CTE-style queries can begin with a structured XMLNAMESPACES clause.
    test("parses XMLNAMESPACES in a returned query", () => {
        const snapshot = parse(`
CREATE FUNCTION dbo.f() RETURNS TABLE AS
RETURN (WITH XMLNAMESPACES(DEFAULT 'urn:test') SELECT c1 FROM dbo.t);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /XmlNamespacesClause/);
    });

    // Verifies a procedure can expose a VARYING cursor output parameter.
    test("parses cursor procedure parameters", () => {
        const snapshot = parse(`
CREATE PROCEDURE dbo.p @c CURSOR VARYING OUTPUT AS SELECT 1;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ProcedureParameter/);
    });

    // Verifies uncommon DROP families preserve their complete multiword object kinds.
    test("parses application-role, remote-binding, and route drops", () => {
        const snapshot = parse(`
DROP APPLICATION ROLE app_role;
DROP REMOTE SERVICE BINDING broker_binding;
DROP ROUTE outbound_route;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/DropSpecialObjectStatement\(/g) ?? []).length,
            3,
        );
    });
});

function profile(engineProfile = "sql-server") {
    return {
        serverMajorVersion: 17,
        compatibilityLevel: 170,
        engineProfile,
        previewFeatures: false,
    };
}
