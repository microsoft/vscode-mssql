/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { getConnectionDisplayName } from "../../src/models/connectionInfo";
import * as LocalizedConstants from "../../src/constants/locConstants";
import * as Constants from "../../src/constants/constants";
import { IConnectionInfo } from "vscode-mssql";
import { IConnectionProfile } from "../../src/models/interfaces";

suite("connectionInfo", () => {
    suite("getConnectionDisplayName", () => {
        test("Should include server, database, and user for SQL Authentication", () => {
            const connection: IConnectionInfo = {
                server: "testServer",
                database: "testDatabase",
                authenticationType: Constants.sqlAuthentication,
                user: "testUser",
            } as IConnectionInfo;

            const result = getConnectionDisplayName(connection);
            expect(result).to.equal("testServer, testDatabase (testUser)");
        });

        test("Should include default database tag when database is empty", () => {
            const connection: IConnectionInfo = {
                server: "testServer",
                authenticationType: Constants.sqlAuthentication,
                user: "testUser",
            } as IConnectionInfo;

            let result = getConnectionDisplayName(connection);
            expect(result).to.equal(
                `testServer, ${LocalizedConstants.defaultDatabaseLabel} (testUser)`,
            );

            connection.database = "";
            result = getConnectionDisplayName(connection);
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

            const result = getConnectionDisplayName(connection);
            expect(result).to.equal("testServer, testDatabase (testEmail@example.com)");
        });

        test("Should include authentication type for other authentication types", () => {
            const connection: IConnectionInfo = {
                server: "testServer",
                database: "testDatabase",
                authenticationType: "OtherAuthType",
            } as IConnectionInfo;

            const result = getConnectionDisplayName(connection);
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

            const result = getConnectionDisplayName(connection);
            expect(result).to.equal("Test Profile Name");
        });
    });
});
