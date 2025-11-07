/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as Utils from "../../src/models/utils";
import * as Constants from "../../src/constants/constants";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { IConnectionProfile } from "../../src/models/interfaces";
import * as utilUtils from "../../src/utils/utils";

suite("Utility Tests - parseTimeString", () => {
    test("should return false if nothing passed", () => {
        expect(Utils.parseTimeString(undefined)).to.equal(false);
        expect(Utils.parseTimeString("")).to.equal(false);
    });

    test("should return false if input does not have only 1 period", () => {
        expect(Utils.parseTimeString("32:13:23.12.1")).to.equal(false);
    });

    test("should return false if input does not have 2 :", () => {
        expect(Utils.parseTimeString("32.32")).to.equal(false);
        expect(Utils.parseTimeString("32:32:32:32.133")).to.equal(false);
    });

    test("returns the correct value", () => {
        expect(Utils.parseTimeString("2:13:30.0")).to.equal(8010000);
        expect(Utils.parseTimeString("0:0:0.220")).to.equal(220);
        expect(Utils.parseTimeString("0:0:0.0")).to.equal(0);
        // Allow time without milliseconds
        expect(Utils.parseTimeString("2:13:30")).to.equal(8010000);
    });
});

suite("Utility Tests - parseNumAsTimeString", () => {
    test("returns the correct value", () => {
        expect(Utils.parseNumAsTimeString(8010000)).to.equal("02:13:30");
        expect(Utils.parseNumAsTimeString(220)).to.equal("00:00:00.220");
        expect(Utils.parseNumAsTimeString(0)).to.equal("00:00:00");
        expect(Utils.parseNumAsTimeString(5002)).to.equal("00:00:05.002");
    });
});

suite("Utility Tests - isSameConnection", () => {
    let server = "my-server";
    let database = "my-db";
    let authType = Constants.sqlAuthentication;
    let user = "my-user";
    let connection1 = Object.assign(new ConnectionCredentials(), {
        server: server,
        database: database,
        authenticationType: authType,
        user: user,
    });
    let connection2 = Object.assign(new ConnectionCredentials(), {
        server: server,
        database: database,
        authenticationType: authType,
        user: user,
    });
    let connectionString =
        "Server=my-server;Database=my-db;Authentication=Sql Password;User ID=my-user";
    let connection3 = Object.assign(new ConnectionCredentials(), {
        connectionString: connectionString,
    });
    let connection4 = Object.assign(new ConnectionCredentials(), {
        connectionString: connectionString,
    });

    test("should return true for matching non-connectionstring connections", () => {
        expect(Utils.isSameConnectionInfo(connection1, connection2)).to.equal(true);
    });

    test("should return false for non-matching non-connectionstring connections", () => {
        connection2.server = "some-other-server";
        expect(Utils.isSameConnectionInfo(connection1, connection2)).to.equal(false);
    });

    test("should return true for matching connectionstring connections", () => {
        expect(Utils.isSameConnectionInfo(connection3, connection4)).to.equal(true);
    });

    test("should return false for non-matching connectionstring connections", () => {
        connection4.connectionString = "Server=some-other-server";
        expect(Utils.isSameConnectionInfo(connection3, connection4)).to.equal(false);
    });

    test("should return false for connectionstring and non-connectionstring connections", () => {
        expect(Utils.isSameConnectionInfo(connection1, connection3)).to.equal(false);
    });
});

suite("Utility tests - getSignInQuickPickItems", () => {
    let quickPickItems = Utils.getSignInQuickPickItems();

    test("first quick pick item should be Azure Sign In", () => {
        let signInItem = quickPickItems[0];
        expect(signInItem.label).to.not.equal(undefined);
        expect(signInItem.description).to.not.equal(undefined);
        expect(signInItem.command).to.equal(Constants.cmdAzureSignIn);
    });

    test("second quick pick item should be Azure Sign In With Device Code", () => {
        let signInWithDeviceCodeItem = quickPickItems[1];
        expect(signInWithDeviceCodeItem.label).to.not.equal(undefined);
        expect(signInWithDeviceCodeItem.description).to.not.equal(undefined);
        expect(signInWithDeviceCodeItem.command).to.equal(Constants.cmdAzureSignInWithDeviceCode);
    });

    test("third quick pick item should be Azure Sign In to Azure Cloud", () => {
        let signInToAzureCloudItem = quickPickItems[2];
        expect(signInToAzureCloudItem.label).to.not.equal(undefined);
        expect(signInToAzureCloudItem.description).to.not.equal(undefined);
        expect(signInToAzureCloudItem.command).to.equal(Constants.cmdAzureSignInToCloud);
    });
});

