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
import { SqlReader, SqlResultSet, classifyPlatform } from "sql-core";
import { QueryStoreCapabilities, queryStoreMetrics } from "sql-core/queryStore";
import { IConnectionProfile } from "../../../src/models/interfaces";
import * as Constants from "../../../src/constants/constants";
import * as LocConstants from "../../../src/constants/locConstants";
import { TreeNodeInfo } from "../../../src/objectExplorer/nodes/treeNodeInfo";
import { WebviewBaseController } from "../../../src/controllers/webviewBaseController";
import {
    PerformanceDashboardTarget,
    PerformanceDashboardWebviewController,
    performanceDashboardTargetForNode,
} from "../../../src/performance/performanceDashboardWebviewController";
import { QueryStoreOperation, QueryStoreService } from "../../../src/performance/queryStoreService";
import {
    ApplyPlanChangeRequest,
    ContinueInChatRequest,
    GetFavoriteQueriesRequest,
    GetTopQueriesRequest,
    ListDatabasesRequest,
    OpenPlanRequest,
    PerformanceRead,
    PreparedPlanChange,
    SetFavoriteQueryRequest,
    SetQueryCategoryRequest,
    TopQueries,
} from "../../../src/sharedInterfaces/performanceDashboard";
import {
    initializeIconUtils,
    observeWebviewReady,
    stubExtensionContext,
    stubTelemetry,
    stubWebviewPanel,
} from "../utils";

chai.use(sinonChai);

/** The global state key of the Queries category that the user chose last. */
const queryCategoryKey = "mssql.performanceDashboard.queryCategory";

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

function capabilitiesOf(platform: QueryStoreCapabilities["platform"]): QueryStoreCapabilities {
    return {
        platform,
        supported: true,
        metrics: queryStoreMetrics,
        hasPlanForcingType: true,
        hasPlanType: true,
        hasReplicaGroups: false,
        hasCapturePolicy: true,
        hasWaitStatsCapture: true,
        hasWaitStatsReplicaGroups: false,
    };
}

