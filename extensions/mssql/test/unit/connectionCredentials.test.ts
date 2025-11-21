/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as Constants from "../../src/constants/constants";
import * as stubs from "./stubs";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { AuthenticationTypes } from "../../src/models/interfaces";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

import { expect } from "chai";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";
import { stubVscodeWrapper } from "./utils";

suite("ConnectionCredentials Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

  setup(() => {
    sandbox = sinon.createSandbox();
    vscodeWrapper = stubVscodeWrapper(sandbox);

    // setup default behavior for vscodeWrapper
    // setup configuration to return maxRecent for the #MRU items
    const maxRecent = 5;
    const configResult: { [key: string]: any } = {};
    configResult[Constants.configMaxRecentConnections] = maxRecent;
    const config = stubs.createWorkspaceConfiguration(configResult);
    vscodeWrapper.getConfiguration.returns(config);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite("ConnectionDetails conversion tests", () => {
    // A connection string can be set alongside other properties for createConnectionDetails
    test("createConnectionDetails sets properties in addition to the connection string", () => {
      const credentials = new ConnectionCredentials();
      credentials.connectionString = "server=some-server";
      credentials.database = "some-db";

      const connectionDetails =
        ConnectionCredentials.createConnectionDetails(credentials);
      expect(
        connectionDetails.options.connectionString,
        "Connection string should match input credentials",
      ).to.equal(credentials.connectionString);
      expect(
        connectionDetails.options.database,
        "Database should match input credentials",
      ).to.equal(credentials.database);
    });

    test("createConnectionDetails sets properties from the connection string", () => {
      const connDetails: ConnectionDetails = {
        options: {
          server: "someServer,1234",
          user: "testUser",
          password: "testPassword",
        },
      };

      const connInfo = ConnectionCredentials.createConnectionInfo(connDetails);

      expect(connInfo.server).to.equal(connDetails.options.server);
      expect(connInfo.user).to.equal(connDetails.options.user);
      expect(connInfo.password).to.equal(connDetails.options.password);
      expect(connInfo.port).to.equal(1234);
    });

    test("IConnectionInfo-ConnectionDetails conversion roundtrip", () => {
      const originalConnInfo: IConnectionInfo = {
        server: "testServer,1234",
        database: "testDatabase",
        user: "testUser",
        password: "testPassword",
        email: "testEmail@contoso.com",
        accountId: "testAccountid",
        tenantId: "testTenantId",
        port: 1234,
        authenticationType: AuthenticationTypes[AuthenticationTypes.SqlLogin],
        azureAccountToken: "testToken",
        expiresOn: 5678,
        encrypt: "Strict",
        trustServerCertificate: true,
        hostNameInCertificate: "testHostName",
        persistSecurityInfo: true,
        secureEnclaves: "testSecureEnclaves",
        columnEncryptionSetting: "Enabled",
        attestationProtocol: "HGS",
        enclaveAttestationUrl: "testEnclaveAttestationUrl",
        connectTimeout: 7,
        commandTimeout: 11,
        connectRetryCount: 17,
        connectRetryInterval: 19,
        applicationName: "testApplicationName",
        workstationId: "testWorkstationId",
        applicationIntent: "ReadOnly",
        currentLanguage: "",
        pooling: true,
        maxPoolSize: 23,
        minPoolSize: 29,
        loadBalanceTimeout: 31,
        replication: true,
        attachDbFilename: "testAttachDbFilename",
        failoverPartner: "testFailoverPartner",
        multiSubnetFailover: true,
        multipleActiveResultSets: true,
        packetSize: 37,
        typeSystemVersion: "testTypeSystemVersion",
        connectionString: "testConnectionString",
        containerName: "",
      };

      const connDetails =
        ConnectionCredentials.createConnectionDetails(originalConnInfo);
      const convertedConnInfo =
        ConnectionCredentials.createConnectionInfo(connDetails);

      for (const key in originalConnInfo) {
        expect(
          convertedConnInfo[key as keyof IConnectionInfo],
          `Mismatch on ${key}`,
        ).to.equal(originalConnInfo[key as keyof IConnectionInfo]);
      }
    });
  });
});