// @cssuh 10/22 - commented this test because it was throwing some random undefined errors
suite.skip("Utility tests - Timer Class", () => {
    let timer = new Utils.Timer();

    test("timer should start when initiated", (done) => {
        let p = new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                let duration = timer.getDuration();
                expect(duration).to.be.above(0);
                resolve();
            }, 100);
        });
        void p.then(() => done());
    });

    test("timer should end when ended", (done) => {
        let duration = timer.getDuration();
        timer.end();
        let p = new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                let newDuration = timer.getDuration();
                expect(duration).to.not.equal(newDuration);
                resolve();
            }, 100);
        });
        void p.then(() => done());
    });
});

suite("Utility tests - parseEnum", () => {
    test("should return the correct enum value for string enums", () => {
        enum TestStringEnum {
            Value1 = "ValueOne",
            Value2 = "ValueTwo",
            Value3 = "ValueThree",
        }

        const testCases = [
            { input: "ValueOne", expected: TestStringEnum.Value1 },
            { input: "ValueTwo", expected: TestStringEnum.Value2 },
            { input: "ValueThree", expected: TestStringEnum.Value3 },
            { input: "Value1", expected: TestStringEnum.Value1 },
            { input: "Value2", expected: TestStringEnum.Value2 },
            { input: "Value3", expected: TestStringEnum.Value3 },
            { input: "somethingElse", expected: undefined },
            { input: undefined, expected: undefined },
        ];

        for (const { input, expected } of testCases) {
            const result = utilUtils.parseEnum(TestStringEnum, input);
            expect(result, `'${input}' should return ${expected}, but was ${result}`).to.equal(
                expected,
            );
        }
    });
});

type Sample = {
    token?: string;
    expiresOn?: number;
    notes?: string | null;
};

suite("removeUndefinedProperties", () => {
    test("removes only undefined properties", () => {
        /* eslint-disable no-restricted-syntax */
        const input: Sample = {
            token: "abc",
            expiresOn: undefined,
            notes: null,
        };

        const result = utilUtils.removeUndefinedProperties(input);

        expect(
            result,
            "removeUndefinedValues should remove undefined properties, but leave null",
        ).to.deep.equal({
            token: "abc",
            notes: null,
        });
        /* eslint-enable no-restricted-syntax */
    });

    test("returns empty object when source is undefined", () => {
        const result = utilUtils.removeUndefinedProperties<Sample>(undefined);

        expect(result).to.deep.equal({});
    });
});

