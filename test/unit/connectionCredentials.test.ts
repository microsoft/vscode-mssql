/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as Constants from "../../src/constants/constants";
import * as stubs from "./stubs";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { AuthenticationTypes } from "../../src/models/interfaces";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

import * as assert from "assert";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";

suite("ConnectionCredentials Tests", () => {
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);

        // setup default behavior for vscodeWrapper
        // setup configuration to return maxRecent for the #MRU items
        let maxRecent = 5;
        let configResult: { [key: string]: any } = {};
        configResult[Constants.configMaxRecentConnections] = maxRecent;
        let config = stubs.createWorkspaceConfiguration(configResult);
        vscodeWrapper
            .setup((x) => x.getConfiguration(TypeMoq.It.isAny()))
            .returns((_x) => {
                return config;
            });
    });

    suite("ConnectionDetails conversion tests", () => {
        // A connection string can be set alongside other properties for createConnectionDetails
        test("createConnectionDetails sets properties in addition to the connection string", () => {
            let credentials = new ConnectionCredentials();
            credentials.connectionString = "server=some-server";
            credentials.database = "some-db";

            let connectionDetails = ConnectionCredentials.createConnectionDetails(credentials);
            assert.equal(connectionDetails.options.connectionString, credentials.connectionString);
            assert.equal(connectionDetails.options.database, credentials.database);
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

            assert.equal(connInfo.server, connDetails.options.server);
            assert.equal(connInfo.user, connDetails.options.user);
            assert.equal(connInfo.password, connDetails.options.password);
            assert.equal(connInfo.port, 1234);
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

            const connDetails = ConnectionCredentials.createConnectionDetails(originalConnInfo);
            const convertedConnInfo = ConnectionCredentials.createConnectionInfo(connDetails);

            for (const key in originalConnInfo) {
                assert.equal(
                    originalConnInfo[key as keyof IConnectionInfo],
                    convertedConnInfo[key as keyof IConnectionInfo],
                    `Mismatch on ${key}`,
                );
            }
        });
    });
});
