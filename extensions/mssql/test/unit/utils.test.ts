/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as Utils from "../../src/models/utils";
import * as Constants from "../../src/constants/constants";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { IConnectionProfile, IConnectionProfileWithSource } from "../../src/models/interfaces";
import * as utilUtils from "../../src/utils/utils";
import * as vscode from "vscode";

suite("Utility Tests - Timestamp handling", () => {
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

    suite("durationToDisplay", () => {
        test("human format with milliseconds", () => {
            // Defaults to "human" format with milliseconds always shown.
            expect(Utils.durationToDisplay(0)).to.equal("0s 0ms");
            expect(Utils.durationToDisplay(220)).to.equal("0s 220ms");
            expect(Utils.durationToDisplay(1000)).to.equal("1s 0ms");
            expect(Utils.durationToDisplay(59_000)).to.equal("59s 0ms");
            expect(Utils.durationToDisplay(60_000)).to.equal("1m 0s 0ms");
            expect(Utils.durationToDisplay(61_500)).to.equal("1m 1s 500ms");
            expect(Utils.durationToDisplay(3_599_999)).to.equal("59m 59s 999ms");
            expect(Utils.durationToDisplay(3_600_000)).to.equal("1h 0m 0s 0ms");
            expect(Utils.durationToDisplay(3_661_500)).to.equal("1h 1m 1s 500ms");
            expect(Utils.durationToDisplay(7_497_123)).to.equal("2h 4m 57s 123ms");
        });

        test("human format without milliseconds", () => {
            expect(Utils.durationToDisplay(0, { includeMilliseconds: false })).to.equal("0s");
            expect(Utils.durationToDisplay(61_500, { includeMilliseconds: false })).to.equal(
                "1m 1s",
            );
            expect(Utils.durationToDisplay(3_661_999, { includeMilliseconds: false })).to.equal(
                "1h 1m 1s",
            );
        });

        test("durationToDisplay - clock format with milliseconds", () => {
            expect(Utils.durationToDisplay(8_010_000, { format: "clock" })).to.equal(
                "02:13:30.000",
            );
            expect(Utils.durationToDisplay(220, { format: "clock" })).to.equal("00:00:00.220");
            expect(Utils.durationToDisplay(0, { format: "clock" })).to.equal("00:00:00.000");
            expect(Utils.durationToDisplay(5_002, { format: "clock" })).to.equal("00:00:05.002");
        });

        test("durationToDisplay - clock format without milliseconds", () => {
            expect(
                Utils.durationToDisplay(8_010_000, { format: "clock", includeMilliseconds: false }),
            ).to.equal("02:13:30");
            expect(
                Utils.durationToDisplay(0, { format: "clock", includeMilliseconds: false }),
            ).to.equal("00:00:00");
        });

        test("negative durations", () => {
            expect(
                Utils.durationToDisplay(-5_002, {
                    format: "clock",
                    includeSign: true,
                }),
            ).to.equal("-00:00:05.002");

            expect(
                Utils.durationToDisplay(-3_661_000, {
                    format: "human",
                    includeSign: true,
                }),
            ).to.equal("-1h 1m 1s 0ms");
        });
    });

    suite("epochToDisplay", () => {
        // Fixed instant the fake clock will report as "now" for every test in
        // this suite. Chosen to be in the user's local-timezone past so we can
        // assert against an exact, deterministic ISO string regardless of where
        // the test runs.
        const MOCK_NOW_EPOCH_MS = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z
        let sandbox: sinon.SinonSandbox;

        setup(() => {
            sandbox = sinon.createSandbox();
            sandbox.useFakeTimers(MOCK_NOW_EPOCH_MS);
        });

        teardown(() => {
            sandbox.restore();
        });

        /**
         * Builds the ISO string the helper should produce for `epochMs`. We
         * compute it from `Date` rather than hardcoding so the test stays valid
         * across timezones. The helper format is
         * `YYYY-MM-DDTHH:mm:ss[.fff][±HH:MM]`.
         */
        function expectedIso(
            epochMs: number,
            includeTimezone: boolean,
            includeMilliseconds: boolean,
        ): string {
            const date = new Date(epochMs);
            const pad = (n: number, width = 2) => String(n).padStart(width, "0");
            let iso =
                `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
                `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
            if (includeMilliseconds) {
                iso += `.${pad(date.getMilliseconds(), 3)}`;
            }
            if (includeTimezone) {
                const offsetTotal = -date.getTimezoneOffset();
                const sign = offsetTotal >= 0 ? "+" : "-";
                const absMinutes = Math.abs(offsetTotal);
                iso += `${sign}${pad(Math.floor(absMinutes / 60))}:${pad(absMinutes % 60)}`;
            }
            return iso;
        }

        test('returns "now" relative when input equals current time or is omitted', () => {
            let result = Utils.epochToDisplay(MOCK_NOW_EPOCH_MS);
            expect(result).to.deep.equal({
                epochMilliseconds: MOCK_NOW_EPOCH_MS,
                iso: expectedIso(MOCK_NOW_EPOCH_MS, false, true),
                relative: "now",
            });

            result = Utils.epochToDisplay();
            expect(result).to.deep.equal({
                epochMilliseconds: MOCK_NOW_EPOCH_MS,
                iso: expectedIso(MOCK_NOW_EPOCH_MS, false, true),
                relative: "now",
            });
        });

        test("renders future timestamps as 'in <duration>'", () => {
            // 4 minutes 57 seconds 250 ms in the future
            const future = MOCK_NOW_EPOCH_MS + (4 * 60 + 57) * 1000 + 250;
            const result = Utils.epochToDisplay(future);
            expect(result).to.deep.equal({
                epochMilliseconds: future,
                iso: expectedIso(future, false, true),
                relative: "in 4m 57s 250ms",
            });
        });

        test("renders past timestamps as '<duration> ago'", () => {
            // 3 hours 12 minutes 4 seconds ago (no ms component)
            const past = MOCK_NOW_EPOCH_MS - (3 * 3600 + 12 * 60 + 4) * 1000;
            const result = Utils.epochToDisplay(past);
            expect(result).to.deep.equal({
                epochMilliseconds: past,
                iso: expectedIso(past, false, true),
                relative: "3h 12m 4s 0ms ago",
            });
        });

        test("includes a timezone offset suffix in the ISO when includeTimezone is true", () => {
            const future = MOCK_NOW_EPOCH_MS + 30_000;
            const result = Utils.epochToDisplay(future, { includeTimezone: true });
            expect(result.iso).to.equal(expectedIso(future, true, true));
            // Offset must appear after the ms component, format /[+-]\d\d:\d\d$/
            expect(result.iso).to.match(/\.\d{3}[+-]\d{2}:\d{2}$/);
            expect(result.epochMilliseconds).to.equal(future);
            expect(result.relative).to.equal("in 30s 0ms");
        });

        test("omits the timezone offset from the ISO when includeTimezone is false (default)", () => {
            const result = Utils.epochToDisplay(MOCK_NOW_EPOCH_MS);
            // No trailing offset and no trailing "Z" should appear when omitted.
            expect(result.iso).to.not.match(/[+-]\d{2}:\d{2}$/);
            expect(result.iso).to.not.match(/Z$/);
        });

        test("omits milliseconds from both ISO and relative when includeMilliseconds is false", () => {
            // 4 minutes 57 seconds + 250 ms — the ms portion should be dropped from both pieces.
            const future = MOCK_NOW_EPOCH_MS + (4 * 60 + 57) * 1000 + 250;
            const result = Utils.epochToDisplay(future, { includeMilliseconds: false });
            expect(result.iso).to.equal(expectedIso(future, false, false));
            expect(result.iso).to.not.match(/\.\d{3}/);
            expect(result.relative).to.equal("in 4m 57s");
        });
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
        let p = new Promise<void>((resolve, _reject) => {
            setTimeout(() => {
                let duration = timer.getDuration();
                expect(duration).to.be.greaterThan(0);
                resolve();
            }, 100);
        });
        void p.then(() => done());
    });

    test("timer should end when ended", (done) => {
        let duration = timer.getDuration();
        timer.end();
        let p = new Promise<void>((resolve, _reject) => {
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

suite("Utility tests - getUriKey", () => {
    test("encodes literal percent characters in file paths", () => {
        const uri = vscode.Uri.file("/tmp/path%20to%20workspace/test.sql");
        const key = utilUtils.getUriKey(uri);

        // A literal '%' in the original path should be encoded as '%25', turning '%20' into '%2520'.
        expect(key).to.contain("%2520");
    });

    test("normalizes encoded forward slashes and preserves encoded backslashes in filenames", () => {
        const uri = vscode.Uri.parse("file:///tmp/report%2Fname%5Cwith%5Cseparators.sql");
        const key = utilUtils.getUriKey(uri);

        // '%2F' is normalized to '/', so the filename segment is split by a forward slash.
        expect(key).to.contain("/report/name");
        // Encoded backslashes remain percent-encoded in the URI string key.
        expect(key.toLowerCase()).to.contain("%5c");
    });

    test("encodes multiple consecutive percent characters", () => {
        const uri = vscode.Uri.file("/tmp/multi%%%percent.sql");
        const key = utilUtils.getUriKey(uri);

        // Each consecutive '%' should be encoded independently.
        expect(key).to.contain("%25%25%25");
    });

    test("supports uri schemes other than file", () => {
        const uri = vscode.Uri.parse("untitled:query%20buffer.sql");
        const key = utilUtils.getUriKey(uri);

        // getUriKey should return the URI's canonical string representation for non-file schemes too.
        expect(key).to.equal(uri.toString());
        // Scheme prefix should be preserved to avoid collisions across URI types.
        expect(key).to.match(/^untitled:/);
    });

    test("handles empty and nullish uri values", () => {
        const emptyPathUri = vscode.Uri.from({ scheme: "file", path: "" });

        // Empty but valid URIs should still round-trip via toString().
        expect(utilUtils.getUriKey(emptyPathUri)).to.equal(emptyPathUri.toString());
        // Nullish inputs should not throw and should return undefined.
        expect(utilUtils.getUriKey(undefined as unknown as vscode.Uri)).to.equal(undefined);
        expect(utilUtils.getUriKey(null as unknown as vscode.Uri)).to.equal(undefined);
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

    test("findMatchingProfile", async () => {
        const connections = [
            sqlAuthConn as IConnectionProfileWithSource,
            azureAuthConn as IConnectionProfileWithSource,
            connStringConn as IConnectionProfileWithSource,
        ];

        let match = Utils.ConnectionMatcher.findMatchingProfile(azureAuthConn, connections);
        expect(match).to.deep.equal({
            profile: azureAuthConn,
            score: Utils.MatchScore.AllAvailableProps,
        });

        match = Utils.ConnectionMatcher.findMatchingProfile(
            {
                server: "noMatch",
            } as IConnectionProfile,
            connections,
        );
        expect(match).to.deep.equal({
            profile: undefined,
            score: Utils.MatchScore.NotMatch,
        });
    });
});

suite("decodeQueryResultLinkFragment", () => {
    test("falls back to raw fragment on decode error", () => {
        // Basic case
        let original = '{"test":"testValue"}';
        let encoded = encodeURIComponent(original);
        let result = utilUtils.decodeQueryResultLinkFragment(encoded);
        expect(result).to.equal(original);

        // Special characters that are valid in URI components and therefore need encoding/decoding
        original = '{"test":"=:&"}';
        encoded = encodeURIComponent(original);
        result = utilUtils.decodeQueryResultLinkFragment(encoded);
        expect(result).to.equal(original);

        // % character causes decodeURIComponent to throw; fallback should return raw fragment
        original = '{"test":"%"}';
        encoded = encodeURIComponent(original);
        result = utilUtils.decodeQueryResultLinkFragment(encoded);
        expect(result).to.equal(original);
    });
});

suite("Utility Tests - bracketEscapeSqlIdentifier", () => {
    test("wraps identifier in brackets by default", () => {
        expect(Utils.bracketEscapeSqlIdentifier("mytable")).to.equal("[mytable]");
    });

    test("escapes closing brackets within the identifier", () => {
        expect(Utils.bracketEscapeSqlIdentifier("my]table")).to.equal("[my]]table]");
    });

    test("escapes multiple closing brackets within the identifier", () => {
        expect(Utils.bracketEscapeSqlIdentifier("my]weird]name")).to.equal("[my]]weird]]name]");
    });

    test("does not wrap in brackets when includeSurroundingBrackets is false", () => {
        expect(Utils.bracketEscapeSqlIdentifier("mytable", false)).to.equal("mytable");
    });

    test("escapes closing brackets but does not wrap when includeSurroundingBrackets is false", () => {
        expect(Utils.bracketEscapeSqlIdentifier("my]table", false)).to.equal("my]]table");
    });

    test("handles empty string", () => {
        expect(Utils.bracketEscapeSqlIdentifier("")).to.equal("[]");
        expect(Utils.bracketEscapeSqlIdentifier("", false)).to.equal("");
    });

    test("does not escape opening brackets", () => {
        expect(Utils.bracketEscapeSqlIdentifier("my[table")).to.equal("[my[table]");
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