suite("ConnectionMatcher", () => {
    test("Should match connections correctly", () => {
        const testCases: {
            conn1: IConnectionProfile;
            conn2: IConnectionProfile;
            expected: Utils.MatchScore;
        }[] = [
            // Test ID match (highest priority)
            {
                conn1: sqlAuthConnWithId,
                conn2: sqlAuthConnWithId,
                expected: Utils.MatchScore.Id,
            },
            // Test different IDs
            {
                conn1: sqlAuthConn,
                conn2: {
                    ...sqlAuthConn,
                    id: "77777777-7777-7777-7777-777777777777",
                } as IConnectionProfile,
                expected: Utils.MatchScore.AllAvailableProps, // Falls back to property matching
            },
            // Test connection string exact match
            {
                conn1: connStringConn,
                conn2: connStringConn,
                expected: Utils.MatchScore.AllAvailableProps,
            },
            // Test connection string mismatch
            {
                conn1: connStringConn,
                conn2: {
                    connectionString: connStringConn.connectionString + "Connection Timeout=77",
                } as IConnectionProfile,
                expected: Utils.MatchScore.NotMatch,
            },
            // Test connection string vs regular properties
            {
                conn1: sqlAuthConn,
                conn2: connStringConn,
                expected: Utils.MatchScore.NotMatch,
            },
            // Test server only match
            {
                conn1: sqlAuthConn,
                conn2: {
                    ...sqlAuthConn,
                    database: "otherDatabase",
                },
                expected: Utils.MatchScore.Server,
            },
            // Test server normalization (. -> localhost)
            {
                conn1: {
                    ...sqlAuthConn,
                    server: "localhost",
                },
                conn2: {
                    ...sqlAuthConn,
                    server: ".",
                },
                expected: Utils.MatchScore.AllAvailableProps,
            },
            // Test server and database match, but not auth
            {
                conn1: sqlAuthConn,
                conn2: {
                    ...sqlAuthConn,
                    authenticationType: Constants.azureMfa,
                },
                expected: Utils.MatchScore.ServerAndDatabase,
            },
            // Test server, database, and auth match
            {
                conn1: sqlAuthConn,
                conn2: {
                    ...sqlAuthConn,
                    commandTimeout: 77,
                },
                expected: Utils.MatchScore.ServerDatabaseAndAuth,
            },
            // Test all available properties match
            {
                conn1: {
                    ...sqlAuthConn,
                    commandTimeout: 77,
                },
                conn2: {
                    ...sqlAuthConn,
                    commandTimeout: 77,
                },
                expected: Utils.MatchScore.AllAvailableProps,
            },
            // Test Azure MFA with matching account IDs
            {
                conn1: azureAuthConn,
                conn2: { ...azureAuthConn, commandTimeout: 77 },
                expected: Utils.MatchScore.ServerDatabaseAndAuth,
            },
            // Test Azure MFA with different account IDs
            {
                conn1: azureAuthConn,
                conn2: {
                    ...azureAuthConn,
                    accountId: "222222.33333",
                },
                expected: Utils.MatchScore.ServerAndDatabase,
            },
            // Test integrated auth match
            {
                conn1: {
                    server: "myServer",
                    database: "myDB",
                    authenticationType: Constants.integratedauth,
                } as IConnectionProfile,
                conn2: {
                    server: "myServer",
                    database: "myDB",
                    authenticationType: Constants.integratedauth,
                } as IConnectionProfile,
                expected: Utils.MatchScore.AllAvailableProps,
            },
            // Test no match - different servers
            {
                conn1: sqlAuthConn,
                conn2: { ...sqlAuthConn, server: "otherServer" },
                expected: Utils.MatchScore.NotMatch,
            },
            // Test different authentication types
            {
                conn1: sqlAuthConn,
                conn2: {
                    ...azureAuthConn,
                    authenticationType: Constants.integratedauth,
                } as IConnectionProfile,
                expected: Utils.MatchScore.ServerAndDatabase,
            },
            // Test SQL auth with different users
            {
                conn1: sqlAuthConn,
                conn2: {
                    ...sqlAuthConn,
                    user: "otherUser",
                },
                expected: Utils.MatchScore.ServerAndDatabase,
            },
        ];

        for (const testCase of testCases) {
            let result = Utils.ConnectionMatcher.isMatchingConnection(
                testCase.conn1,
                testCase.conn2,
            );
            expect(
                result,
                `Expected ${JSON.stringify(testCase.conn1)} and ${JSON.stringify(testCase.conn2)} match score to be ${testCase.expected}`,
            ).to.equal(testCase.expected);
        }
    });
});

export const sqlAuthConn = {
    server: "server1",
    database: "db1",
    authenticationType: Constants.sqlAuthentication,
    user: "user1",
} as IConnectionProfile;

export const sqlAuthConnWithId = {
    id: "55555555-5555-5555-5555-555555555555",
    server: "server1",
    database: "db1",
    authenticationType: Constants.sqlAuthentication,
    user: "user1",
} as IConnectionProfile;

export const azureAuthConn = {
    server: "server1",
    database: "db1",
    authenticationType: Constants.azureMfa,
    accountId: "00000.11111",
} as IConnectionProfile;

export const connStringConn = {
    connectionString: "Server=myServer;Database=myDB;Integrated Security=true;",
} as IConnectionProfile;
