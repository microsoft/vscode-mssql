/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as ConnectionInfo from "../../src/models/connectionInfo";
import * as LocalizedConstants from "../../src/constants/locConstants";
import * as Constants from "../../src/constants/constants";
import { IConnectionInfo } from "vscode-mssql";
import { IConnectionProfile } from "../../src/models/interfaces";
import * as sinon from "sinon";

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
    // Setup common test variables
    const mockServer = "test-server";
    const mockDatabase = "test-database";
    const mockUser = "test-user";

    let sandbox: sinon.SinonSandbox;
    let getUserNameStub: sinon.SinonStub;

    setup(() => {
        // Create a sandbox for isolated sinon mocks
        sandbox = sinon.createSandbox();

        // Stub the getUserNameOrDomainLogin function
        getUserNameStub = sandbox.stub(ConnectionInfo, "getUserNameOrDomainLogin");

        // Set default constants values
        sandbox.stub(LocalizedConstants, "defaultDatabaseLabel").value("default-db");
    });

    teardown(() => {
        // Restore all stubbed methods after each test
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
