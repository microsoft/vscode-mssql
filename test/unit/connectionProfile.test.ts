/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { AuthenticationTypes } from "../../src/models/interfaces";

function createTestCredentials(): IConnectionInfo {
    const creds: IConnectionInfo = {
        server: "my-server",
        database: "my_db",
        user: "sa",
        password: "12345678",
        email: "test-email",
        accountId: "test-account-id",
        tenantId: "test-tenant-id",
        port: 1234,
        authenticationType: AuthenticationTypes[AuthenticationTypes.SqlLogin],
        azureAccountToken: "",
        expiresOn: 0,
        encrypt: "Optional",
        trustServerCertificate: false,
        hostNameInCertificate: "",
        persistSecurityInfo: false,
        columnEncryptionSetting: "Enabled",
        secureEnclaves: "Enabled",
        attestationProtocol: "HGS",
        enclaveAttestationUrl: "https://attestationurl",
        connectTimeout: 15,
        commandTimeout: 30,
        connectRetryCount: 0,
        connectRetryInterval: 0,
        applicationName: "vscode-mssql",
        workstationId: "test",
        applicationIntent: "",
        currentLanguage: "",
        pooling: true,
        maxPoolSize: 15,
        minPoolSize: 0,
        loadBalanceTimeout: 0,
        replication: false,
        attachDbFilename: "",
        failoverPartner: "",
        multiSubnetFailover: false,
        multipleActiveResultSets: false,
        packetSize: 8192,
        typeSystemVersion: "Latest",
        connectionString: "",
        containerName: "",
    };
    return creds;
}

suite("Connection Profile tests", () => {
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.IMock<
        vscode.Memento & { setKeysForSync(keys: readonly string[]): void }
    >;

    setup(() => {
        globalstate = TypeMoq.Mock.ofType<
            vscode.Memento & { setKeysForSync(keys: readonly string[]): void }
        >();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.globalState).returns(() => globalstate.object);
    });

    test("Port number is applied to server name when connection credentials are transformed into details", () => {
        // Given a connection credentials object with server and a port
        let creds = new ConnectionCredentials();
        creds.server = "my-server";
        creds.port = 1234;

        // When credentials are transformed into a details contract
        const details = ConnectionCredentials.createConnectionDetails(creds);

        // Server name should be in the format <address>,<port>
        assert.strictEqual(details.options["server"], "my-server,1234");
    });

    test("All connection details properties can be set from connection credentials", () => {
        const creds = createTestCredentials();
        const details = ConnectionCredentials.createConnectionDetails(creds);

        assert.notStrictEqual(typeof details.options["applicationIntent"], "undefined");
        assert.notStrictEqual(typeof details.options["applicationName"], "undefined");
        assert.notStrictEqual(typeof details.options["attachDbFilename"], "undefined");
        assert.notStrictEqual(typeof details.options["authenticationType"], "undefined");
        assert.notStrictEqual(typeof details.options["connectRetryCount"], "undefined");
        assert.notStrictEqual(typeof details.options["connectRetryInterval"], "undefined");
        assert.notStrictEqual(typeof details.options["connectTimeout"], "undefined");
        assert.notStrictEqual(typeof details.options["commandTimeout"], "undefined");
        assert.notStrictEqual(typeof details.options["currentLanguage"], "undefined");
        assert.notStrictEqual(typeof details.options["database"], "undefined");
        assert.notStrictEqual(typeof details.options["encrypt"], "undefined");
        assert.notStrictEqual(typeof details.options["failoverPartner"], "undefined");
        assert.notStrictEqual(typeof details.options["loadBalanceTimeout"], "undefined");
        assert.notStrictEqual(typeof details.options["maxPoolSize"], "undefined");
        assert.notStrictEqual(typeof details.options["minPoolSize"], "undefined");
        assert.notStrictEqual(typeof details.options["multipleActiveResultSets"], "undefined");
        assert.notStrictEqual(typeof details.options["multiSubnetFailover"], "undefined");
        assert.notStrictEqual(typeof details.options["packetSize"], "undefined");
        assert.notStrictEqual(typeof details.options["password"], "undefined");
        assert.notStrictEqual(typeof details.options["persistSecurityInfo"], "undefined");
        assert.notStrictEqual(typeof details.options["columnEncryptionSetting"], "undefined");
        assert.notStrictEqual(typeof details.options["attestationProtocol"], "undefined");
        assert.notStrictEqual(typeof details.options["enclaveAttestationUrl"], "undefined");
        assert.notStrictEqual(typeof details.options["pooling"], "undefined");
        assert.notStrictEqual(typeof details.options["replication"], "undefined");
        assert.notStrictEqual(typeof details.options["server"], "undefined");
        assert.notStrictEqual(typeof details.options["trustServerCertificate"], "undefined");
        assert.notStrictEqual(typeof details.options["hostNameInCertificate"], "undefined");
        assert.notStrictEqual(typeof details.options["typeSystemVersion"], "undefined");
        assert.notStrictEqual(typeof details.options["user"], "undefined");
        assert.notStrictEqual(typeof details.options["workstationId"], "undefined");
    });
});
