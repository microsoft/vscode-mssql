/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("event-session.sql");

suite("T-SQL Extended Events session grammar", () => {
    // Verifies event SET/ACTION/WHERE clauses, NOT LIKE, a target, and unit-bearing options.
    test("parses a complete server-scoped event session", () => {
        const snapshot = parse(`
CREATE EVENT SESSION [test_not_like] ON SERVER
ADD EVENT sqlserver.sql_statement_completed
(
    ACTION(sqlserver.sql_text)
    WHERE ([sqlserver].[like_i_sql_unicode_string]([sqlserver].[sql_text], N'%foo%')
       AND [sqlserver].[client_app_name] NOT LIKE N'SQLAgent%')
)
ADD TARGET package0.event_file (SET filename=N'test_not_like.xel')
WITH (
    MAX_MEMORY=4096 KB,
    EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS,
    MAX_DISPATCH_LATENCY=30 SECONDS,
    TRACK_CAUSALITY=OFF
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateEventSessionStatement\(/);
        assert.match(tree, /EventSessionActionClause\(/);
        assert.match(tree, /EventSessionWhereClause\(/);
        assert.match(tree, /EventSessionTargetDeclaration\(/);
        assert.match(tree, /EventSessionWithClause\(/);
    });

    // Verifies database scope, multiple ALTER actions, runtime state changes, and DROP.
    test("parses database-scoped event session lifecycle statements", () => {
        const snapshot = parse(`
CREATE EVENT SESSION es1 ON DATABASE
ADD EVENT package.event_name (SET value = -5.1 ACTION (package.field) WHERE package.field != 5),
ADD TARGET package.target_name (SET filename = N'test.xel');
ALTER EVENT SESSION es1 ON DATABASE ADD EVENT package.second, DROP TARGET package.target_name
WITH (MAX_MEMORY = 4 MB);
ALTER EVENT SESSION es1 ON DATABASE STATE = START;
ALTER EVENT SESSION es1 ON DATABASE STATE = STOP;
DROP EVENT SESSION es1 ON DATABASE;`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /AlterEventSessionStatement\(/);
        assert.match(tree, /DropEventSessionStatement\(/);
    });

    // Verifies a filtering clause cannot omit its required Boolean expression.
    test("reports a missing event predicate", () => {
        const snapshot = parse("CREATE EVENT SESSION es ON SERVER ADD EVENT p.e (WHERE);");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies ALTER STATE accepts only the SQL Server START and STOP states.
    test("reports an unsupported event-session state", () => {
        const snapshot = parse("ALTER EVENT SESSION es ON SERVER STATE = PAUSE;");
        assert.ok(snapshot.diagnostics.length > 0);
    });
});
