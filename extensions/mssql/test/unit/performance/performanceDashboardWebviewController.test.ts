/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import type { ObjectMetadata } from "vscode-mssql";
import { IConnectionProfile } from "../../../src/models/interfaces";
import * as Constants from "../../../src/constants/constants";
import * as LocConstants from "../../../src/constants/locConstants";
import { TreeNodeInfo } from "../../../src/objectExplorer/nodes/treeNodeInfo";
import { WebviewBaseController } from "../../../src/controllers/webviewBaseController";
import {
    PerformanceDashboardTarget,
    PerformanceDashboardWebviewController,
    performanceDashboardTargetForDatabase,
    performanceDashboardTargetForNode,
} from "../../../src/performance/performanceDashboardWebviewController";
import { PerformanceService, PerformanceTarget } from "../../../src/performance/performanceService";
import { PerformanceResult } from "../../../src/sharedInterfaces/performance";
import {
    DatabaseFactsResult,
    GetDatabaseFactsRequest,
    GetMetricTotalsRequest,
    GetQueryStoreAvailabilityRequest,
    GetResourceConsumptionRequest,
    GetTopQueriesRequest,
    ApplyQueryStoreSettingsChangeRequest,
    GetQueryStoreSettingsRequest,
    OpenSqlScriptRequest,
    PrepareQueryStoreSettingsChangeRequest,
    ListDatabasesRequest,
    ListDatabasesResult,
    QueryStoreAvailability,
    SwitchDatabaseRequest,
} from "../../../src/sharedInterfaces/performanceDashboard";
import {
    initializeIconUtils,
    observeWebviewReady,
    stubExtensionContext,
    stubTelemetry,
    stubWebviewPanel,
} from "../utils";

chai.use(sinonChai);

const profile = {
    id: "profile-1",
    server: "contoso.database.windows.net",
    database: "master",
} as IConnectionProfile;

function treeNode(
    nodeType: string,
    connectionProfile: IConnectionProfile | undefined,
    metadata?: ObjectMetadata,
    parentNode?: TreeNodeInfo,
): TreeNodeInfo {
    return new TreeNodeInfo(
        "node",
        { type: nodeType, filterable: false, hasFilters: false, subType: "" },
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        nodeType,
        undefined,
        connectionProfile,
        parentNode,
        undefined,
        undefined,
        metadata,
    );
}

const databaseMetadata = { metadataTypeName: Constants.databaseString, name: "Sales" };

