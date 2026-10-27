/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { AzureResource, Wrapper } from "@microsoft/vscode-azureresources-api";

import {
    FabricDatabaseHubIntegration,
    getFabricDatabaseHubLinkForConnection,
} from "../../src/integration/fabricDatabaseHubIntegration";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { IConnectionProfile } from "../../src/models/interfaces";
import { ObjectMetadata } from "vscode-mssql";
import { mockAzureResources, mockSubscriptions } from "./azureHelperStubs";
import { SqlArtifactTypes } from "../../src/sharedInterfaces/fabric";
import { createStubLogger, initializeIconUtils, stubTelemetry } from "./utils";
import {
    AzureResourceItem,
    AzureResourceTypeGroupNode,
    getAzureResource,
} from "../../src/integration/azureResourcesIntegration";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import {
    FabricWorkspaceArtifact,
    FabricWorkspaceItemNode,
} from "../../src/integration/fabricIntegration";

chai.use(sinonChai);

suite("FabricDatabaseHubIntegration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let openExternal: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let sendActionEvent: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;
    let integration: FabricDatabaseHubIntegration;

    const openedUrl = (): URL => new URL(openExternal.firstCall.args[0].toString(true));

    const estateFilters = (url: URL): unknown =>
        JSON.parse(url.searchParams.get("estateView")!).state.filters;

    const buildResourceNode = (resource: { id?: string }): Wrapper => {
        const resourceItem: AzureResourceItem = {
            resource: resource as AzureResource,
        };
        return { unwrap: <T>() => resourceItem as T };
    };

    const subscriptionId = mockSubscriptions[0].subscriptionId;
    const subscriptionFilterValue = subscriptionId.toLowerCase();

    const buildGroupNode = (groupSubscriptionId?: string): AzureResourceTypeGroupNode => ({
        subscription:
            groupSubscriptionId === undefined ? undefined : { subscriptionId: groupSubscriptionId },
    });

    const buildFabricNode = (
        artifact: Partial<FabricWorkspaceArtifact> = {},
    ): FabricWorkspaceItemNode => ({
        artifact: {
            id: "artifact-id",
            type: SqlArtifactTypes.SqlDatabase,
            displayName: "Fabric Orders",
            description: undefined,
            workspaceId: "workspace-id",
            fabricEnvironment: "PROD",
            ...artifact,
        },
    });

    const buildServerNode = (server: string, database?: string): TreeNodeInfo =>
        new TreeNodeInfo(
            server,
            { type: "Server", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.Collapsed,
            "server",
            undefined,
            "Server",
            undefined,
            { server, database } as IConnectionProfile,
            undefined,
            undefined,
            undefined,
        );

    const buildDatabaseNode = (server: string, database: string): TreeNodeInfo =>
        new TreeNodeInfo(
            database,
            { type: "Database", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.Collapsed,
            `server/Databases/${database}`,
            undefined,
            "Database",
            undefined,
            { server } as IConnectionProfile,
            buildServerNode(server),
            undefined,
            undefined,
            { metadataTypeName: "Database", name: database } as ObjectMetadata,
        );

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
        openExternal = sandbox.stub(vscode.env, "openExternal").resolves(true);
        showInformationMessage = sandbox.stub(vscode.window, "showInformationMessage").resolves();
        ({ sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox));

        integration = new FabricDatabaseHubIntegration();
        // Silence the internal logger to avoid writing to the output channel during tests.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (integration as any)._logger = createStubLogger(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Azure Resources tree", () => {
        test("unwraps an Azure Resources command argument", () => {
            expect(getAzureResource(buildResourceNode({ id: "resource-id" })).id).to.equal(
                "resource-id",
            );
        });

        test("narrows the estate grid to a single Azure SQL database", async () => {
            const database = mockAzureResources.azureSqlDbDatabase2;

            await integration["openInFabricDatabaseHub"](buildResourceNode(database));

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.pathname).to.equal("/workloads/fdh/databaseHub/estate");
            expect(url.searchParams.get("databaseType")).to.equal("azure-sql");
            // The Hub opens a database's details dialog only when this parameter is present.
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "subscription", operator: "in", value: [subscriptionFilterValue] },
                {
                    key: "resourceGroup",
                    operator: "in",
                    value: [subscriptionFilterValue + "/defaultresourcegroup"],
                },
                { key: "search", operator: "contains", value: database.name },
            ]);
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "azureResources",
                        databaseType: "azure-sql",
                        result: "succeeded",
                    },
                },
            );
        });

        test("narrows the estate grid to a subscription for the SQL databases folder", async () => {
            await integration["openInFabricDatabaseHub"](buildGroupNode(subscriptionId));

            expect(openExternal).to.have.been.calledOnce;
            // The folder spans every resource group in the subscription, so only the subscription
            // is filtered on.
            expect(estateFilters(openedUrl())).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "subscription", operator: "in", value: [subscriptionFilterValue] },
            ]);
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "azureResources",
                        databaseType: "azure-sql",
                        result: "succeeded",
                    },
                },
            );
        });

        test("ignores a grouping node that carries no subscription", async () => {
            await integration["openInFabricDatabaseHub"](buildGroupNode());

            // Grouping nodes are not Wrappers, so an unrecognized one must not be read as a node
            // from another tree.
            expect(openExternal).to.not.have.been.called;
            expect(sendErrorEvent).to.not.have.been.called;
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "unknown",
                        databaseType: "unknown",
                        result: "linkUnavailable",
                    },
                },
            );
        });

        test("ignores an Azure SQL server, which the estate grid has no row for", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbServer),
            );

            expect(openExternal).to.not.have.been.called;
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "azureResources",
                        databaseType: "azure-sql",
                        result: "linkUnavailable",
                    },
                },
            );
        });

        test("warns instead of opening the Hub for a system database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbDatabase1),
            );

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledOnce;
            expect(showInformationMessage.firstCall.args[0]).to.contain("master");
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "azureResources",
                        databaseType: "azure-sql",
                        result: "systemDatabase",
                    },
                },
            );
        });

        test("ignores resources from other providers", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.nonDatabaseResource),
            );

            expect(openExternal).to.not.have.been.called;
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "azureResources",
                        databaseType: "azure-sql",
                        result: "linkUnavailable",
                    },
                },
            );
        });
    });

    suite("Fabric workspace tree", () => {
        test("opens the matching Fabric environment for a SQL database item", async () => {
            await integration["openInFabricDatabaseHub"](
                buildFabricNode({ fabricEnvironment: "MSIT" }),
            );

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(url.searchParams.get("databaseType")).to.equal("fabric-sql");
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
                { key: "search", operator: "contains", value: "Fabric Orders" },
            ]);
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "fabricWorkspace",
                        databaseType: "fabric-sql",
                        result: "succeeded",
                    },
                },
            );
        });

        test("falls back to the production portal for an unknown environment", async () => {
            await integration["openInFabricDatabaseHub"](
                buildFabricNode({ fabricEnvironment: "UNKNOWN" }),
            );

            expect(openedUrl().origin).to.equal("https://app.fabric.microsoft.com");
        });

        test("ignores items that are not SQL databases", async () => {
            await integration["openInFabricDatabaseHub"](
                buildFabricNode({ type: SqlArtifactTypes.Warehouse, displayName: "Sales" }),
            );

            expect(openExternal).to.not.have.been.called;
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "fabricWorkspace",
                        databaseType: "unknown",
                        result: "linkUnavailable",
                    },
                },
            );
        });
    });

    suite("Object Explorer", () => {
        test("narrows the estate grid to an Azure SQL database node", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("contoso.database.windows.net", "OrdersDb"),
            );

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.origin).to.equal("https://app.fabric.microsoft.com");
            expect(url.searchParams.get("databaseType")).to.equal("azure-sql");
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "search", operator: "contains", value: "OrdersDb" },
            ]);
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "objectExplorer",
                        databaseType: "azure-sql",
                        result: "succeeded",
                    },
                },
            );
        });

        test("lists every Azure SQL database for a server node without a database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildServerNode("tcp:contoso.database.windows.net,1433"),
            );

            expect(estateFilters(openedUrl())).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
            ]);
        });

        test("opens the Fabric ring of a Fabric SQL server node", async () => {
            await integration["openInFabricDatabaseHub"](
                buildServerNode(
                    "abc.msit-database.fabric.microsoft.com,1433",
                    "Orders-0f8fad5b-d9cb-469f-a165-70867728950e",
                ),
            );

            const url = openedUrl();
            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
                { key: "search", operator: "contains", value: "Orders" },
            ]);
        });

        test("explains that a system database isn't tracked", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("contoso.database.windows.net", "master"),
            );

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledOnce;
        });

        test("explains that an on-premises server isn't tracked", async () => {
            await integration["openInFabricDatabaseHub"](buildServerNode("localhost", "Sales"));

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledOnce;
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    additionalProps: {
                        source: "objectExplorer",
                        databaseType: "unknown",
                        result: "linkUnavailable",
                    },
                },
            );
        });
    });

    test("has no connection link for an unknown Fabric ring", () => {
        expect(
            getFabricDatabaseHubLinkForConnection(
                "abc.zzz-database.fabric.microsoft.com",
                "Orders",
            ),
        ).to.be.undefined;
    });

    test("ignores nodes from unrelated trees", async () => {
        await integration["openInFabricDatabaseHub"](undefined);

        expect(openExternal).to.not.have.been.called;
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.FabricDatabaseHub,
            TelemetryActions.Open,
            {
                additionalProps: {
                    source: "unknown",
                    databaseType: "unknown",
                    result: "linkUnavailable",
                },
            },
        );
    });

    test("records errors opening an external Database Hub link", async () => {
        const error = new Error("Failed to open external link");
        openExternal.rejects(error);

        try {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbDatabase2),
            );
            expect.fail("Expected opening the Database Hub link to fail");
        } catch (actualError) {
            expect(actualError).to.equal(error);
        }

        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.FabricDatabaseHub,
            TelemetryActions.Open,
            {
                error,
                additionalProps: {
                    source: "azureResources",
                    databaseType: "azure-sql",
                },
            },
        );
    });
});
