/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL ScriptDOM core regression grammar", () => {
    // ScriptDOM's UTF-8 fixtures commonly decode with a leading BOM, which is source trivia.
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

    // ScriptDOM TemporalSelectTest130.sql covers every legal FOR SYSTEM_TIME interval shape.
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

    // ScriptDOM constraint fixtures combine replication modifiers, index options, and storage placement.
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

    // ScriptDOM security fixtures use multiword permission names containing reserved keywords.
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

    // ScriptDOM scalar type/default fixtures cover CHAR VARYING and qualified default expressions.
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

function assertValid(snapshot) {
    assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
    assert.deepEqual(snapshot.diagnostics, []);
}

function parse(sql) {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///scriptdom-core-regression.sql", 1, sql),
    );
}
