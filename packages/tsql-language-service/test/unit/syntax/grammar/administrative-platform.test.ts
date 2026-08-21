/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("administrative-platform.sql");

suite("T-SQL administrative platform grammar", () => {
    // Security policies retain predicate actions, policy options, and replication state changes.
    test("parses security policy lifecycle statements", () => {
        const snapshot = parse(`
CREATE SECURITY POLICY dbo.TenantPolicy
    ADD FILTER PREDICATE dbo.FilterTenant(TenantId) ON sales.Orders,
    ADD BLOCK PREDICATE dbo.FilterTenant(TenantId) ON sales.Orders BEFORE UPDATE
    WITH (STATE = ON, SCHEMABINDING = OFF)
    NOT FOR REPLICATION;
ALTER SECURITY POLICY dbo.TenantPolicy
    DROP FILTER PREDICATE ON sales.Orders,
    ALTER BLOCK PREDICATE dbo.FilterTenant(TenantId) ON sales.Orders AFTER INSERT;
ALTER SECURITY POLICY dbo.TenantPolicy DROP NOT FOR REPLICATION;
DROP SECURITY POLICY IF EXISTS dbo.TenantPolicy;
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/SecurityPolicyStatement\(/g) ?? []).length,
            4,
        );
    });

    // Audit statements cover file destinations, state changes, and audit renames.
    test("parses server audit lifecycle statements", () => {
        const snapshot = parse(`
CREATE SERVER AUDIT ComplianceAudit TO FILE
    (FILEPATH = 'C:\\audit', MAXSIZE = 10 MB)
    WITH (QUEUE_DELAY = 1000, ON_FAILURE = CONTINUE);
ALTER SERVER AUDIT ComplianceAudit WITH (STATE = ON);
ALTER SERVER AUDIT ComplianceAudit MODIFY NAME = ArchivedAudit;
DROP SERVER AUDIT ArchivedAudit;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/AuditStatement\(/g) ?? []).length, 4);
    });

    // Audit specifications use action groups and object permission actions.
    test("parses server and database audit specifications", () => {
        const snapshot = parse(`
CREATE SERVER AUDIT SPECIFICATION ServerSpec FOR SERVER AUDIT ComplianceAudit
    ADD (FAILED_LOGIN_GROUP), ADD (SUCCESSFUL_LOGIN_GROUP) WITH (STATE = ON);
ALTER SERVER AUDIT SPECIFICATION ServerSpec DROP (FAILED_LOGIN_GROUP);
CREATE DATABASE AUDIT SPECIFICATION DatabaseSpec FOR SERVER AUDIT ComplianceAudit
    ADD (SELECT, INSERT ON dbo.Customer BY public) WITH (STATE = ON);
DROP DATABASE AUDIT SPECIFICATION DatabaseSpec;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/AuditStatement\(/g) ?? []).length, 4);
    });

    // Server configuration statements cover bounded paths and affinity ranges.
    test("parses server configuration settings", () => {
        const snapshot = parse(`
ALTER SERVER CONFIGURATION SET DIAGNOSTICS LOG MAX_SIZE = 852 MB;
ALTER SERVER CONFIGURATION SET FAILOVER CLUSTER PROPERTY VerboseLogging = 2;
ALTER SERVER CONFIGURATION SET BUFFER POOL EXTENSION ON (FILENAME = 'cache.bpe', SIZE = 4 GB);
ALTER SERVER CONFIGURATION SET HADR CLUSTER CONTEXT = LOCAL;
ALTER SERVER CONFIGURATION SET PROCESS AFFINITY CPU = 1, 3 TO 5, 8;
ALTER SERVER CONFIGURATION SET SOFTNUMA ON;
ALTER SERVER CONFIGURATION SET EXTERNAL AUTHENTICATION ON (USE_IDENTITY);
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/ServerConfigurationStatement\(/g) ?? []).length,
            7,
        );
    });

    // SQL Server 2016+ database-scoped configuration supports secondary and cache-clear forms.
    test("parses database-scoped configuration settings", () => {
        const snapshot = parse(`
ALTER DATABASE SCOPED CONFIGURATION SET MAXDOP = 4;
ALTER DATABASE SCOPED CONFIGURATION FOR SECONDARY SET MAXDOP = PRIMARY;
ALTER DATABASE SCOPED CONFIGURATION CLEAR PROCEDURE_CACHE;
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/DatabaseScopedConfigurationStatement\(/g) ?? [])
                .length,
            3,
        );
    });

    // Resource Governor fixtures combine scalar options, affinity ranges, and pool binding.
    test("parses resource pools and workload groups", () => {
        const snapshot = parse(`
CREATE RESOURCE POOL reporting WITH
    (MIN_CPU_PERCENT = 10, AFFINITY SCHEDULER = (4, 5 TO 6));
ALTER EXTERNAL RESOURCE POOL python_pool WITH
    (MAX_MEMORY_PERCENT = 50, AFFINITY NUMANODE = (1 TO 5));
CREATE WORKLOAD GROUP reports WITH (GROUP_MIN_MEMORY_PERCENT = 20) USING reporting;
ALTER RESOURCE GOVERNOR RECONFIGURE;
DROP WORKLOAD GROUP reports;
DROP RESOURCE POOL reporting;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/ResourcePoolStatement\(/g) ?? []).length, 3);
        assert.equal((tree.match(/WorkloadGroupStatement\(/g) ?? []).length, 2);
        assert.match(tree, /ResourceGovernorStatement\(/);
    });

    // Always Encrypted statements contain master-key and multi-value encryption-key DDL.
    test("parses Always Encrypted key objects", () => {
        const snapshot = parse(`
CREATE COLUMN MASTER KEY CMK WITH
    (KEY_STORE_PROVIDER_NAME = 'MSSQL_CERTIFICATE_STORE', KEY_PATH = 'CurrentUser/My/key');
CREATE COLUMN ENCRYPTION KEY CEK WITH VALUES
    (COLUMN_MASTER_KEY = CMK, ALGORITHM = 'RSA_OAEP', ENCRYPTED_VALUE = 0x01),
    (COLUMN_MASTER_KEY = CMK2, ALGORITHM = 'RSA_OAEP', ENCRYPTED_VALUE = 0x02);
ALTER COLUMN ENCRYPTION KEY CEK DROP VALUE
    (COLUMN_MASTER_KEY = CMK2, ALGORITHM = 'RSA_OAEP', ENCRYPTED_VALUE = 0x02);
DROP COLUMN ENCRYPTION KEY CEK;
DROP COLUMN MASTER KEY CMK;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/ColumnMasterKeyStatement\(/g) ?? []).length, 2);
        assert.equal((tree.match(/ColumnEncryptionKeyStatement\(/g) ?? []).length, 3);
    });

    // A missing audit destination is rejected at the SQL Server token rather than hiding the tail.
    test("reports a malformed server audit at its missing destination", () => {
        const snapshot = parse("CREATE SERVER AUDIT BrokenAudit TO;");

        assert.equal(snapshot.statistics.rawErrorNodeCount > 0, true);
        assert.equal(snapshot.diagnostics.length > 0, true);
        assert.equal(snapshot.diagnostics[0]?.message, "Incorrect syntax near ';'.");
    });
});
