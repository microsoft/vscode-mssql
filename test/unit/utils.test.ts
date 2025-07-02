/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, assert } from "chai";
import * as Utils from "../../src/extension/models/utils";
import * as Constants from "../../src/extension/constants/constants";
import { ConnectionCredentials } from "../../src/extension/models/connectionCredentials";

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
        assert.notEqual(signInItem.label, undefined);
        assert.notEqual(signInItem.description, undefined);
        assert.equal(signInItem.command, Constants.cmdAzureSignIn);
    });

    test("second quick pick item should be Azure Sign In With Device Code", () => {
        let signInWithDeviceCodeItem = quickPickItems[1];
        assert.notEqual(signInWithDeviceCodeItem.label, undefined);
        assert.notEqual(signInWithDeviceCodeItem.description, undefined);
        assert.equal(signInWithDeviceCodeItem.command, Constants.cmdAzureSignInWithDeviceCode);
    });

    test("third quick pick item should be Azure Sign In to Azure Cloud", () => {
        let signInToAzureCloudItem = quickPickItems[2];
        assert.notEqual(signInToAzureCloudItem.label, undefined);
        assert.notEqual(signInToAzureCloudItem.description, undefined);
        assert.equal(signInToAzureCloudItem.command, Constants.cmdAzureSignInToCloud);
    });
});

// @cssuh 10/22 - commented this test because it was throwing some random undefined errors
suite.skip("Utility tests - Timer Class", () => {
    let timer = new Utils.Timer();

    test("timer should start when initiated", (done) => {
        let p = new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                let duration = timer.getDuration();
                assert.isAbove(duration, 0);
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
                assert.notEqual(duration, newDuration);
                resolve();
            }, 100);
        });
        void p.then(() => done());
    });
});
