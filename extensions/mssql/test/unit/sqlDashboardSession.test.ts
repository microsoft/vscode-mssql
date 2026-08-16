/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { DashboardProvider } from "../../src/dashboard/dashboardProvider";
import { MockDashboardProvider } from "../../src/dashboard/mockDashboardProvider";
import { SqlDashboardSession } from "../../src/dashboard/dashboardSession";
import { SqlDashboard } from "../../src/sharedInterfaces/sqlDashboard";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => (resolve = accept));
    return { promise, resolve };
}

suite("SQL Dashboard session", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("coalesces duplicate route loads", async () => {
        const provider = new MockDashboardProvider();
        const load = sandbox.spy(provider, "load");
        const session = new SqlDashboardSession(provider, { kind: "serverOverview" });

        const first = session.navigate({ kind: "serverOverview" });
        const second = session.navigate({ kind: "serverOverview" });
        await Promise.all([first, second]);

        expect(load).to.have.been.calledOnce;
        expect(session.state().status).to.equal("ready");
        session.dispose();
    });

    test("coalesces concurrent refresh requests for the active route", async () => {
        const provider = new MockDashboardProvider();
        const load = sandbox.spy(provider, "load");
        const session = new SqlDashboardSession(provider, { kind: "serverOverview" });
        await session.navigate({ kind: "serverOverview" });
        load.resetHistory();

        await Promise.all([session.refresh(), session.refresh(), session.refresh()]);

        expect(load).to.have.been.calledOnce;
        session.dispose();
    });

    test("cancels an obsolete route and never publishes its late result", async () => {
        const server = deferred<SqlDashboard.Page>();
        const database = deferred<SqlDashboard.Page>();
        const canonical = new MockDashboardProvider();
        const provider: DashboardProvider = {
            mode: "mock",
            scenario: "canonical",
            connection: canonical.connection,
            load: (route) => (route.kind === "serverOverview" ? server.promise : database.promise),
            dispose: sandbox.stub(),
        };
        const session = new SqlDashboardSession(provider, { kind: "serverOverview" });
        const published: SqlDashboard.WebviewState[] = [];
        session.onDidChange((state) => published.push(state));

        const obsolete = session.navigate({ kind: "serverOverview" });
        const latest = session.navigate({
            kind: "databaseOverview",
            database: "WideWorldImporters",
        });
        database.resolve(
            await canonical.load(
                { kind: "databaseOverview", database: "WideWorldImporters" },
                new AbortController().signal,
            ),
        );
        await latest;
        server.resolve(
            await canonical.load({ kind: "serverOverview" }, new AbortController().signal),
        );
        await obsolete;

        expect(session.state().route.kind).to.equal("databaseOverview");
        expect(
            published.some(
                (state) => state.status === "ready" && state.route.kind === "serverOverview",
            ),
        ).to.equal(false);
        session.dispose();
    });

    test("publishes corrected canonical evidence and no historical delta on cumulative KPIs", async () => {
        const provider = new MockDashboardProvider();
        const session = new SqlDashboardSession(provider, { kind: "serverOverview" });
        await session.navigate({ kind: "serverOverview" });
        const state = session.state();
        expect(state.page?.kind).to.equal("serverOverview");
        if (state.page?.kind !== "serverOverview") {
            throw new Error("expected server overview page");
        }
        expect(state.page.server.platform).to.equal("Ubuntu 22.04");
        expect(state.page.kpis.find((kpi) => kpi.id === "cpu")?.value).to.equal("41.6%");
        for (const kpi of state.page.kpis) {
            if (kpi.delta !== undefined) {
                expect(kpi.seriesBasis).to.equal("historical");
            }
        }
        expect(JSON.stringify(state)).not.to.contain("SELECT ");
        session.dispose();
    });

    test("keeps the 5,000-query scenario bounded and reports total coverage honestly", async () => {
        const session = new SqlDashboardSession(new MockDashboardProvider("queryVolume5000"), {
            kind: "databasePerformance",
            database: "WideWorldImporters",
        });
        await session.navigate({
            kind: "databasePerformance",
            database: "WideWorldImporters",
        });
        const page = session.state().page;
        expect(page?.kind).to.equal("databasePerformance");
        if (page?.kind !== "databasePerformance") {
            throw new Error("expected database performance page");
        }
        expect(page.totalQueryCount).to.equal(5_000);
        expect(page.queries).to.have.length(100);
        expect(Buffer.byteLength(JSON.stringify(session.state()), "utf8")).to.be.lessThan(
            32 * 1024,
        );
        session.dispose();
    });

    test("models permission and Query Store gaps as unavailable instead of healthy empties", async () => {
        for (const scenario of ["lowPermission", "queryStoreOff"] as const) {
            const session = new SqlDashboardSession(new MockDashboardProvider(scenario), {
                kind: "databasePerformance",
                database: "WideWorldImporters",
            });
            await session.navigate({
                kind: "databasePerformance",
                database: "WideWorldImporters",
            });
            const page = session.state().page;
            expect(page?.kind).to.equal("unavailable");
            if (page?.kind === "unavailable") {
                expect(page.state.reason).to.equal(
                    scenario === "lowPermission" ? "permissionDenied" : "queryStoreDisabled",
                );
            }
            session.dispose();
        }
    });
});
