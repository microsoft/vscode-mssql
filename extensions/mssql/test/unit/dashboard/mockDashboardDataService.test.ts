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
            expect(snapshot.operations.readiness.length).to.be.greaterThan(2);
            expect(snapshot.operations.topology.length).to.be.greaterThan(1);
            expect(snapshot.operations.configuration.length).to.be.greaterThan(2);
            expect(snapshot.operations.backups.length).to.be.greaterThan(0);
            expect(snapshot.operations.activity.length).to.be.greaterThan(2);
            expect(snapshot.dbAgent.issues.length).to.be.greaterThan(1);
            expect(snapshot.dbAgent.issues.some((issue) => issue.status === "resolved")).to.equal(
                true,
            );
            expect(snapshot.dbAgent.issues.some((issue) => issue.status === "closed")).to.equal(
                true,
            );
            expect(
                snapshot.dbAgent.issues.every(
                    (issue) =>
                        issue.metricCharts.length > 0 &&
                        issue.events.length > 1 &&
                        issue.recommendedActions.length > 0,
                ),
            ).to.equal(true);
            expect(snapshot.dbAgent.investigations.length).to.be.greaterThan(0);
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

    test("supports Database Agent approval and execution workflows", async () => {
        const service = new MockDashboardDataService();
        const target = service.getAvailableTargets()[0];
        const initialSnapshot = await service.loadDashboard(target);
        const issue = initialSnapshot.dbAgent.issues.find(
            (candidate) => candidate.status === "actionProposed",
        )!;
        const action = issue.recommendedActions[0];

        const approvedSnapshot = await service.decideDbAgentAction(
            target,
            issue.issueId,
            action.actionId,
            "approve",
        );
        expect(
            approvedSnapshot.dbAgent.issues.find((candidate) => candidate.issueId === issue.issueId)
                ?.recommendedActions[0].approvalStatus,
        ).to.equal("approved");

        const executedSnapshot = await service.executeDbAgentAction(
            target,
            issue.issueId,
            action.actionId,
        );
        const executedIssue = executedSnapshot.dbAgent.issues.find(
            (candidate) => candidate.issueId === issue.issueId,
        )!;
        expect(executedIssue.status).to.equal("verifying");
        expect(executedIssue.recommendedActions[0].approvalStatus).to.equal("executed");
        expect(executedIssue.actionsTaken).to.have.length(1);
        expect(executedSnapshot.dbAgent.activeInvestigation?.status).to.equal("monitoring");
    });

    test("supports analysis, settings, instructions, and investigation resolution", async () => {
        const service = new MockDashboardDataService();
        const target = service.getAvailableTargets()[0];
        const initialSnapshot = await service.loadDashboard(target);
        const issue = initialSnapshot.dbAgent.issues[0];

        const analyzedSnapshot = await service.analyzeDbAgentSection(
            target,
            issue.issueId,
            "diagnosis",
        );
        expect(
            analyzedSnapshot.dbAgent.issues.find((candidate) => candidate.issueId === issue.issueId)
                ?.analysisNotes.diagnosis,
        ).to.not.equal(undefined);

        const settings = {
            ...analyzedSnapshot.dbAgent.settings,
            notifyOnResolve: false,
        };
        const settingsSnapshot = await service.saveDbAgentSettings(target, settings);
        expect(settingsSnapshot.dbAgent.settings.notifyOnResolve).to.equal(false);

        const instructionSnapshot = await service.createDbAgentInstruction(
            target,
            "Never scale compute during the retail close window.",
        );
        const instructionId = instructionSnapshot.dbAgent.instructions[0].instructionId;
        expect(instructionSnapshot.dbAgent.instructions[0].text).to.contain("retail close");
        const revokedSnapshot = await service.revokeDbAgentInstruction(target, instructionId);
        expect(
            revokedSnapshot.dbAgent.instructions.some(
                (instruction) => instruction.instructionId === instructionId,
            ),
        ).to.equal(false);

        const investigationId = revokedSnapshot.dbAgent.activeInvestigation!.investigationId;
        const resolvedSnapshot = await service.forceResolveInvestigation(
            target,
            investigationId,
            "Validated by the database owner.",
        );
        expect(resolvedSnapshot.dbAgent.activeInvestigation).to.equal(undefined);
        expect(resolvedSnapshot.dbAgent.investigations[0].investigationId).to.equal(
            investigationId,
        );
        expect(resolvedSnapshot.dbAgent.investigations[0].status).to.equal("resolved");
    });

    test("registers an eligible Fabric Database Agent target", async () => {
        const service = new MockDashboardDataService();
        const target = service
            .getAvailableTargets()
            .find((candidate) => candidate.platform === "fabricSql")!;
        const initialSnapshot = await service.loadDashboard(target);

        expect(initialSnapshot.dbAgent.registrationMode).to.equal("notRegistered");

        const registeredSnapshot = await service.registerDbAgent(target);

        expect(registeredSnapshot.dbAgent.registrationMode).to.equal("registered");
        expect(registeredSnapshot.dbAgent.enabled).to.equal(true);
        expect(registeredSnapshot.dbAgent.settings.enabled).to.equal(true);
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
