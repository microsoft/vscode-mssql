/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import {
    PerformanceDashboardTarget,
    PerformanceDashboardWebviewController,
} from "../../../src/performance/performanceDashboardWebviewController";
import { PerformanceDashboards } from "../../../src/performance/performanceDashboards";
import { PerformanceService } from "../../../src/performance/performanceService";
import { stubExtensionContext } from "../utils";

chai.use(sinonChai);

interface FakeDashboard {
    readonly controller: sinon.SinonStubbedInstance<PerformanceDashboardWebviewController>;
    dispose(): void;
}

suite("PerformanceDashboards", () => {
    let sandbox: sinon.SinonSandbox;
    let created: FakeDashboard[];
    let factory: sinon.SinonStub;
    let performanceService: PerformanceService;
    let dashboards: PerformanceDashboards;

    const sales: PerformanceDashboardTarget = {
        reference: { profileId: "profile-1", database: "Sales" },
        serverName: "contoso",
        databaseName: "Sales",
    };
    const orders: PerformanceDashboardTarget = {
        reference: { profileId: "profile-1", database: "Orders" },
        serverName: "contoso",
        databaseName: "Orders",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        created = [];
        factory = sandbox
            .stub()
            .callsFake((_context, _host, target: PerformanceDashboardTarget) => {
                const controller = sandbox.createStubInstance(
                    PerformanceDashboardWebviewController,
                );
                const disposed = new vscode.EventEmitter<void>();
                let isDisposed = false;
                let currentTarget = target;
                Object.defineProperty(controller, "isDisposed", { get: () => isDisposed });
                Object.defineProperty(controller, "onDisposed", { value: disposed.event });
                Object.defineProperty(controller, "target", { get: () => currentTarget });
                controller.setTarget.callsFake((next) => {
                    currentTarget = next;
                });
                created.push({
                    controller,
                    dispose: () => {
                        isDisposed = true;
                        disposed.fire();
                    },
                });
                return controller;
            });
        performanceService = sandbox.createStubInstance(PerformanceService);
        dashboards = new PerformanceDashboards(
            stubExtensionContext(sandbox),
            performanceService,
            { open: sandbox.stub(), compare: sandbox.stub().resolves() },
            factory,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("opens a dashboard at a location", () => {
        const dashboard = dashboards.open(sales, "queries/913");

        expect(factory).to.have.been.calledOnceWith(
            sinon.match.any,
            dashboards,
            sales,
            "queries/913",
        );
        expect(dashboard).to.equal(created[0].controller);
        expect(created[0].controller.revealToForeground).to.have.been.calledOnce;
    });

    test("reveals the open dashboard of the same database and keeps its location", () => {
        dashboards.open(sales);
        const again = dashboards.open({ ...sales });

        expect(factory).to.have.been.calledOnce;
        expect(again).to.equal(created[0].controller);
        expect(created[0].controller.revealToForeground).to.have.been.calledTwice;
        expect(created[0].controller.navigate).to.not.have.been.called;
    });

    test("navigates the open dashboard when a location is given", () => {
        dashboards.open(sales);
        dashboards.open(sales, "activity/77");

        expect(factory).to.have.been.calledOnce;
        expect(created[0].controller.navigate).to.have.been.calledOnceWithExactly("activity/77");
    });

    test("opens a separate dashboard for another database or connection", () => {
        dashboards.open(sales);
        dashboards.open(orders);
        dashboards.open({ ...sales, reference: { profileId: "profile-2", database: "Sales" } });

        expect(factory).to.have.been.calledThrice;
    });

    test("opens a new dashboard after the old one closes", () => {
        dashboards.open(sales);
        created[0].dispose();
        const reopened = dashboards.open(sales);

        expect(factory).to.have.been.calledTwice;
        expect(reopened).to.equal(created[1].controller);
    });

    test("switches a dashboard to another database and keeps one dashboard per database", () => {
        const dashboard = dashboards.open(sales);

        expect(dashboards.switchDatabase(dashboard, "Orders")).to.be.true;
        expect(created[0].controller.setTarget).to.have.been.calledOnceWithExactly(orders);
        expect(dashboards.open(orders)).to.equal(dashboard);
        dashboards.open(sales);
        expect(factory).to.have.been.calledTwice;
    });

    test("reveals the dashboard that already shows the database instead of switching", () => {
        const salesDashboard = dashboards.open(sales);
        const ordersDashboard = dashboards.open(orders);

        expect(dashboards.switchDatabase(salesDashboard, "Orders")).to.be.false;
        expect(created[0].controller.setTarget).to.not.have.been.called;
        expect(ordersDashboard.revealToForeground).to.have.been.calledTwice;
    });

    test("forgets a switched dashboard when it closes", () => {
        const dashboard = dashboards.open(sales);
        dashboards.switchDatabase(dashboard, "Orders");
        created[0].dispose();
        dashboards.open(orders);

        expect(factory).to.have.been.calledTwice;
    });
});