const sqlServer = capabilitiesOf(classifyPlatform({ engineEdition: 3, productVersion: "16.0" }));
const azureSql = capabilitiesOf(classifyPlatform({ engineEdition: 5 }));
const stateSet: SqlResultSet = { columns: ["actual_state", "readonly_reason"], rows: [[2, 0]] };

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
                profileId: "profile-1",
                serverName: "contoso.database.windows.net",
                databaseName: "Sales",
            });
        });

        test("uses the database of the parent database node for a child node", () => {
            const database = treeNode("Database", profile, databaseMetadata as ObjectMetadata);
            const tables = treeNode("Folder", profile, undefined, database);

            expect(performanceDashboardTargetForNode(tables)?.databaseName).to.equal("Sales");
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
            profileId: "profile-1",
            serverName: "contoso.database.windows.net",
            databaseName: "Sales",
        };
        let createWebviewPanel: sinon.SinonStub;
        let controller: PerformanceDashboardWebviewController | undefined;
        let queryStoreService: sinon.SinonStubbedInstance<QueryStoreService>;
        let host: {
            queryStoreService: QueryStoreService;
            switchDatabase: sinon.SinonStub;
            openPlanXml: sinon.SinonStub;
            compareExecutionPlans: sinon.SinonStub;
            openSqlScript: sinon.SinonStub;
            openChat: sinon.SinonStub;
        };
        let requestHandlers: Map<string, (params: unknown) => unknown>;
        /** The batches that the fake reader answers, by database. */
        let batches: Map<string, SqlResultSet[][]>;
        let reads: { database: string | undefined; purpose: string; sql: string }[];

        setup(() => {
            createWebviewPanel = sandbox
                .stub(vscode.window, "createWebviewPanel")
                .returns(stubWebviewPanel(sandbox));
            batches = new Map();
            reads = [];
            queryStoreService = sandbox.createStubInstance(QueryStoreService);
            queryStoreService.run.callsFake(
                async <T>(
                    _profileId: string,
                    database: string | undefined,
                    operation: QueryStoreOperation<T>,
                    purpose: "read" | "change" = "read",
                ): Promise<PerformanceRead<T>> => {
                    const reader: SqlReader = {
                        read: async (sql) => {
                            reads.push({ database, purpose, sql });
                            return batches.get(database ?? "")?.shift() ?? [];
                        },
                    };
                    return operation(reader, database === "master" ? azureSql : sqlServer);
                },
            );
            host = {
                queryStoreService,
                switchDatabase: sandbox.stub().returns(true),
                openPlanXml: sandbox.stub(),
                compareExecutionPlans: sandbox.stub().resolves(),
                openSqlScript: sandbox.stub().resolves(),
                openChat: sandbox.stub().resolves(),
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
            dashboardTarget: PerformanceDashboardTarget = target,
            initialLocation?: string,
            context: vscode.ExtensionContext = stubExtensionContext(sandbox),
        ): PerformanceDashboardWebviewController {
            controller = new PerformanceDashboardWebviewController(
                context,
                host,
                dashboardTarget,
                initialLocation,
            );
            observeWebviewReady(controller);
            return controller;
        }

        const request = <T>(method: string, params?: unknown) =>
            requestHandlers.get(method)!(params) as Promise<T>;

        test("opens a panel for the database with the server and database in its state", () => {
            const dashboard = createController(target, "queries/913");

            expect(createWebviewPanel).to.have.been.calledWithMatch(
                sinon.match.string,
                LocConstants.PerformanceDashboard.title("Sales"),
            );
            expect(dashboard.state).to.deep.equal({
                serverName: "contoso.database.windows.net",
                databaseName: "Sales",
                queryCategory: undefined,
            });
            expect(dashboard.location).to.equal("queries/913");
        });

        test("opens with the Queries category that the user chose last", () => {
            const context = stubExtensionContext(sandbox);
            (context.globalState.get as sinon.SinonStub)
                .withArgs(queryCategoryKey)
                .returns("memory");

            const dashboard = createController(target, undefined, context);

            expect(dashboard.state.queryCategory).to.equal("memory");
        });

        test("saves the Queries category that the user chooses, for the next dashboard", async () => {
            const context = stubExtensionContext(sandbox);
            const dashboard = createController(target, undefined, context);

            await request(SetQueryCategoryRequest.type.method, { category: "duration" });

            expect(context.globalState.update).to.have.been.calledOnceWithExactly(
                queryCategoryKey,
                "duration",
            );
            expect(dashboard.state.queryCategory).to.equal("duration");
        });

        test("keeps the Queries category when the dashboard switches database", async () => {
            const dashboard = createController();
            await request(SetQueryCategoryRequest.type.method, { category: "reads" });

            dashboard.setTarget({ ...target, databaseName: "Orders" });

            expect(dashboard.state).to.deep.equal({
                serverName: "contoso.database.windows.net",
                databaseName: "Orders",
                queryCategory: "reads",
            });
        });

        test("sends Copilot Chat a prompt to analyze or explain a query", async () => {
            createController();
            const window = {
                startUtc: "2026-10-01T00:00:00.000Z",
                endUtc: "2026-10-02T00:00:00.000Z",
            };

            await request(ContinueInChatRequest.type.method, {
                prompt: "analyze",
                queryId: "913",
                ...window,
            });
            await request(ContinueInChatRequest.type.method, {
                prompt: "explain",
                queryId: "913",
                ...window,
            });

            const [analyze, explain] = host.openChat.args.map(([prompt]) => prompt as string);
            const query =
                'Query Store query 913 in database "Sales" on server ' +
                '"contoso.database.windows.net" (saved connection profileId "profile-1") from ' +
                "2026-10-01T00:00:00.000Z to 2026-10-02T00:00:00.000Z UTC. Read it with " +
                "#mssql_query_store_analyze_query using that profileId and database.";
            expect(analyze.startsWith(`Analyze the performance of ${query}\n\n`)).to.be.true;
            expect(analyze).to.include("Recommend fixes, the most effective first");
            expect(explain.startsWith(`Explain ${query}\n\nIn plain language:`)).to.be.true;
            expect(explain).to.include("don't suggest changes unless something stands out");
        });

        test("uses the server name in the title for the default database", () => {
            createController({ ...target, databaseName: "" });

            expect(createWebviewPanel).to.have.been.calledWithMatch(
                sinon.match.string,
                LocConstants.PerformanceDashboard.title("contoso.database.windows.net"),
            );
        });

        test("reads the top queries of the dashboard's database in the window", async () => {
            batches.set("Sales", [[stateSet]]);
            createController();

            const result = await request<PerformanceRead<TopQueries>>(
                GetTopQueriesRequest.type.method,
                {
                    startUtc: "2026-10-01T00:00:00.000Z",
                    endUtc: "2026-10-02T00:00:00.000Z",
                    rankBy: "cpuTime",
                    statistic: "avg",
                    top: 25,
                },
            );

            expect(result.status).to.equal("noData");
            expect(reads).to.have.length(1);
            expect(reads[0]).to.include({ database: "Sales", purpose: "read" });
            expect(reads[0].sql).to.match(/SELECT TOP \(25\)/);
            expect(reads[0].sql).to.include("CAST(N'2026-10-01T00:00:00.000Z' AS datetimeoffset)");
        });

        test("applies a plan change on a session for changes", async () => {
            createController();

            await request(ApplyPlanChangeRequest.type.method, {
                target: { kind: "forcePlan", queryId: "42", planId: "7" },
                sql: "",
                prior: { queryStore: { actualState: "readWrite" }, forcedPlans: [] },
                blockers: [],
                warnings: [],
            } satisfies PreparedPlanChange);

            expect(queryStoreService.run).to.have.been.calledOnceWith(
                "profile-1",
                "Sales",
                sinon.match.func,
                "change",
            );
        });

        test("opens a plan's XML in the plan viewer, and says when it has none", async () => {
            batches.set("Sales", [
                [stateSet, { columns: ["query_plan"], rows: [["<ShowPlanXML/>"]] }],
                [stateSet, { columns: ["query_plan"], rows: [] }],
            ]);
            createController();

            expect(
                await request(OpenPlanRequest.type.method, { queryId: "42", planId: "7" }),
            ).to.deep.equal({ opened: true });
            expect(host.openPlanXml).to.have.been.calledOnceWithExactly(
                "<ShowPlanXML/>",
                LocConstants.PerformanceDashboard.planTitle("42", "7"),
            );
            expect(
                await request(OpenPlanRequest.type.method, { queryId: "42", planId: "8" }),
            ).to.deep.equal({ opened: false });
        });

        test("lists the databases from master in Azure SQL Database", async () => {
            batches.set("Sales", [[{ columns: ["name"], rows: [["master"], ["Sales"]] }]]);
            batches.set("master", [
                [{ columns: ["name"], rows: [["master"], ["Orders"], ["Sales"]] }],
            ]);
            queryStoreService.run
                .onFirstCall()
                .callsFake(async (_profileId, _database, operation) =>
                    operation({ read: async () => batches.get("Sales")!.shift()! }, azureSql),
                );
            createController();

            expect(await request(ListDatabasesRequest.type.method)).to.deep.equal({
                databases: ["master", "Orders", "Sales"],
            });
        });

        test("keeps favorite queries for each connection and database", async () => {
            createController();

            expect(await request(GetFavoriteQueriesRequest.type.method)).to.deep.equal({
                queryIds: [],
            });
            expect(
                await request(SetFavoriteQueryRequest.type.method, {
                    queryId: "913",
                    favorite: true,
                }),
            ).to.deep.equal({ queryIds: ["913"] });
        });
    });
});
