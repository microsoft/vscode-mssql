/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { IConnectionInfo } from "vscode-mssql";
import * as ConnectionInfo from "../../src/models/connectionInfo";
import * as LocalizedConstants from "../../src/constants/locConstants";
import * as Constants from "../../src/constants/constants";
import { EncryptOptions, IConnectionProfile } from "../../src/models/interfaces";

suite("getConnectionDisplayName", () => {
    test("Should include server, database, and user for SQL Authentication", () => {
        const connection: IConnectionInfo = {
            server: "testServer",
            database: "testDatabase",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
        } as IConnectionInfo;

        const result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal("testServer, testDatabase (testUser)");
    });

    test("Should include default database tag when database is empty", () => {
        const connection: IConnectionInfo = {
            server: "testServer",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
        } as IConnectionInfo;

        let result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal(
            `testServer, ${LocalizedConstants.defaultDatabaseLabel} (testUser)`,
        );

        connection.database = "";
        result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal(
            `testServer, ${LocalizedConstants.defaultDatabaseLabel} (testUser)`,
        );
    });

    test("Should include default database tag when default database is true", () => {
        const connection: IConnectionInfo = {
            server: "testServer",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
            defaultDatabase: true,
        } as IConnectionInfo;

        let result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal(
            `testServer, ${LocalizedConstants.defaultDatabaseLabel} (testUser)`,
        );

        connection.database = "";
        result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal(
            `testServer, ${LocalizedConstants.defaultDatabaseLabel} (testUser)`,
        );
    });

    test("Should include email for Azure MFA Authentication", () => {
        const connection: IConnectionInfo = {
            server: "testServer",
            database: "testDatabase",
            authenticationType: Constants.azureMfa,
            email: "testEmail@example.com",
        } as IConnectionInfo;

        const result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal("testServer, testDatabase (testEmail@example.com)");
    });

    test("Should include authentication type for other authentication types", () => {
        const connection: IConnectionInfo = {
            server: "testServer",
            database: "testDatabase",
            authenticationType: "OtherAuthType",
        } as IConnectionInfo;

        const result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal("testServer, testDatabase (OtherAuthType)");
    });

    test("Should be profile name if provided", () => {
        const connection: IConnectionProfile = {
            server: "testServer",
            database: "testDatabase",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
            profileName: "Test Profile Name",
        } as IConnectionProfile;

        const result = ConnectionInfo.getConnectionDisplayName(connection);
        expect(result).to.equal("Test Profile Name");
    });
});

suite("getConnectionDisplayString", () => {
    const mockServer = "test-server";
    const mockDatabase = "test-database";
    const mockUser = "test-user";

    let sandbox: sinon.SinonSandbox;
    let getUserNameStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        getUserNameStub = sandbox.stub(ConnectionInfo, "getUserNameOrDomainLogin");
        sandbox.stub(LocalizedConstants, "defaultDatabaseLabel").value("default-db");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("returns formatted string with server, database and user", () => {
        // Arrange
        const creds: IConnectionInfo = {
            server: mockServer,
            database: mockDatabase,
            user: mockUser,
        } as IConnectionInfo;
        getUserNameStub.returns(mockUser);

        // Act
        const result = ConnectionInfo.getConnectionDisplayString(creds);

        // Assert
        expect(result).to.equal(`${mockServer} : $(database) ${mockDatabase} : ${mockUser}`);
    });

    test("returns formatted string with server and database when user is not present", () => {
        // Arrange
        const creds: IConnectionInfo = {
            server: mockServer,
            database: mockDatabase,
        } as IConnectionInfo;
        getUserNameStub.returns("");

        // Act
        const result = ConnectionInfo.getConnectionDisplayString(creds);

        // Assert
        expect(result).to.equal(`${mockServer} : $(database) ${mockDatabase}`);
    });

    test("uses default database label when database is not provided", () => {
        // Arrange
        const creds: IConnectionInfo = {
            server: mockServer,
            user: mockUser,
        } as IConnectionInfo;
        getUserNameStub.returns(mockUser);

        // Act
        const result = ConnectionInfo.getConnectionDisplayString(creds);

        // Assert
        expect(result).to.equal(`${mockServer} : $(database) default-db : ${mockUser}`);
    });

    test("trims result when trim is true and result is longer than max length", () => {
        // Arrange
        const longServer = "very-long-server-name-that-exceeds-the-maximum-length";
        const creds: IConnectionInfo = {
            server: longServer,
            database: mockDatabase,
        } as IConnectionInfo;
        getUserNameStub.returns(mockUser);

        // Act
        const result = ConnectionInfo.getConnectionDisplayString(creds, 30);

        // Assert
        const expectedText = `${longServer} : $(database) ${mockDatabase} : ${mockUser}`;
        const trimmedExpected = expectedText.slice(0, 30) + " \u2026";
        expect(result).to.equal(trimmedExpected);
    });
});

