/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} = require("../../../dist/index.js");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("security-service.sql");

suite("T-SQL cryptography, Service Broker, and availability grammar", () => {
    // Verifies certificate and master-key lifecycle forms retain encryption and private-key structure.
    test("parses certificates and master keys", () => {
        const snapshot = parse(`
CREATE CERTIFICATE shipping ENCRYPTION BY PASSWORD = 'p1'
WITH SUBJECT = 'Shipping', EXPIRY_DATE = '10/31/2029';
ALTER CERTIFICATE shipping REMOVE PRIVATE KEY;
DROP CERTIFICATE shipping;
CREATE MASTER KEY ENCRYPTION BY PASSWORD = N'p1';
ALTER MASTER KEY ADD ENCRYPTION BY SERVICE MASTER KEY;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /CreateCertificateStatement\(/);
        assert.match(snapshot.tree.toString(), /MasterKeyStatement\(/);
    });

    // Verifies symmetric-key encryption relationships and credentials have explicit lifecycle nodes.
    test("parses symmetric keys and credentials", () => {
        const snapshot = parse(`
CREATE SYMMETRIC KEY k1 AUTHORIZATION dbo WITH ALGORITHM = AES_256
ENCRYPTION BY CERTIFICATE c1, PASSWORD = 'p1';
ALTER SYMMETRIC KEY k1 DROP ENCRYPTION BY PASSWORD = 'p1';
DROP SYMMETRIC KEY k1;
CREATE CREDENTIAL AlterEgo WITH IDENTITY = 'RettigB', SECRET = 'Secret';
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/SymmetricKeyStatement\(/g) ?? []).length, 3);
        assert.match(snapshot.tree.toString(), /CredentialStatement\(/);
    });

    // Provider-backed keys may omit provider options, add an encryption relationship, and remove
    // the provider key. OPEN supports password-assisted certificate/asymmetric decryption only.
    test("parses provider and decryption symmetric-key forms", () => {
        const snapshot = parse(`
CREATE SYMMETRIC KEY k1 FROM PROVIDER p1;
CREATE SYMMETRIC KEY k2 FROM PROVIDER p1
WITH PROVIDER_KEY_NAME = 'key2', ALGORITHM = AES_256, CREATION_DISPOSITION = OPEN_EXISTING;
CREATE SYMMETRIC KEY k3 FROM PROVIDER p1 ENCRYPTION BY CERTIFICATE c1;
DROP SYMMETRIC KEY k3 REMOVE PROVIDER KEY;
OPEN SYMMETRIC KEY k1 DECRYPTION BY PASSWORD = 'password';
OPEN SYMMETRIC KEY k1 DECRYPTION BY CERTIFICATE c1 WITH PASSWORD = 'p1';
OPEN SYMMETRIC KEY k1 DECRYPTION BY ASYMMETRIC KEY ak1 WITH PASSWORD = N'p1';
OPEN SYMMETRIC KEY k1 DECRYPTION BY SYMMETRIC KEY sk1;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/SymmetricKeyStatement\(/g) ?? []).length, 4);
        assert.equal((snapshot.tree.toString().match(/KeyAccessStatement\(/g) ?? []).length, 4);

        for (const sql of [
            "CREATE SYMMETRIC KEY k FROM PROVIDER p PROVIDER_KEY_NAME = 'x';",
            "DROP SYMMETRIC KEY k REMOVE PROVIDER;",
            "OPEN SYMMETRIC KEY k DECRYPTION BY SYMMETRIC KEY sk WITH PASSWORD = 'p';",
            "OPEN SYMMETRIC KEY k DECRYPTION BY CERTIFICATE WITH PASSWORD = 'p';",
        ]) {
            const damaged = parse(`${sql}\nGO\nSELECT 1;`);
            assert.ok(damaged.diagnostics.length > 0);
            assert.match(damaged.tree.toString(), /SelectStatement\(/);
        }
    });

    // A provider option edit must produce the same tree and diagnostics as a fresh parse.
    test("keeps provider-backed symmetric keys incrementally equivalent", () => {
        const service = new LezerSyntaxService();
        const sql =
            "CREATE SYMMETRIC KEY k FROM PROVIDER p WITH ALGORITHM = AES_128;\nGO\nSELECT 1;";
        const firstDocument = new ImmutableTextSnapshot("file:///provider-key.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("AES_128");
        const change = { start, end: start + "AES_128".length, text: "AES_256" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });

    // Verifies messages, contracts, queues, and services retain Broker topology and activation options.
    test("parses Service Broker object families", () => {
        const snapshot = parse(`
CREATE MESSAGE TYPE m1 VALIDATION = WELL_FORMED_XML;
CREATE CONTRACT c1 (m1 SENT BY INITIATOR);
CREATE QUEUE dbo.q1 WITH STATUS = ON, RETENTION = OFF,
ACTIVATION (STATUS = ON, PROCEDURE_NAME = dbo..p1, MAX_QUEUE_READERS = 23) ON [PRIMARY];
CREATE SERVICE s1 ON QUEUE dbo.q1 (c1);
ALTER SERVICE s1 (ADD CONTRACT c2, DROP CONTRACT c1);
DROP QUEUE .dbo.q1;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /MessageTypeStatement\(/);
        assert.match(tree, /ContractStatement\(/);
        assert.match(tree, /QueueStatement\(/);
        assert.match(tree, /ServiceStatement\(/);
        assert.match(tree, /MultipartOptionValue\(IdentifierName\(Identifier\),Dot,Dot/);
    });

    // MOVE CONVERSATION reassigns a dialog to another conversation group and remains a distinct
    // statement rather than being recovered through DECLARE/cursor syntax.
    test("parses MOVE CONVERSATION statements", () => {
        assertValid("MOVE CONVERSATION @conversation_handle TO @conversation_group_id;");
        assertValid("MOVE CONVERSATION dbo.get_handle() TO @group_id;");

        for (const sql of [
            "MOVE CONVERSATION TO @group_id;",
            "MOVE CONVERSATION @handle @group_id;",
            "MOVE CONVERSATION @handle TO;",
        ]) {
            const damaged = parse(`${sql}\nGO\nSELECT 1;`);
            assert.ok(damaged.diagnostics.length > 0);
            assert.match(damaged.tree.toString(), /SelectStatement\(/);
        }

        const service = new LezerSyntaxService();
        const sql = "MOVE CONVERSATION @handle TO @group1;\nGO\nSELECT 1;";
        const firstDocument = new ImmutableTextSnapshot("file:///move-conversation.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("@group1");
        const change = { start, end: start + 7, text: "@group2" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);
        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });

    // Verifies endpoint transport and payload sections remain distinct bounded containers.
    test("parses endpoints", () => {
        const snapshot = parse(`
CREATE ENDPOINT e1 AUTHORIZATION dbo STATE = STARTED
AS TCP (LISTENER_PORT = 4022, LISTENER_IP = ALL)
FOR TSQL ();
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/EndpointOptionContainer\(/g) ?? []).length,
            2,
        );
    });

    // Verifies availability-group creation, database action, failover target, and removal.
    test("parses availability group lifecycle statements", () => {
        const snapshot = parse(`
CREATE AVAILABILITY GROUP group1 WITH (REQUIRED_COPIES_TO_COMMIT = 1)
FOR DATABASE db1, db2
REPLICA ON 'server1' WITH (
    AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
    FAILOVER_MODE = AUTOMATIC,
    ENDPOINT_URL = 'TCP://server1:5022'
);
ALTER AVAILABILITY GROUP group1 ADD DATABASE db3;
ALTER AVAILABILITY GROUP group1 FAILOVER WITH (TARGET = 'server1');
DROP AVAILABILITY GROUP group1;
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/AvailabilityGroupStatement\(/g) ?? []).length,
            4,
        );
        assert.match(snapshot.tree.toString(), /AvailabilityReplica\(/);
    });

    // Verifies missing certificate names are visible at the exact unexpected token.
    test("reports malformed certificate syntax", () => {
        const snapshot = parse("CREATE CERTIFICATE WITH SUBJECT = 'x';");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies incomplete availability replicas do not become accepted generic option text.
    test("reports malformed availability replicas", () => {
        const sql = "CREATE AVAILABILITY GROUP ag FOR DATABASE db REPLICA ON ;";
        const snapshot = parse(sql);
        const semicolon = sql.indexOf(";");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.range.start === semicolon));
    });

    // Verifies edits inside nested queue activation options equal a fresh parse exactly.
    test("keeps Service Broker incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const sql = "CREATE QUEUE dbo.q WITH ACTIVATION (MAX_QUEUE_READERS = 4);";
        const firstDocument = new ImmutableTextSnapshot("file:///security.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.lastIndexOf("4");
        const change = { start, end: start + 1, text: "8" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });
});
