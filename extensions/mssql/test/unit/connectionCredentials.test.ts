/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { AuthenticationTypes } from "../../src/models/interfaces";

import { expect } from "chai";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";

suite("ConnectionCredentials Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
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

            const connectionDetails = ConnectionCredentials.createConnectionDetails(credentials);
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

            const connDetails = ConnectionCredentials.createConnectionDetails(originalConnInfo);
            const convertedConnInfo = ConnectionCredentials.createConnectionInfo(connDetails);

            for (const key in originalConnInfo) {
                expect(
                    convertedConnInfo[key as keyof IConnectionInfo],
                    `Mismatch on ${key}`,
                ).to.equal(originalConnInfo[key as keyof IConnectionInfo]);
            }
        });

        test("createConnectionInfo preserves ActiveDirectoryDefault auth type", () => {
            const connDetails: ConnectionDetails = {
                options: {
                    server: "someServer",
                    authenticationType:
                        AuthenticationTypes[AuthenticationTypes.ActiveDirectoryDefault],
                },
            };

            const connInfo = ConnectionCredentials.createConnectionInfo(connDetails);
            expect(connInfo.authenticationType).to.equal(
                AuthenticationTypes[AuthenticationTypes.ActiveDirectoryDefault],
            );
        });

        test("createConnectionInfo preserves ActiveDirectoryServicePrincipal auth type", () => {
            const connDetails: ConnectionDetails = {
                options: {
                    server: "someServer",
                    authenticationType:
                        AuthenticationTypes[AuthenticationTypes.ActiveDirectoryServicePrincipal],
                },
            };

            const connInfo = ConnectionCredentials.createConnectionInfo(connDetails);
            expect(connInfo.authenticationType).to.equal(
                AuthenticationTypes[AuthenticationTypes.ActiveDirectoryServicePrincipal],
            );
        });
    });

    suite("isPasswordBasedCredential", () => {
        test("returns true for SqlLogin", () => {
            const creds = new ConnectionCredentials();
            creds.authenticationType = AuthenticationTypes[AuthenticationTypes.SqlLogin];
            expect(ConnectionCredentials.isPasswordBasedCredential(creds)).to.be.true;
        });

        test("returns true for ActiveDirectoryServicePrincipal", () => {
            const creds = new ConnectionCredentials();
            creds.authenticationType =
                AuthenticationTypes[AuthenticationTypes.ActiveDirectoryServicePrincipal];
            expect(ConnectionCredentials.isPasswordBasedCredential(creds)).to.be.true;
        });

        test("returns false for AzureMFA", () => {
            const creds = new ConnectionCredentials();
            creds.authenticationType = AuthenticationTypes[AuthenticationTypes.AzureMFA];
            expect(ConnectionCredentials.isPasswordBasedCredential(creds)).to.be.false;
        });

        test("returns false for Integrated", () => {
            const creds = new ConnectionCredentials();
            creds.authenticationType = AuthenticationTypes[AuthenticationTypes.Integrated];
            expect(ConnectionCredentials.isPasswordBasedCredential(creds)).to.be.false;
        });

        test("returns false for ActiveDirectoryDefault", () => {
            const creds = new ConnectionCredentials();
            creds.authenticationType =
                AuthenticationTypes[AuthenticationTypes.ActiveDirectoryDefault];
            expect(ConnectionCredentials.isPasswordBasedCredential(creds)).to.be.false;
        });
    });

    suite("getAuthenticationTypesChoice", () => {
        test("includes ActiveDirectoryServicePrincipal option", () => {
            const choices = ConnectionCredentials.getAuthenticationTypesChoice();
            const spChoice = choices.find(
                (c) =>
                    c.value ===
                    AuthenticationTypes[AuthenticationTypes.ActiveDirectoryServicePrincipal],
            );
            expect(spChoice, "Service Principal choice should be present").to.not.be.undefined;
        });
    });
});
