/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("core-conformance-regressions.sql");

suite("T-SQL core conformance regression grammar", () => {
    // UTF-8 scripts can decode with a leading BOM, which remains source trivia.
    test("ignores a leading Unicode byte-order mark", () => {
        const snapshot = parse("\uFEFFSELECT 1;");
        assertValid(snapshot);
        assert.deepEqual(
            [...snapshot.tokens()].find((token) => token.text === "\uFEFF"),
            {
                kind: "Whitespace",
                start: 0,
                end: 1,
                text: "\uFEFF",
                trivia: true,
                lineStart: true,
            },
        );
    });

    // Temporal sources accept every legal FOR SYSTEM_TIME interval shape.
    test("parses temporal table-source intervals", () => {
        const snapshot = parse(`
SELECT * FROM dbo.History FOR SYSTEM_TIME AS OF '2025-01-01' AS h;
SELECT * FROM dbo.History FOR SYSTEM_TIME FROM @start TO @end;
SELECT * FROM dbo.History FOR SYSTEM_TIME BETWEEN @start AND @end;
SELECT * FROM dbo.History FOR SYSTEM_TIME CONTAINED IN (@start, @end);
SELECT * FROM dbo.History FOR SYSTEM_TIME ALL;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/TemporalTableClause\(/g) ?? []).length, 5);
    });

    // Constraint forms combine replication modifiers, index options, and storage placement.
    test("parses complete column and table constraint tails", () => {
        const snapshot = parse(`
CREATE TABLE dbo.ConstraintSample (
    Id int CONSTRAINT UQ_Id UNIQUE CLUSTERED WITH FILLFACTOR = 90 ON [PRIMARY],
    ParentId int CONSTRAINT FK_Parent FOREIGN KEY REFERENCES dbo.Parent(Id),
    Value int CONSTRAINT CK_Value CHECK NOT FOR REPLICATION (Value > 0),
    Computed AS -Value PERSISTED UNIQUE,
    CONSTRAINT PK_Sample PRIMARY KEY CLUSTERED (Id)
        WITH (FILLFACTOR = 95, ONLINE = ON) ON [PRIMARY]
);
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /ConstraintIndexTail\(/);
        assert.match(tree, /Foreign,Key,ReferencesClause/);
        assert.equal((tree.match(/ColumnConstraint\(/g) ?? []).length >= 4, true);
    });

    // ScriptDOM accepts a column-level FOREIGN KEY with an explicit local column list.
    test("parses column-level foreign key column lists", () => {
        const snapshot = parse(`
CREATE TABLE dbo.History (
    parent_tracer_id int NOT NULL,
    agent_id int NOT NULL,
    subscriber_commit datetime NULL
        CONSTRAINT fk_tokens FOREIGN KEY (parent_tracer_id)
        REFERENCES dbo.MStracer_tokens (tracer_id)
);
`);

        assertValid(snapshot);
        assert.match(
            snapshot.tree.toString(),
            /ColumnConstraint\(Constraint,IdentifierName\(Identifier\),Foreign,Key,ColumnNameList/,
        );
    });

    // ScriptDOM treats SET @cursor = CURSOR ... FOR SELECT as a cursor definition assignment.
    test("parses cursor definition assignment", () => {
        const snapshot = parse(`
SET @CursorVar = CURSOR SCROLL DYNAMIC
FOR SELECT LastName FROM Northwind.dbo.Employees;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /SetCursorAssignment\(/);
    });

    // Application-role option names are identifier-shaped, including the contextual LOGIN name.
    test("parses application-role LOGIN options", () => {
        const snapshot = parse(`
CREATE APPLICATION ROLE weekly_receipts
    WITH PASSWORD = '987', DEFAULT_SCHEMA = Sales;
ALTER APPLICATION ROLE receipts_ledger
    WITH NAME = weekly_ledger, PASSWORD = '897', DEFAULT_SCHEMA = Production, LOGIN = l1;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/ApplicationRoleOption\(/g) ?? []).length, 6);
    });

    // Security statements accept multiword permission names containing reserved keywords.
    test("parses multiword server and external permissions", () => {
        const snapshot = parse(`
GRANT ALTER ANY EXTERNAL DATA SOURCE TO data_engineer;
GRANT VIEW SERVER STATE TO observer;
DENY IMPERSONATE ON LOGIN::app_login TO support_user;
GRANT CREATE TABLE TO app_user;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/PermissionStatement\(/g) ?? []).length, 4);
    });

    // Scalar type/default forms cover CHAR VARYING and qualified default expressions.
    test("parses varying types and qualified default atoms", () => {
        const snapshot = parse(`
CREATE TABLE dbo.LegacyTypes (
    Label char varying(20) DEFAULT dbo.default_label,
    Flags int DEFAULT ~23
);
`);

        assertValid(snapshot);
    });
});
