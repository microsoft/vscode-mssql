/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("database-matrix.sql");

suite("T-SQL database grammar matrix", () => {
    // Verifies CREATE DATABASE preserves primary files, filegroups, size units, log files, and options.
    test("parses complete CREATE DATABASE storage matrices", () => {
        const snapshot = parse(`
CREATE DATABASE Sales
ON PRIMARY
  (NAME = SalesPrimary, FILENAME = 'c:\\data.mdf', SIZE = 10 MB, MAXSIZE = UNLIMITED, FILEGROWTH = 15%),
FILEGROUP HotData CONTAINS FILESTREAM DEFAULT
  (NAME = SalesHot, FILENAME = 'c:\\hot.ndf', SIZE = 1 GB)
LOG ON
  (NAME = SalesLog, FILENAME = 'c:\\sales.ldf', SIZE = 128 MB, FILEGROWTH = 64 MB)
COLLATE Latin1_General_100_CI_AS_SC_UTF8
WITH TRUSTWORTHY ON, DB_CHAINING OFF, FILESTREAM(NON_TRANSACTED_ACCESS = READ_ONLY);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /DatabaseFileClause/);
        assert.match(snapshot.tree.toString(), /DatabaseLogClause/);
        assert.match(snapshot.tree.toString(), /DatabaseOptionArguments/);
    });

    // Verifies CREATE DATABASE attach, snapshot, containment, and Azure copy/service options.
    test("parses CREATE DATABASE lifecycle addenda", () => {
        const snapshot = parse(`
CREATE DATABASE Archive ON (FILENAME = 'archive.mdf') FOR ATTACH_REBUILD_LOG WITH ENABLE_BROKER;
CREATE DATABASE SnapshotDb ON (NAME = Data1, FILENAME = 'data.ss') AS SNAPSHOT OF Sales;
CREATE DATABASE ContainedDb CONTAINMENT = PARTIAL WITH NESTED_TRIGGERS = ON;
CREATE DATABASE CopyDb AS COPY OF server1.SourceDb
  (SERVICE_OBJECTIVE = ELASTIC_POOL(NAME = [pool1]));`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/CreateDatabaseStatement\(/g) ?? []).length,
            4,
        );
    });

    // Verifies ALTER DATABASE supports all file mutations, filegroup states, and rebuild-log forms.
    test("parses ALTER DATABASE file and filegroup matrices", () => {
        const snapshot = parse(`
ALTER DATABASE Sales ADD FILE (NAME = Data2, FILENAME = 'data2.ndf'),
  (NAME = Data3, FILENAME = 'data3.ndf') TO FILEGROUP HotData;
ALTER DATABASE Sales ADD LOG FILE (NAME = Log2, FILENAME = 'log2.ldf');
ALTER DATABASE Sales MODIFY FILE (OFFLINE, NAME = Data2, NEWNAME = DataArchive);
ALTER DATABASE Sales MODIFY FILEGROUP HotData READ_WRITE WITH ROLLBACK AFTER 10 SECONDS;
ALTER DATABASE Sales REMOVE FILE DataArchive;
ALTER DATABASE Sales REMOVE FILEGROUP HotData;
ALTER DATABASE Sales REBUILD LOG ON (NAME = SalesLog, FILENAME = 'sales.ldf');`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/AlterDatabaseStatement\(/g) ?? []).length, 7);
    });

    // Verifies nested QUERY_STORE/change-tracking options and transaction termination stay bounded.
    test("parses ALTER DATABASE option matrices", () => {
        const snapshot = parse(`
ALTER DATABASE db SET QUERY_STORE = ON(
  DESIRED_STATE = READ_WRITE,
  CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 367)
);
ALTER DATABASE db SET CHANGE_TRACKING = ON(AUTO_CLEANUP = ON, CHANGE_RETENTION = 3 DAYS);
ALTER DATABASE db SET HADR AVAILABILITY GROUP = ag1;
ALTER DATABASE db SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
ALTER DATABASE db MODIFY (SERVICE_OBJECTIVE = 'HS_Gen5_16') WITH MANUAL_CUTOVER;
ALTER DATABASE db PERFORM_CUTOVER;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/AlterDatabaseStatement\(/g) ?? []).length, 6);
    });

    // Verifies database-scoped settings and encryption-key protectors retain their complete forms.
    test("parses scoped configuration and database encryption keys", () => {
        const snapshot = parse(`
ALTER DATABASE SCOPED CONFIGURATION FOR SECONDARY SET TXN_PRIORITY_MODE = ROLLBACK;
ALTER DATABASE SCOPED CONFIGURATION CLEAR PROCEDURE_CACHE 0x0600;
CREATE DATABASE ENCRYPTION KEY WITH ALGORITHM = AES_256
  ENCRYPTION BY SERVER CERTIFICATE enc1;
ALTER DATABASE ENCRYPTION KEY REGENERATE WITH ALGORITHM = AES_192
  ENCRYPTION BY SERVER ASYMMETRIC KEY key1;
DROP DATABASE ENCRYPTION KEY;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/DatabaseEncryptionKeyStatement\(/g) ?? []).length,
            3,
        );
    });

    // Verifies incomplete file and rollback clauses remain syntax errors instead of being swallowed.
    test("reports truncated database clauses", () => {
        assert.ok(parse("CREATE DATABASE db ON (NAME = data, FILENAME =);").diagnostics.length > 0);
        assert.ok(
            parse("ALTER DATABASE db SET SINGLE_USER WITH ROLLBACK AFTER;").diagnostics.length > 0,
        );
    });
});
