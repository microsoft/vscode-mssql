/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as databaseHubService from "../../../src/databaseHub/databaseHubService";
import {
    PerformanceDashboardSource,
    PerformanceDashboardTelemetry,
    codeList,
    pageViewOf,
    readOutcomeOf,
} from "../../../src/performance/performanceDashboardTelemetry";
import { TelemetryActions, TelemetryViews } from "../../../src/sharedInterfaces/telemetry";
import { stubTelemetry } from "../utils";

chai.use(sinonChai);

suite("PerformanceDashboardTelemetry", () => {
    let sandbox: sinon.SinonSandbox;
    let sendActionEvent: sinon.SinonStub;
    let connectionTelemetry: sinon.SinonStub;

    const serverInfo = {
        isCloud: false,
        serverVersion: "16.0.4135.4",
        serverEdition: "Enterprise Edition (64-bit)",
        engineEditionId: 3,
    };

    /** The events sent so far, once the connection properties resolved. */
    const sent = async () => {
        await connectionTelemetry.lastCall?.returnValue;
        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
        }
        return sendActionEvent.getCalls().map((call) => ({
            action: call.args[1] as string,
            options: call.args[2],
        }));
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        ({ sendActionEvent } = stubTelemetry(sandbox));
        connectionTelemetry = sandbox.stub().resolves({
            connectionInfo: { authenticationType: "SqlLogin" },
            serverInfo,
        });
        sandbox.stub(databaseHubService, "getDatabaseHubService").returns({
            connectionTelemetryForProfile: connectionTelemetry,
        } as unknown as databaseHubService.DatabaseHubService);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("pageViewOf", () => {
        test("describes the page, tab and options, without query IDs or times", () => {
            expect(pageViewOf("queries/913?tab=plans&range=7d&metric=cpu")).to.deep.equal({
                page: "query",
                tab: "plans",
                category: "",
                rank: "",
                metric: "cpu",
                view: "",
                compareView: "",
                compareMetric: "",
                timeRange: "7d",
                settings: "",
            });
            expect(pageViewOf("")).to.include({ page: "queries" });
            expect(pageViewOf("queries?category=reads&from=2026-10-01T00:00:00Z")).to.include({
                page: "queries",
                category: "reads",
                timeRange: "custom",
            });
        });

        test("replaces values that aren't short codes", () => {
            expect(pageViewOf("queries?category=DROP TABLE x").category).to.equal("other");
            expect(pageViewOf("elsewhere/1/2").page).to.equal("other");
        });
    });

    test("readOutcomeOf reports the status, the unavailable reason and the SQL error", () => {
        expect(readOutcomeOf({ status: "unavailable", reason: "connectionFailed" })).to.deep.equal({
            status: "unavailable",
            unavailableReason: "connectionFailed",
        });
        expect(
            readOutcomeOf({
                status: "permissionMissing",
                error: { message: "denied", errorNumber: 229 },
            }),
        ).to.deep.equal({ status: "permissionMissing", unavailableReason: "", errorNumber: "229" });
    });

    test("codeList sorts and removes duplicates", () => {
        expect(codeList(["planNotFound", "autoForcedPlan", "planNotFound"])).to.equal(
            "autoForcedPlan,planNotFound",
        );
        expect(codeList(undefined)).to.equal("");
    });

    test("every event carries the dashboard ID and the connection and server info", async () => {
        const telemetry = new PerformanceDashboardTelemetry("profile-1");
        telemetry.opened(PerformanceDashboardSource.ObjectExplorer, "queries?range=24h", false);

        const [open] = await sent();
        expect(connectionTelemetry).to.have.been.calledWith("profile-1");
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.PerformanceDashboard,
            TelemetryActions.Open,
        );
        expect(open.options).to.deep.include({
            connectionInfo: { authenticationType: "SqlLogin" },
            serverInfo,
        });
        expect(open.options.additionalProps).to.include({
            dashboardId: telemetry.dashboardId,
            source: "objectExplorer",
            reused: "false",
            page: "queries",
            timeRange: "24h",
        });
    });

    test("falls back to the platform of the dashboard's reads for the server info", async () => {
        connectionTelemetry.resolves({});
        const telemetry = new PerformanceDashboardTelemetry("profile-1");
        telemetry.setPlatform({ platform: "azureSqlDatabase", engineEdition: 5 });
        telemetry.action(TelemetryActions.OpenPlan);

        const [event] = await sent();
        expect(event.options.serverInfo).to.deep.equal({ engineEditionId: 5, isCloud: true });
        expect(event.options.additionalProps.platform).to.equal("azureSqlDatabase");
    });

    test("sends Navigate only when the view changes, and counts query pages", async () => {
        const telemetry = new PerformanceDashboardTelemetry("profile-1");
        telemetry.navigated("queries?category=cpu");
        telemetry.navigated("queries?category=cpu");
        telemetry.navigated("queries/913?tab=history");
        telemetry.navigated("queries/913?tab=plans");
        telemetry.navigated("queries/914?tab=plans");
        telemetry.closed();

        const events = await sent();
        expect(events.map((event) => event.action)).to.deep.equal([
            "Navigate",
            "Navigate",
            "Navigate",
            "Close",
        ]);
        expect(events[2].options.additionalProps).to.include({ page: "query", tab: "plans" });
        expect(events[3].options.additionalProps).to.include({ lastPage: "query" });
        expect(events[3].options.additionalMeasurements).to.include({
            pageViews: 3,
            queryPageViews: 1,
        });
    });

    test("sends Load once for each database, and ReadFailed for failed reads", async () => {
        const telemetry = new PerformanceDashboardTelemetry("profile-1");
        const overview = {
            status: "notConfigured" as const,
            queryStore: { actualState: "off" as const },
        };
        telemetry.read("performanceDashboard/getQueryStoreOverview", "Sales", overview);
        telemetry.read("performanceDashboard/getQueryStoreOverview", "Sales", overview);
        telemetry.read("performanceDashboard/getTopQueries", "Sales", { status: "ready" });

        const events = await sent();
        expect(events.map((event) => event.action)).to.deep.equal([
            "Load",
            "ReadFailed",
            "ReadFailed",
        ]);
        expect(events[0].options.additionalProps).to.include({
            status: "notConfigured",
            queryStoreState: "off",
            databaseKind: "named",
        });
        expect(events[1].options.additionalProps).to.include({
            request: "getQueryStoreOverview",
            status: "notConfigured",
        });
    });

    test("sends the Database Hub banner impression once", async () => {
        const telemetry = new PerformanceDashboardTelemetry("profile-1");
        telemetry.bannerShown();
        telemetry.bannerShown();

        expect((await sent()).map((event) => event.action)).to.deep.equal([
            "ShowDatabaseHubBanner",
        ]);
    });
});
