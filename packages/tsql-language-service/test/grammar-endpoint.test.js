/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL endpoint grammar", () => {
    // Verifies TCP/HTTP endpoint transports retain state, IP, authentication, and port options.
    test("parses TCP and HTTP endpoint options", () => {
        const snapshot = parse(`
CREATE ENDPOINT e1 STATE = STOPPED
AS TCP (LISTENER_IP = (1.2.3.4), LISTENER_PORT = 4022) FOR TSQL();
CREATE ENDPOINT e2 AS HTTP (
  AUTHENTICATION = (BASIC, DIGEST, INTEGRATED, NTLM, KERBEROS),
  PORTS = (SSL, CLEAR), COMPRESSION = ENABLED
) FOR TSQL();`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /EndpointValue/);
    });

    // Verifies SOAP web methods and multiword Service Broker authentication/encryption values.
    test("parses SOAP and Service Broker endpoint payloads", () => {
        const snapshot = parse(`
CREATE ENDPOINT soap_endpoint AS TCP (LISTENER_PORT = 4022)
FOR SOAP (
  WEBMETHOD 'n1'.'m1' (NAME = 'd1.dbo.n1'),
  WEBMETHOD 'm2' (NAME = 'zzz', SCHEMA = NONE, FORMAT = ALL_RESULTS)
);
CREATE ENDPOINT broker_endpoint AS TCP (LISTENER_PORT = 4022)
FOR SERVICE_BROKER (
  AUTHENTICATION = WINDOWS KERBEROS CERTIFICATE c1,
  ENCRYPTION = SUPPORTED ALGORITHM RC4 AES
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /EndpointWebMethodOption/);
    });

    // Verifies ALTER supports affinity/state lists and SOAP web-method lifecycle operations.
    test("parses ALTER ENDPOINT options and web methods", () => {
        const snapshot = parse(`
ALTER ENDPOINT e1 AFFINITY = NONE, STATE = STARTED;
ALTER ENDPOINT e1 FOR SOAP (
  ADD WEBMETHOD 'm1' (NAME = 'n1'),
  ALTER WEBMETHOD 'm2' (NAME = 'n2'),
  DROP WEBMETHOD 'm3'
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /EndpointAlterOptionList/);
    });

    // Verifies an endpoint assignment cannot omit its required value.
    test("reports a missing endpoint option value", () => {
        const snapshot = parse("CREATE ENDPOINT e AS TCP (LISTENER_PORT =) FOR TSQL();");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies WEBMETHOD requires a quoted method name.
    test("reports an unquoted SOAP web-method name", () => {
        const snapshot = parse(
            "CREATE ENDPOINT e AS TCP (LISTENER_PORT = 1) FOR SOAP (WEBMETHOD m (NAME='p'));",
        );
        assert.ok(snapshot.diagnostics.length > 0);
    });
});

function parse(sql) {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///endpoint.sql", 1, sql),
    );
}
