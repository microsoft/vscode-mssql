/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("azure-database.sql");

suite("Azure SQL database grammar", () => {
    // Verifies Azure database copies retain server-qualified sources and service objectives.
    test("parses CREATE DATABASE AS COPY OF", () => {
        const snapshot = parse(`
CREATE DATABASE db_copy AS COPY OF server1.source_db
  (SERVICE_OBJECTIVE = elastic_pool(NAME = [pool1]));`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /AzureDatabaseOptions\(/);
    });

    // Verifies Azure CREATE and ALTER accept size units and nested elastic-pool options.
    test("parses Azure service-tier option lists", () => {
        const snapshot = parse(`
CREATE DATABASE db1 (MAXSIZE = 100 MB, EDITION = 'business');
ALTER DATABASE db1 MODIFY (SERVICE_OBJECTIVE = elastic_pool(NAME = [pool2]));`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/AzureDatabaseOptions\(/g) ?? []).length, 2);
    });

    // Verifies a copy requires its OF source rather than accepting a truncated statement.
    test("reports an incomplete Azure database copy", () => {
        assert.ok(parse("CREATE DATABASE db_copy AS COPY OF;").diagnostics.length > 0);
    });
});
