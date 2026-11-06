/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { beforeEach, suite, test } = require("node:test");

const events = [];
const reporterModulePath = require.resolve("@vscode/extension-telemetry");
const originalReporterModule = require.cache[reporterModulePath];
require.cache[reporterModulePath] = {
    exports: {
        TelemetryReporter: class {
            sendTelemetryEvent(name, properties, measurements) {
                events.push({ name, properties, measurements });
            }
        },
    },
};
const telemetry = require("../dist/vscode/telemetry/telemetry.js");
if (originalReporterModule) {
    require.cache[reporterModulePath] = originalReporterModule;
} else {
    delete require.cache[reporterModulePath];
}

const connectionInfo = { authenticationType: "SqlLogin", providerName: "MSSQL" };
const serverInfo = {
    isCloud: true,
    engineEditionId: 5,
    serverEdition: "SQL Azure",
    databaseServiceTier: "General Purpose",
    databaseServiceObjective: "GP_S_Gen5_2",
    serverTypes: ["Azure", "SQL"],
};

suite("connection-aware telemetry", () => {
    beforeEach(() => {
        events.length = 0;
    });

    test("serializes only allowlisted connection and server metadata", () => {
        telemetry.sendActionEvent("QueryEditor", "Execute", {
            connectionInfo: { ...connectionInfo, server: "private-host", password: "secret" },
            serverInfo: { ...serverInfo, machineName: "private-machine" },
        });

        assert.deepEqual(events[0].properties, {
            view: "QueryEditor",
            action: "Execute",
            target: "",
            source: "",
            authenticationType: "SqlLogin",
            providerName: "MSSQL",
            connectionType: "Azure",
            serverVersion: "",
            serverEdition: "SQL Azure",
            serverEngineEdition: "5",
            databaseServiceTier: "General Purpose",
            databaseServiceObjective: "GP_S_Gen5_2",
            serverTypes: "Azure,SQL",
        });
    });

    test("includes engine and tier metadata on errors", () => {
        telemetry.sendErrorEvent("QueryEditor", "Execute", {
            connectionInfo,
            serverInfo,
        });

        assert.equal(events[0].name, "error");
        assert.equal(events[0].properties.serverEngineEdition, "5");
        assert.equal(events[0].properties.databaseServiceTier, "General Purpose");
        assert.equal(events[0].properties.authenticationType, "SqlLogin");
    });

    for (const [engineEditionId, serverTypes] of [
        [2, ["Other"]],
        [4, ["Local", "SQL"]],
        [8, ["Azure", "SQL"]],
        [12, ["Fabric", "SQL"]],
    ]) {
        test(`preserves engine edition ${engineEditionId} independently of endpoint tags`, () => {
            telemetry.sendActionEvent("QueryEditor", "Execute", {
                serverInfo: { engineEditionId, serverTypes },
            });

            assert.equal(events[0].properties.serverEngineEdition, String(engineEditionId));
            assert.equal(events[0].properties.serverTypes, serverTypes.join(","));
        });
    }

    test("supports older services and null database properties", () => {
        telemetry.sendActionEvent("QueryEditor", "Execute", {
            serverInfo: {
                engineEditionId: 2,
                databaseServiceTier: null,
                databaseServiceObjective: null,
            },
        });

        assert.equal(events[0].properties.databaseServiceTier, "");
        assert.equal(events[0].properties.databaseServiceObjective, "");
        assert.equal(events[0].properties.serverTypes, "");
    });

    test("inherits activity context for updates and successful completion", () => {
        const activity = telemetry.startActivity("QueryEditor", "Execute", {
            connectionInfo,
            serverInfo,
        });
        activity.update();
        activity.end("Succeeded");

        assert.equal(events.length, 3);
        for (const event of events) {
            assert.equal(event.properties.databaseServiceObjective, "GP_S_Gen5_2");
            assert.equal(event.properties.serverTypes, "Azure,SQL");
            assert.equal(event.properties.authenticationType, "SqlLogin");
        }
    });

    test("inherits activity context for failed completion", () => {
        const activity = telemetry.startActivity("QueryEditor", "Execute", {
            connectionInfo,
            serverInfo,
        });
        activity.endFailed(new Error("failure"));

        const failure = events.find((event) => event.properties.activityStatus === "Failed");
        assert.equal(failure.properties.databaseServiceTier, "General Purpose");
        assert.equal(failure.properties.authenticationType, "SqlLogin");
    });

    test("retains context learned during an activity", () => {
        const activity = telemetry.startActivity("Connection", "Connect", { connectionInfo });
        activity.update({ serverInfo });
        activity.end("Succeeded");

        const completed = events.find((event) => event.properties.activityStatus === "Succeeded");
        assert.equal(completed.properties.serverTypes, "Azure,SQL");
        assert.equal(completed.properties.authenticationType, "SqlLogin");
    });

    test("allows completion to override initial context", () => {
        const activity = telemetry.startActivity("QueryEditor", "Execute", {
            connectionInfo,
            serverInfo,
        });
        activity.end("Succeeded", {
            serverInfo: { engineEditionId: 12, serverTypes: ["Fabric", "SQL"] },
        });

        const completed = events.find((event) => event.properties.activityStatus === "Succeeded");
        assert.equal(completed.properties.serverEngineEdition, "12");
        assert.equal(completed.properties.serverTypes, "Fabric,SQL");
        assert.equal(completed.properties.authenticationType, "SqlLogin");
    });
});