suite("fixupConnectionCredentials", () => {
    test("Basic fixups", () => {
        let connCreds: IConnectionInfo = {} as IConnectionInfo;
        ConnectionInfo.fixupConnectionCredentials(connCreds);

        expect(connCreds.server, "server should be given a value").to.equal("");
        expect(connCreds.database, "database should be given a value").to.equal("");
        expect(connCreds.user, "user should be given a value").to.equal("");
        expect(connCreds.password, "password should be given a value").to.equal("");
        expect(
            connCreds.connectTimeout,
            "connectTimeout should be set to the default value",
        ).to.equal(Constants.defaultConnectionTimeout);
        expect(
            connCreds.commandTimeout,
            "commandTimeout should be set to the default value",
        ).to.equal(Constants.defaultCommandTimeout);
        expect(
            connCreds.applicationName,
            "applicationName should be set to the default value",
        ).to.equal(Constants.connectionApplicationName);
    });

    test("Encrypt option defaults", () => {
        let connCreds: IConnectionInfo = {} as IConnectionInfo;

        const testCases = [
            { input: true, expected: EncryptOptions.Mandatory },
            { input: false, expected: EncryptOptions.Optional },
            { input: "", expected: EncryptOptions.Mandatory },
            { input: undefined, expected: EncryptOptions.Mandatory },
            { input: EncryptOptions.Optional, expected: EncryptOptions.Optional },
            { input: EncryptOptions.Mandatory, expected: EncryptOptions.Mandatory },
            { input: EncryptOptions.Strict, expected: EncryptOptions.Strict },
        ];

        for (const { input, expected } of testCases) {
            connCreds.encrypt = input;
            ConnectionInfo.fixupConnectionCredentials(connCreds);

            expect(
                connCreds.encrypt,
                `${input} should ${input !== expected ? "be converted to" : "stay as"} ${expected}`,
            ).to.equal(expected);
        }
    });

    test("Azure SQL Database specific fixups", () => {
        let connCreds: IConnectionInfo = {
            server: "test.database.windows.net",
            encrypt: EncryptOptions.Optional,
            connectTimeout: 10,
        } as IConnectionInfo;

        connCreds = ConnectionInfo.fixupConnectionCredentials(connCreds);

        expect(connCreds.encrypt, "encrypt should be set to Mandatory for Azure SQL").to.equal(
            EncryptOptions.Mandatory,
        );
        expect(
            connCreds.connectTimeout,
            "connectTimeout should be set to minimum for Azure SQL",
        ).to.equal(Constants.azureSqlDbConnectionTimeout);

        connCreds.encrypt = EncryptOptions.Strict;
        connCreds = ConnectionInfo.fixupConnectionCredentials(connCreds);
        expect(connCreds.encrypt, "encrypt should remain Strict for Azure SQL").to.equal(
            EncryptOptions.Strict,
        );
    });
});
