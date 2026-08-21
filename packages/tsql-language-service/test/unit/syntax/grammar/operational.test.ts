/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} from "../../../../src/index.ts";

import { createSyntaxHarness, syntaxTree } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("operational.sql");

suite("T-SQL backup, restore, and DBCC grammar", () => {
    // Verifies database and log backups retain physical devices and bounded WITH options.
    test("parses backup database and log statements", () => {
        const snapshot = parse(`
BACKUP DATABASE DemoDb TO DISK = N'C:\\backup\\DemoDb.bak'
WITH COPY_ONLY, COMPRESSION, STATS = 10;
BACKUP LOG DemoDb TO URL = N'https://account.blob.core.windows.net/backups/Demo.trn';
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/BackupStatement\(/g) ?? []).length, 2);
        assert.match(snapshot.tree.toString(), /BackupRestoreWithClause\(/);
    });

    // Verifies metadata-only and database RESTORE forms share the device and option grammar.
    test("parses restore inspection and database statements", () => {
        const snapshot = parse(`
RESTORE FILELISTONLY FROM DISK = N'C:\\backup\\DemoDb.bak';
RESTORE DATABASE DemoDb FROM DISK = N'C:\\backup\\DemoDb.bak'
WITH MOVE = N'DemoDb', REPLACE, RECOVERY;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/RestoreStatement\(/g) ?? []).length, 2);
        assert.match(snapshot.tree.toString(), /RestoreInspection\(FileListOnly\)/);
    });

    // Verifies common DBCC commands retain literal, named, negative, and WITH option arguments.
    test("parses DBCC command families", () => {
        const snapshot = parse(`
DBCC CHECKDB (DemoDb) WITH NO_INFOMSGS, ALL_ERRORMSGS;
DBCC SHRINKFILE (N'DemoDb_log', 1024);
DBCC TRACEON (1222, -1);
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/DbccStatement\(/g) ?? []).length, 3);
        assert.match(snapshot.tree.toString(), /DbccWithClause\(/);
    });

    // Verifies a missing backup device remains an exact visible syntax error.
    test("reports malformed backup devices", () => {
        const sql = "BACKUP DATABASE DemoDb TO DISK = ;";
        const snapshot = parse(sql);
        const semicolon = sql.indexOf(";");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.range.start === semicolon));
    });

    // Verifies an unterminated DBCC argument list remains visible rather than being accepted.
    test("reports malformed DBCC argument lists", () => {
        const sql = "DBCC CHECKDB (DemoDb;";
        const snapshot = parse(sql);

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies editing a backup option produces the same native-incremental and fresh result.
    test("keeps operational incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const sql = "BACKUP DATABASE DemoDb TO DISK = N'Demo.bak' WITH STATS = 10;";
        const firstDocument = new ImmutableTextSnapshot("file:///operations.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.lastIndexOf("10");
        const change = { start, end: start + 2, text: "20" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });
});
