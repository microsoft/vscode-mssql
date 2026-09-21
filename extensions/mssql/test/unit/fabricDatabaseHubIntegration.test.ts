/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";

import * as Constants from "../../src/constants/constants";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { FabricDatabaseHubIntegration } from "../../src/integration/fabricDatabaseHubIntegration";
import { mockAzureResources } from "./azureHelperStubs";
import { SqlArtifactTypes } from "../../src/sharedInterfaces/fabric";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import { createStubLogger, initializeIconUtils } from "./utils";

chai.use(sinonChai);

suite("FabricDatabaseHubIntegration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let openExternal: sinon.SinonStub;
    let integration: FabricDatabaseHubIntegration;

    const openedUrl = (): URL => new URL(openExternal.firstCall.args[0].toString(true));

    const estateFilters = (url: URL): unknown =>
        JSON.parse(url.searchParams.get("estateView")!).state.filters;

    const buildResourceNode = (resource: { id?: string }): unknown => ({ resource });

    const buildObjectExplorerNode = (
        nodeType: string,
        profile: Partial<ConnectionProfile>,
    ): TreeNodeInfo =>
        new TreeNodeInfo(
            "label",
            { type: nodeType, subType: undefined, filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.Collapsed,
            "node-path",
            "",
            nodeType,
            "",
            Object.assign(new ConnectionProfile(), { id: "connection-id" }, profile),
            undefined!,
            undefined!,
            undefined!,
        );

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
        openExternal = sandbox.stub(vscode.env, "openExternal").resolves(true);

        integration = new FabricDatabaseHubIntegration();
        // Silence the internal logger to avoid writing to the output channel during tests.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (integration as any)._logger = createStubLogger(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Azure Resources tree", () => {
        test("deep-links an Azure SQL database to the Hub", async () => {
            const database = mockAzureResources.azureSqlDbDatabase2;

            await integration["openInFabricDatabaseHub"](buildResourceNode(database));

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.pathname).to.equal("/workloads/fdh/databaseHub/estate");
            expect(url.searchParams.get("databaseType")).to.equal("azure-sql");
            expect(url.searchParams.get("databaseResourceId")).to.equal(database.id);
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "search", operator: "contains", value: database.name },
            ]);
        });

        test("opens the unfiltered estate view for an Azure SQL server", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbServer),
            );

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
            ]);
        });

        test("ignores resources from other providers", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.nonDatabaseResource),
            );

            expect(openExternal).to.not.have.been.called;
        });
    });

    suite("Fabric workspace tree", () => {
        test("opens the matching Fabric environment for a SQL database item", async () => {
            await integration["openInFabricDatabaseHub"]({
                artifact: {
                    type: SqlArtifactTypes.SqlDatabase,
                    displayName: "Fabric Orders",
                    fabricEnvironment: "MSIT",
                },
            });

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(url.searchParams.get("databaseType")).to.equal("fabric-sql");
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
                { key: "search", operator: "contains", value: "Fabric Orders" },
            ]);
        });

        test("falls back to the production portal for an unreported environment", async () => {
            await integration["openInFabricDatabaseHub"]({
                artifact: { type: SqlArtifactTypes.SqlDatabase, displayName: "Fabric Orders" },
            });

            expect(openedUrl().origin).to.equal("https://app.fabric.microsoft.com");
        });

        test("ignores items that are not SQL databases", async () => {
            await integration["openInFabricDatabaseHub"]({
                artifact: { type: SqlArtifactTypes.Warehouse, displayName: "Sales" },
            });

            expect(openExternal).to.not.have.been.called;
        });
    });

    suite("Object Explorer", () => {
        test("deep-links an Azure SQL connection whose ARM resource can be resolved", async () => {
            sandbox.stub(VsCodeAzureHelper, "findSqlResource").resolves({
                accountId: "account-id",
                subscriptionId: "subscription-id",
                resourceGroup: "resource-group",
            });

            await integration["openInFabricDatabaseHub"](
                buildObjectExplorerNode(Constants.serverLabel, {
                    server: "sql-server.database.windows.net",
                    database: "sample-db",
                    accountId: "account-id",
                }),
            );

            expect(openExternal).to.have.been.calledOnce;
            expect(openedUrl().searchParams.get("databaseResourceId")).to.equal(
                "/subscriptions/subscription-id/resourceGroups/resource-group/providers/Microsoft.Sql/servers/sql-server/databases/sample-db",
            );
        });

        test("falls back to the estate view when the ARM resource cannot be resolved", async () => {
            sandbox.stub(VsCodeAzureHelper, "findSqlResource").resolves("UnableToCheck");

            await integration["openInFabricDatabaseHub"](
                buildObjectExplorerNode(Constants.serverLabel, {
                    server: "sql-server.database.windows.net",
                    database: "sample-db",
                    accountId: "account-id",
                }),
            );

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(url.searchParams.get("databaseType")).to.equal("azure-sql");
        });

        test("opens the MSIT Hub for a Fabric connection string", async () => {
            await integration["openInFabricDatabaseHub"](
                buildObjectExplorerNode(Constants.disconnectedServerNodeType, {
                    connectionString:
                        'Data Source=x6eps4xrq2xudenlfv6naeo3i4.msit-database.fabric.microsoft.com,1433;Initial Catalog="Test Database-0d373898-c2da-4729-ac46-80c1ef8ed940";Encrypt=True',
                }),
            );

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
                { key: "search", operator: "contains", value: "Test Database" },
            ]);
        });

        test("ignores connections that are not Azure SQL or Fabric SQL", async () => {
            await integration["openInFabricDatabaseHub"](
                buildObjectExplorerNode(Constants.serverLabel, { server: "localhost" }),
            );

            expect(openExternal).to.not.have.been.called;
        });

        test("ignores node types that do not represent a server or database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildObjectExplorerNode("Table", {
                    server: "sql-server.database.windows.net",
                    database: "sample-db",
                }),
            );

            expect(openExternal).to.not.have.been.called;
        });
    });

    test("ignores nodes from unrelated trees", async () => {
        await integration["openInFabricDatabaseHub"](undefined);
        await integration["openInFabricDatabaseHub"]({});
        await integration["openInFabricDatabaseHub"]("not a node");

        expect(openExternal).to.not.have.been.called;
    });
});
