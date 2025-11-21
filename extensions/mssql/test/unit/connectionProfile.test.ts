/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { IConnectionInfo } from "vscode-mssql";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { AuthenticationTypes } from "../../src/models/interfaces";
import { expect } from "chai";

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
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Port number is applied to server name when connection credentials are transformed into details", () => {
    // Given a connection credentials object with server and a port
    const creds = new ConnectionCredentials();
    creds.server = "my-server";
    creds.port = 1234;

    // When credentials are transformed into a details contract
    const details = ConnectionCredentials.createConnectionDetails(creds);

    // Server name should be in the format <address>,<port>
    expect(details.options["server"]).to.equal("my-server,1234");
  });

  test("All connection details properties can be set from connection credentials", () => {
    const creds = createTestCredentials();
    const details = ConnectionCredentials.createConnectionDetails(creds);

    expect(details.options["applicationIntent"]).to.not.be.undefined;
    expect(details.options["applicationName"]).to.not.be.undefined;
    expect(details.options["attachDbFilename"]).to.not.be.undefined;
    expect(details.options["authenticationType"]).to.not.be.undefined;
    expect(details.options["connectRetryCount"]).to.not.be.undefined;
    expect(details.options["connectRetryInterval"]).to.not.be.undefined;
    expect(details.options["connectTimeout"]).to.not.be.undefined;
    expect(details.options["commandTimeout"]).to.not.be.undefined;
    expect(details.options["currentLanguage"]).to.not.be.undefined;
    expect(details.options["database"]).to.not.be.undefined;
    expect(details.options["encrypt"]).to.not.be.undefined;
    expect(details.options["failoverPartner"]).to.not.be.undefined;
    expect(details.options["loadBalanceTimeout"]).to.not.be.undefined;
    expect(details.options["maxPoolSize"]).to.not.be.undefined;
    expect(details.options["minPoolSize"]).to.not.be.undefined;
    expect(details.options["multipleActiveResultSets"]).to.not.be.undefined;
    expect(details.options["multiSubnetFailover"]).to.not.be.undefined;
    expect(details.options["packetSize"]).to.not.be.undefined;
    expect(details.options["password"]).to.not.be.undefined;
    expect(details.options["persistSecurityInfo"]).to.not.be.undefined;
    expect(details.options["columnEncryptionSetting"]).to.not.be.undefined;
    expect(details.options["attestationProtocol"]).to.not.be.undefined;
    expect(details.options["enclaveAttestationUrl"]).to.not.be.undefined;
    expect(details.options["pooling"]).to.not.be.undefined;
    expect(details.options["replication"]).to.not.be.undefined;
    expect(details.options["server"]).to.not.be.undefined;
    expect(details.options["trustServerCertificate"]).to.not.be.undefined;
    expect(details.options["hostNameInCertificate"]).to.not.be.undefined;
    expect(details.options["typeSystemVersion"]).to.not.be.undefined;
    expect(details.options["user"]).to.not.be.undefined;
    expect(details.options["workstationId"]).to.not.be.undefined;
  });
});