suite("PerformanceDashboardWebviewController", () => {
    let sandbox: sinon.SinonSandbox;

    suiteSetup(() => {
        // Tree nodes read their icons when they are created.
        initializeIconUtils();
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("performanceDashboardTargetForNode", () => {
        test("uses the saved profile and the database of a database node", () => {
            const node = treeNode("Database", profile, databaseMetadata as ObjectMetadata);

            expect(performanceDashboardTargetForNode(node)).to.deep.equal({
                reference: { profileId: "profile-1", database: "Sales" },
                serverName: "contoso.database.windows.net",
                databaseName: "Sales",
            });
        });

        test("uses the database of the parent database node for a child node", () => {
            const database = treeNode("Database", profile, databaseMetadata as ObjectMetadata);
            const tables = treeNode("Folder", profile, undefined, database);

            expect(performanceDashboardTargetForNode(tables)?.databaseName).to.equal("Sales");
        });

        test("uses the profile database for a server node that connects to a database", () => {
            const node = treeNode(Constants.serverLabel, { ...profile, database: "Orders" });

            expect(performanceDashboardTargetForNode(node)?.reference).to.deep.equal({
                profileId: "profile-1",
                database: "Orders",
            });
        });

        test("leaves out the database when the profile uses the default database", () => {
            const node = treeNode(Constants.serverLabel, { ...profile, database: "" });

            expect(performanceDashboardTargetForNode(node)).to.deep.equal({
                reference: { profileId: "profile-1" },
                serverName: "contoso.database.windows.net",
                databaseName: "",
            });
        });

        test("returns undefined without a node or a saved profile", () => {
            expect(performanceDashboardTargetForNode(undefined)).to.be.undefined;
            expect(
                performanceDashboardTargetForNode(
                    treeNode("Database", { ...profile, id: undefined }),
                ),
            ).to.be.undefined;
        });
    });

    suite("panel", () => {
        const target: PerformanceDashboardTarget = {
            reference: { profileId: "profile-1", database: "Sales" },
            serverName: "contoso.database.windows.net",
            databaseName: "Sales",
        };
        let createWebviewPanel: sinon.SinonStub;
        let controller: PerformanceDashboardWebviewController | undefined;
        let performanceService: sinon.SinonStubbedInstance<PerformanceService>;
        let host: {
            performanceService: PerformanceService;
            switchDatabase: sinon.SinonStub;
            openPlanXml: sinon.SinonStub;
            compareExecutionPlans: sinon.SinonStub;
        };
        let requestHandlers: Map<string, (params: unknown) => unknown>;

        setup(() => {
            createWebviewPanel = sandbox
                .stub(vscode.window, "createWebviewPanel")
                .returns(stubWebviewPanel(sandbox));
            performanceService = sandbox.createStubInstance(PerformanceService);
            host = {
                performanceService,
                switchDatabase: sandbox.stub().returns(true),
                openPlanXml: sandbox.stub(),
                compareExecutionPlans: sandbox.stub().resolves(),
            };
            requestHandlers = new Map();
            sandbox
                .stub(WebviewBaseController.prototype, "onRequest")
                .callsFake((type: { method: string }, handler: (params: unknown) => unknown) => {
                    requestHandlers.set(type.method, handler);
                });
        });

        teardown(() => {
            controller?.dispose();
            controller = undefined;
        });

        function createController(
            dashboardTarget: PerformanceDashboardTarget,
            initialLocation?: string,
        ): PerformanceDashboardWebviewController {
            controller = new PerformanceDashboardWebviewController(
                stubExtensionContext(sandbox),
                host,
                dashboardTarget,
                initialLocation,
            );
            observeWebviewReady(controller);
            return controller;
        }

        function databaseTarget(
            platform: string,
            databases: string[] | undefined,
        ): sinon.SinonStubbedInstance<PerformanceTarget> {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            performanceTarget.databases.resolves({
                status: databases ? "ready" : "permissionMissing",
                platform,
                observedAtUtc: "2026-10-08T00:00:00.000Z",
                missing: [],
                ...(databases
                    ? { data: databases }
                    : { error: { message: "VIEW ANY DATABASE was denied" } }),
            } as PerformanceResult<string[]>);
            return performanceTarget;
        }

        const listDatabases = () =>
            requestHandlers.get(ListDatabasesRequest.type.method)!(
                undefined,
            ) as Promise<ListDatabasesResult>;

        test("opens a panel for the database with the server and database in its state", () => {
            const dashboard = createController(target);

            expect(createWebviewPanel).to.have.been.calledWithMatch(
                sinon.match.string,
                LocConstants.PerformanceDashboard.title("Sales"),
            );
            expect(dashboard.state).to.deep.equal({
                serverName: "contoso.database.windows.net",
                databaseName: "Sales",
            });
            expect(dashboard.target).to.equal(target);
        });

        test("uses the performance dashboard icon for light and dark themes", () => {
            const dashboard = createController(target);
            const iconPath = dashboard.panel.iconPath as { light: vscode.Uri; dark: vscode.Uri };

            expect(iconPath.light.path).to.match(/\/media\/performanceDashboard_light\.svg$/);
            expect(iconPath.dark.path).to.match(/\/media\/performanceDashboard_dark\.svg$/);
        });

        test("starts at the given location and follows navigation", () => {
            const dashboard = createController(target, "queries/913");

            expect(dashboard.location).to.equal("queries/913");
            dashboard.navigate("activity/77");
            expect(dashboard.location).to.equal("activity/77");
        });

        test("starts at the default location without one", () => {
            expect(createController(target).location).to.equal("");
        });

        test("uses the server name in the title for the default database", () => {
            createController({
                ...target,
                reference: { profileId: "profile-1" },
                databaseName: "",
            });

            expect(createWebviewPanel).to.have.been.calledWithMatch(
                sinon.match.string,
                LocConstants.PerformanceDashboard.title("contoso.database.windows.net"),
            );
        });

        test("lists the databases that the target database sees", async () => {
            performanceService.resolveTarget.resolves(
                databaseTarget("sqlServer", ["master", "Orders", "Sales"]),
            );
            createController(target);

            expect(await listDatabases()).to.deep.equal({
                databases: ["master", "Orders", "Sales"],
            });
            expect(performanceService.resolveTarget).to.have.been.calledOnceWithExactly(
                target.reference,
            );
        });

        test("lists the databases from master in Azure SQL Database", async () => {
            performanceService.resolveTarget
                .onFirstCall()
                .resolves(databaseTarget("azureSqlDatabase", ["master", "Sales"]));
            performanceService.resolveTarget
                .onSecondCall()
                .resolves(databaseTarget("azureSqlDatabase", ["master", "Orders", "Sales"]));
            createController(target);

            expect(await listDatabases()).to.deep.equal({
                databases: ["master", "Orders", "Sales"],
            });
            expect(performanceService.resolveTarget.secondCall).to.have.been.calledWithExactly({
                profileId: "profile-1",
                database: "master",
            });
        });

        test("keeps the target database's list when master cannot be read", async () => {
            performanceService.resolveTarget
                .onFirstCall()
                .resolves(databaseTarget("azureSqlDatabase", ["master", "Sales"]));
            performanceService.resolveTarget
                .onSecondCall()
                .resolves(databaseTarget("azureSqlDatabase", undefined));
            createController(target);

            expect(await listDatabases()).to.deep.equal({ databases: ["master", "Sales"] });
        });

        test("returns the reason when the database list cannot be read", async () => {
            performanceService.resolveTarget.resolves({
                status: "unavailable",
                reason: "connectionFailed",
                detail: "Login failed",
            });
            createController(target);

            expect(await listDatabases()).to.deep.equal({
                databases: [],
                errorMessage: "Login failed",
            });
        });

        test("asks the host to switch the database", async () => {
            const dashboard = createController(target);

            const result = await requestHandlers.get(SwitchDatabaseRequest.type.method)!({
                database: "Orders",
            });

            expect(host.switchDatabase).to.have.been.calledOnceWithExactly(dashboard, "Orders");
            expect(result).to.deep.equal({ switched: true });
        });

        test("shows a new target in the panel title and state", () => {
            const dashboard = createController(target);
            const orders = performanceDashboardTargetForDatabase(target, "Orders");
            dashboard.setTarget(orders);

            expect(orders.reference).to.deep.equal({ profileId: "profile-1", database: "Orders" });
            expect(dashboard.target).to.equal(orders);
            expect(dashboard.panel.title).to.equal(
                LocConstants.PerformanceDashboard.title("Orders"),
            );
            expect(dashboard.state).to.deep.equal({
                serverName: "contoso.database.windows.net",
                databaseName: "Orders",
            });
        });

        const result = <T>(data: T | undefined, status = "ready"): PerformanceResult<T> =>
            ({
                status,
                platform: "sqlServer",
                observedAtUtc: "2026-10-08T00:00:00.000Z",
                missing: [],
                ...(data !== undefined ? { data } : { error: { message: "Timeout expired" } }),
            }) as PerformanceResult<T>;

        const request = <T>(method: string) =>
            requestHandlers.get(method)!(undefined) as Promise<T>;

        test("reads the platform and facts of the database", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            performanceTarget.databaseFacts.resolves(
                result({ edition: "Developer Edition (64-bit)", logicalCpus: 16 }),
            );
            performanceTarget.platform.resolves({
                platform: "sqlServer",
                engineEdition: 3,
                majorVersion: 16,
            });
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);

            expect(
                await request<DatabaseFactsResult>(GetDatabaseFactsRequest.type.method),
            ).to.deep.equal({
                platform: "sqlServer",
                majorVersion: 16,
                facts: { edition: "Developer Edition (64-bit)", logicalCpus: 16 },
            });
        });

        test("returns the error when the facts cannot be read", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            performanceTarget.databaseFacts.resolves(result(undefined, "temporarilyUnavailable"));
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);

            expect(
                await request<DatabaseFactsResult>(GetDatabaseFactsRequest.type.method),
            ).to.deep.equal({ platform: "sqlServer", errorMessage: "Timeout expired" });
        });

        test("returns the oldest Query Store interval as the available data", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            performanceTarget.queryStoreCapabilities.resolves(
                result({
                    operationalStatus: "readWrite",
                    availableMetrics: [],
                    isQdsRoAvailable: false,
                    replicas: [],
                    oldestIntervalStartUtc: "2026-09-27T03:00:00.000Z",
                }),
            );
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);

            expect(
                await request<QueryStoreAvailability>(GetQueryStoreAvailabilityRequest.type.method),
            ).to.deep.equal({ oldestIntervalStartUtc: "2026-09-27T03:00:00.000Z" });
        });

        test("returns no available data when Query Store is off or missing", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            performanceTarget.queryStoreCapabilities.resolves(
                result({
                    operationalStatus: "off",
                    availableMetrics: [],
                    isQdsRoAvailable: false,
                    replicas: [],
                    oldestIntervalStartUtc: "2026-09-27T03:00:00.000Z",
                }),
            );
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);

            expect(
                await request<QueryStoreAvailability>(GetQueryStoreAvailabilityRequest.type.method),
            ).to.deep.equal({});

            performanceTarget.queryStoreCapabilities.resolves(result(undefined, "unsupported"));
            expect(
                await request<QueryStoreAvailability>(GetQueryStoreAvailabilityRequest.type.method),
            ).to.deep.equal({});
        });

        test("totals a metric over the windows from the webview", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            const totals = result({ metric: "cpuTime" as const, windows: [] });
            performanceTarget.metricTotals.resolves(totals);
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);

            const response = await requestHandlers.get(GetMetricTotalsRequest.type.method)!({
                metric: "cpuTime",
                windows: [
                    { startUtc: "2026-10-07T00:00:00.000Z", endUtc: "2026-10-08T00:00:00.000Z" },
                ],
            });

            expect(response).to.equal(totals);
            expect(performanceTarget.metricTotals).to.have.been.calledOnceWithExactly({
                metric: "cpuTime",
                windows: [
                    {
                        start: new Date("2026-10-07T00:00:00.000Z"),
                        end: new Date("2026-10-08T00:00:00.000Z"),
                    },
                ],
            });
        });

        test("reads the resource consumption and the top queries of a window", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            const report = result({ columns: [], rows: [] });
            performanceTarget.overallConsumption.resolves(report);
            performanceTarget.topConsumers.resolves(report);
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);
            const window = {
                startUtc: "2026-10-07T00:00:00.000Z",
                endUtc: "2026-10-08T00:00:00.000Z",
            };
            const interval = { start: new Date(window.startUtc), end: new Date(window.endUtc) };

            expect(
                await requestHandlers.get(GetResourceConsumptionRequest.type.method)!(window),
            ).to.equal(report);
            expect(performanceTarget.overallConsumption).to.have.been.calledOnceWithExactly({
                specifiedTimeInterval: interval,
            });

            expect(
                await requestHandlers.get(GetTopQueriesRequest.type.method)!({
                    ...window,
                    metric: "cpuTime",
                    top: 10,
                }),
            ).to.equal(report);
            expect(performanceTarget.topConsumers).to.have.been.calledOnceWithExactly({
                selectedMetric: "cpuTime",
                selectedStatistic: "total",
                timeInterval: interval,
                // The dashboard's own reads are left out, so 20 more are read.
                topQueriesReturned: 30,
            });
        });

        test("returns why the database cannot be read instead of reading", async () => {
            const unavailable = {
                status: "unavailable" as const,
                reason: "connectionNotFound" as const,
            };
            performanceService.resolveTarget.resolves(unavailable);
            createController(target);

            expect(
                await requestHandlers.get(GetTopQueriesRequest.type.method)!({
                    startUtc: "2026-10-07T00:00:00.000Z",
                    endUtc: "2026-10-08T00:00:00.000Z",
                    metric: "cpuTime",
                    top: 10,
                }),
            ).to.equal(unavailable);
        });
        test("reads, prepares, and applies Query Store settings through the service", async () => {
            const performanceTarget = sandbox.createStubInstance(PerformanceTarget);
            const info = result({
                settings: { actualState: "readWrite" as const, desiredState: "readWrite" as const },
                canAlter: true,
                canChange: true,
                hasWaitStats: true,
            });
            const prepared = {
                kind: "queryStoreSettings" as const,
                change: { maxStorageMb: 2048 },
                sql: "ALTER DATABASE CURRENT SET QUERY_STORE (MAX_STORAGE_SIZE_MB = 2048);",
                prior: { actualState: "readWrite" as const, desiredState: "readWrite" as const },
                blockers: [],
                warnings: [],
            };
            const applied = result({ applied: true, blockers: [] });
            performanceTarget.queryStoreSettings.resolves(info);
            performanceTarget.prepareQueryStoreSettingsChange.resolves(result(prepared));
            performanceTarget.applyQueryStoreSettingsChange.resolves(applied);
            performanceService.resolveTarget.resolves(performanceTarget);
            createController(target);

            expect(await request(GetQueryStoreSettingsRequest.type.method)).to.equal(info);
            await requestHandlers.get(PrepareQueryStoreSettingsChangeRequest.type.method)!({
                maxStorageMb: 2048,
            });
            expect(performanceTarget.prepareQueryStoreSettingsChange).to.have.been.calledOnceWith({
                maxStorageMb: 2048,
            });
            expect(
                await requestHandlers.get(ApplyQueryStoreSettingsChangeRequest.type.method)!(
                    prepared,
                ),
            ).to.equal(applied);
            expect(performanceTarget.applyQueryStoreSettingsChange).to.have.been.calledOnceWith(
                prepared,
            );
        });

        test("opens a script in a new SQL editor", async () => {
            const document = {} as vscode.TextDocument;
            const openTextDocument = sandbox
                .stub(vscode.workspace, "openTextDocument")
                .resolves(document);
            const showTextDocument = sandbox.stub(vscode.window, "showTextDocument").resolves();
            createController(target);

            await requestHandlers.get(OpenSqlScriptRequest.type.method)!({ sql: "SELECT 1;" });

            expect(openTextDocument).to.have.been.calledOnceWithExactly({
                language: "sql",
                content: "SELECT 1;",
            });
            expect(showTextDocument).to.have.been.calledOnceWith(document);
        });
    });
});
