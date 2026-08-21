/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("programmable-ddl.sql");

suite("T-SQL programmable-object DDL grammar", () => {
    // Verifies CREATE OR ALTER VIEW retains its projection, options, and CHECK OPTION structure.
    test("parses view lifecycle statements", () => {
        const snapshot = parse(`
CREATE OR ALTER VIEW dbo.ActiveProducts (ProductId, ProductName)
WITH SCHEMABINDING
AS SELECT ProductId, ProductName FROM dbo.Products WHERE IsActive = 1
WITH CHECK OPTION;
ALTER VIEW dbo.ProductIds AS SELECT ProductId FROM dbo.Products;
DROP VIEW IF EXISTS dbo.ProductIds, dbo.ActiveProducts;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateViewStatement\(/);
        assert.match(tree, /AlterViewStatement\(/);
        assert.match(tree, /DropViewStatement\(/);
    });

    // Verifies synonyms preserve a four-part target and support guarded removal.
    test("parses synonym lifecycle statements", () => {
        const snapshot = parse(`
CREATE SYNONYM dbo.RemoteOrders FOR SalesServer.SalesDb.sales.Orders;
DROP SYNONYM IF EXISTS dbo.RemoteOrders;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CreateSynonymStatement\(/);
        assert.match(snapshot.tree.toString(), /DropSynonymStatement\(/);
    });

    // Verifies alias, CLR, and table types use distinct declaration alternatives.
    test("parses user-defined type forms", () => {
        const snapshot = parse(`
CREATE TYPE dbo.Phone FROM nvarchar(32) NOT NULL;
CREATE TYPE dbo.GeoPoint EXTERNAL NAME SpatialAssembly.GeoPoint;
CREATE TYPE dbo.OrderLine AS TABLE (OrderId bigint NOT NULL, Quantity int NULL);
DROP TYPE IF EXISTS dbo.Phone, dbo.GeoPoint, dbo.OrderLine;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/CreateTypeStatement\(/g) ?? []).length, 3);
        assert.match(snapshot.tree.toString(), /ClrTypeName\(/);
    });

    // Verifies sequence bounds, cycling, caching, restart, and guarded drop syntax.
    test("parses sequence lifecycle statements", () => {
        const snapshot = parse(`
CREATE SEQUENCE dbo.OrderNumber AS bigint START WITH 1000 INCREMENT BY 5
    MINVALUE 1000 MAXVALUE 999999 CYCLE CACHE 100;
ALTER SEQUENCE dbo.OrderNumber RESTART WITH 2000 NO CYCLE NO CACHE;
DROP SEQUENCE IF EXISTS dbo.OrderNumber;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateSequenceStatement\(/);
        assert.match(tree, /AlterSequenceStatement\(/);
        assert.match(tree, /DropSequenceStatement\(/);
    });

    // Verifies procedure headers accept parenthesized parameters, execution principals, and CLR entry points.
    test("parses complete procedure header and CLR body forms", () => {
        const snapshot = parse(`
CREATE OR ALTER PROCEDURE dbo.usp_echo (@value int = 1 OUTPUT)
WITH RECOMPILE, EXECUTE AS SELF
AS SELECT @value;
GO
CREATE PROCEDURE dbo.usp_clr @value int
AS EXTERNAL NAME UtilityAssembly.StoredProcedures.Echo;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/CreateProcedureStatement\(/g) ?? []).length, 2);
        assert.match(tree, /ProcedureParameterClause\(OpenParen/);
        assert.match(tree, /ModulePrincipal\(Self\)/);
        assert.match(tree, /ExternalModuleBody\(/);
    });

    // Verifies CLR functions retain table shapes, output ordering, null-call policy, and entry-point identity.
    // ORDER follows WITH. This test previously wrote them the other way round, which ScriptDOM
    // rejects with "Incorrect syntax near 'WITH'"; the grammar had the same inversion.
    test("parses CLR scalar and table-valued function forms", () => {
        const snapshot = parse(`
CREATE FUNCTION dbo.scalar_clr(@value int)
RETURNS int WITH RETURNS NULL ON NULL INPUT
AS EXTERNAL NAME UtilityAssembly.Functions.ScalarValue;
GO
CREATE FUNCTION dbo.table_clr(@value int)
RETURNS TABLE (Id int, Name nvarchar(40))
WITH EXECUTE AS OWNER ORDER (Id DESC)
AS EXTERNAL NAME UtilityAssembly.Functions.TableValue;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/CreateFunctionStatement\(/g) ?? []).length, 2);
        assert.match(tree, /FunctionOrderClause\(/);
        assert.match(tree, /ModulePrincipal\(Owner\)/);
        assert.equal((tree.match(/ExternalModuleBody\(/g) ?? []).length, 2);
    });

    // Verifies an inline table-valued function accepts the optional AS and a namespace-led query.
    test("parses an inline table-valued function without AS", () => {
        const snapshot = parse(`
CREATE FUNCTION dbo.xml_rows()
RETURNS TABLE
RETURN (WITH XMLNAMESPACES (DEFAULT 'urn:products') SELECT ProductId FROM dbo.Products);
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ReturnedQuery\(/);
    });

    // Verifies DDL and LOGON trigger scopes/events are structural rather than recovery fragments.
    test("parses database and all-server trigger forms", () => {
        const snapshot = parse(`
CREATE TRIGGER ddl_database ON DATABASE
FOR CREATE_TABLE, ALTER_TABLE AS PRINT N'ddl';
GO
CREATE TRIGGER logon_audit ON ALL SERVER WITH EXECUTE AS OWNER
FOR LOGON AS EXTERNAL NAME AuditAssembly.Triggers.LogonAudit;
GO
DROP TRIGGER IF EXISTS logon_audit ON ALL SERVER;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/CreateTriggerStatement\(/g) ?? []).length, 2);
        assert.match(tree, /TriggerTarget\(Database\)/);
        assert.match(tree, /TriggerTarget\(All,Server\)/);
        assert.match(tree, /DropTriggerStatement\(/);
    });

    // Verifies an incomplete CREATE VIEW remains visible as an exact syntax error at EOF.
    test("recovers an incomplete view declaration", () => {
        const sql = "CREATE VIEW dbo.v AS";
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'End Of File'.",
                severity: "error",
                range: { start: sql.length, end: sql.length },
            },
        ]);
    });
});
