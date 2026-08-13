/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { detectDashboardPlatform } from "../../../src/services/dashboard/dashboardTarget";
import { MockDashboardDataService } from "../../../src/services/dashboard/mockDashboardDataService";

suite("Server Dashboard", () => {
    test("provides Azure SQL, SQL Server, and Fabric SQL mock targets", () => {
        const service = new MockDashboardDataService();

        const targets = service.getAvailableTargets();

        expect(targets.map((target) => target.platform)).to.have.members([
            "azureSql",
            "sqlServer",
            "fabricSql",
        ]);
        expect(targets.every((target) => target.databaseName.length > 0)).to.equal(true);
    });

    test("builds realistic platform-specific snapshots", async () => {
        const service = new MockDashboardDataService();

        for (const target of service.getAvailableTargets()) {
            const snapshot = await service.loadDashboard(target);

            expect(snapshot.target).to.deep.equal(target);
            expect(snapshot.metrics.length).to.be.greaterThan(4);
            expect(snapshot.metrics.every((metric) => metric.points.length > 5)).to.equal(true);
            expect(snapshot.queries.length).to.be.greaterThan(3);
            expect(snapshot.waits.length).to.be.greaterThan(3);
            expect(snapshot.sessions.length).to.be.greaterThan(3);
            expect(snapshot.dbAgent.issues.length).to.be.greaterThan(1);
        }
    });

    test("returns isolated snapshots and preserves provider state", async () => {
        const service = new MockDashboardDataService();
        const target = service.getAvailableTargets()[0];
        const firstSnapshot = await service.loadDashboard(target);
        firstSnapshot.metrics[0].value = -1;

        const secondSnapshot = await service.loadDashboard(target);

        expect(secondSnapshot.metrics[0].value).to.be.greaterThan(0);
    });

    test("refreshes the requested time window", async () => {
        const service = new MockDashboardDataService();
        const target = service.getAvailableTargets()[0];
        const initialSnapshot = await service.loadDashboard(target, 60);

        const refreshedSnapshot = await service.refreshDashboard(target, 360);

        expect(refreshedSnapshot.windowMinutes).to.equal(360);
        expect(refreshedSnapshot.metrics[0].value).to.not.equal(initialSnapshot.metrics[0].value);
        const firstPoint = new Date(refreshedSnapshot.metrics[0].points[0].timestamp).getTime();
        const lastPoint = new Date(refreshedSnapshot.metrics[0].points.at(-1)!.timestamp).getTime();
        expect(lastPoint - firstPoint).to.equal(360 * 60_000);
    });

    test("persists Database Agent issue and enablement changes", async () => {
        const service = new MockDashboardDataService();
        const target = service.getAvailableTargets()[0];
        const initialSnapshot = await service.loadDashboard(target, 360);
        const issueId = initialSnapshot.dbAgent.issues[0].issueId;

        const acknowledgedSnapshot = await service.acknowledgeIssue(target, issueId);
        const disabledSnapshot = await service.setDbAgentEnabled(target, false);
        const differentWindowSnapshot = await service.loadDashboard(target, 1440);

        expect(
            acknowledgedSnapshot.dbAgent.issues.find((issue) => issue.issueId === issueId)?.status,
        ).to.equal("monitoring");
        expect(acknowledgedSnapshot.windowMinutes).to.equal(360);
        expect(acknowledgedSnapshot.dbAgent.activeInvestigation?.status).to.equal("monitoring");
        expect(acknowledgedSnapshot.dbAgent.activeInvestigation?.events.at(-1)?.kind).to.equal(
            "monitoring",
        );
        expect(disabledSnapshot.dbAgent.enabled).to.equal(false);
        expect(disabledSnapshot.dbAgent.registrationMode).to.equal("notRegistered");
        expect(disabledSnapshot.windowMinutes).to.equal(360);
        expect(differentWindowSnapshot.dbAgent.enabled).to.equal(false);
        expect(
            differentWindowSnapshot.dbAgent.issues.find((issue) => issue.issueId === issueId)
                ?.status,
        ).to.equal("monitoring");
    });

    test("detects dashboard platforms from SQL host names", () => {
        expect(detectDashboardPlatform("sales.database.windows.net")).to.equal("azureSql");
        expect(detectDashboardPlatform("retail.datawarehouse.fabric.microsoft.com")).to.equal(
            "fabricSql",
        );
        expect(detectDashboardPlatform("sql2025-prod-01")).to.equal("sqlServer");
    });

    test("contributes dashboard commands, menus, settings, and webview bundle", () => {
        const extensionRoot = path.join(__dirname, "..", "..", "..", "..");
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
        );
        const commands = packageJson.contributes.commands as Array<{
            command: string;
            enablement?: string;
        }>;
        const commandIds = commands.map((command) => command.command);
        const objectExplorerCommands = packageJson.contributes.menus["view/item/context"].map(
            (menu: { command: string }) => menu.command,
        );
        const commandPalette = packageJson.contributes.menus.commandPalette as Array<{
            command: string;
            when?: string;
        }>;
        const configuration = packageJson.contributes.configuration.properties;
        const bundleScript = fs.readFileSync(
            path.join(extensionRoot, "scripts", "bundle-webviews.js"),
            "utf8",
        );

        expect(commandIds).to.include.members([
            "mssql.showServerDashboard",
            "mssql.showServerDashboardDbAgent",
        ]);
        expect(objectExplorerCommands).to.include.members([
            "mssql.showServerDashboard",
            "mssql.showServerDashboardDbAgent",
        ]);
        expect(
            commands.find((command) => command.command === "mssql.showServerDashboard")?.enablement,
        ).to.equal("config.mssql.dashboard.enabled");
        expect(
            commands.find((command) => command.command === "mssql.showServerDashboardDbAgent")
                ?.enablement,
        ).to.equal("config.mssql.dashboard.enabled && config.mssql.dbAgent.enabled");
        expect(
            commandPalette.find((menu) => menu.command === "mssql.showServerDashboardDbAgent")
                ?.when,
        ).to.equal("config.mssql.dashboard.enabled && config.mssql.dbAgent.enabled");
        expect(configuration).to.include.keys("mssql.dashboard.enabled", "mssql.dbAgent.enabled");
        expect(bundleScript).to.contain(
            'serverDashboard: "src/webviews/pages/ServerDashboard/index.tsx"',
        );
    });
});
