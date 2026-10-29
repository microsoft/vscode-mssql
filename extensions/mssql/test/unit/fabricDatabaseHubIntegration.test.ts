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
import { ObjectMetadata, SimpleExecuteResult } from "vscode-mssql";

import { FabricDatabaseHubIntegration } from "../../src/integration/fabricDatabaseHubIntegration";
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
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { IConnectionProfile } from "../../src/models/interfaces";
import ConnectionManager, {
    ConnectionInfo,
    ConnectionSuccessfulEvent,
} from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { azureArcConnectSqlServerLink, azureMfa } from "../../src/constants/constants";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";

chai.use(sinonChai);

const connectionId = "connection-id";

/** Minimal in-memory `vscode.Memento`; it's an interface, so a hand-rolled fake is acceptable. */
function makeMemento(): vscode.Memento {
    const map = new Map<string, unknown>();
    return {
        keys: () => Array.from(map.keys()),
        get: <T>(key: string, defaultValue?: T): T | undefined =>
            map.has(key) ? (map.get(key) as T) : defaultValue,
        update: async (key: string, value: unknown): Promise<void> => {
            map.set(key, value);
        },
    } as unknown as vscode.Memento;
}

/** Builds the row the Arc registration query returns. */
const buildArcRegistrationResult = (
    machineName: string,
    arcPropertiesVisible: boolean,
    canViewMsdbMetadata: boolean,
    arcProperties?: string,
): SimpleExecuteResult => ({
    rowCount: 1,
    columnInfo: [],
    rows: [
        [
            machineName,
            arcPropertiesVisible ? "1" : "0",
            canViewMsdbMetadata ? "1" : "0",
            arcProperties,
        ].map((value) => ({ displayValue: value ?? "NULL", isNull: value === undefined })),
    ],
});

suite("FabricDatabaseHubIntegration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let openExternal: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let sendActionEvent: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;
    let getAccounts: sinon.SinonStub;
    let findSqlResource: sinon.SinonStub;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let sqlToolsClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let integration: FabricDatabaseHubIntegration;

    const openedUrl = (): URL => new URL(openExternal.firstCall.args[0]);

    const estateFilters = (url: URL): unknown =>
        JSON.parse(url.searchParams.get("estateView")!).state.filters;

    const expectOpenTelemetry = (additionalProps: Record<string, string>): void => {
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.FabricDatabaseHub,
            TelemetryActions.Open,
            { additionalProps },
        );
    };

    /** Returns the options of every telemetry event sent for an action. */
    const telemetryFor = (
        action: TelemetryActions,
    ): Array<{
        additionalProps: Record<string, string>;
        additionalMeasurements?: Record<string, number>;
    }> =>
        sendActionEvent
            .getCalls()
            .filter((call) => call.args[1] === action)
            .map((call) => call.args[2]);

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
            id: "0d373898-c2da-4729-ac46-80c1ef8ed940",
            type: SqlArtifactTypes.SqlDatabase,
            displayName: "Fabric Orders",
            description: undefined,
            workspaceId: "workspace-id",
            fabricEnvironment: "PROD",
            ...artifact,
        },
    });

    const buildConnectionNode = (server: string, database?: string): TreeNodeInfo =>
        new TreeNodeInfo(
            server,
            { type: "Server", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.Collapsed,
            "server",
            undefined,
            "Server",
            undefined,
            { id: connectionId, server, database } as IConnectionProfile,
            undefined,
            undefined,
            undefined,
        );

    const buildDatabaseNode = (
        server: string,
        database: string,
        containerName?: string,
    ): TreeNodeInfo =>
        new TreeNodeInfo(
            database,
            { type: "Database", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.Collapsed,
            `server/Databases/${database}`,
            undefined,
            "Database",
            undefined,
            { id: connectionId, server, containerName } as IConnectionProfile,
            buildConnectionNode(server),
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
        getAccounts = sandbox.stub(VsCodeAzureHelper, "getAccounts").resolves([]);
        findSqlResource = sandbox
            .stub(VsCodeAzureHelper, "findSqlResource")
            .resolves("UnableToCheck");
        sandbox
            .stub(vscode.window, "withProgress")
            .callsFake((_options, task) =>
                task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
            );
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionManager.connect.resolves(true);
        sqlToolsClient = sandbox.createStubInstance(SqlToolsServiceClient);
        sandbox.stub(connectionManager, "client").get(() => sqlToolsClient);

        integration = new FabricDatabaseHubIntegration(connectionManager, makeMemento());
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

        test("opens an Azure SQL database's details dialog over the Azure SQL grid", async () => {
            const database = mockAzureResources.azureSqlDbDatabase2;

            await integration["openInFabricDatabaseHub"](buildResourceNode(database));

            expect(openExternal).to.have.been.calledOnce;
            const url = openedUrl();
            expect(url.pathname).to.equal("/workloads/fdh/databaseHub/estate");
            expect(url.searchParams.get("databaseResourceId")).to.equal(database.id);
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
            ]);
            expectOpenTelemetry({
                source: "azureResources",
                databaseType: "azure-sql",
                nodeKind: "database",
                result: "succeeded",
            });
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
            expectOpenTelemetry({
                source: "azureResources",
                databaseType: "azure-sql",
                nodeKind: "databaseGroup",
                result: "succeeded",
            });
        });

        test("ignores a grouping node that carries no subscription", async () => {
            await integration["openInFabricDatabaseHub"](buildGroupNode());

            // Grouping nodes are not Wrappers, so an unrecognized one must not be read as a node
            // from another tree.
            expect(openExternal).to.not.have.been.called;
            expect(sendErrorEvent).to.not.have.been.called;
            expectOpenTelemetry({
                source: "unknown",
                databaseType: "unknown",
                nodeKind: "other",
                result: "linkUnavailable",
            });
        });

        test("ignores an Azure SQL server, which the estate grid has no row for", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbServer),
            );

            expect(openExternal).to.not.have.been.called;
            expectOpenTelemetry({
                source: "azureResources",
                databaseType: "azure-sql",
                nodeKind: "other",
                result: "linkUnavailable",
            });
        });

        test("warns instead of opening the Hub for a system database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbDatabase1),
            );

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledOnce;
            expect(showInformationMessage.firstCall.args[0]).to.contain("master");
            expectOpenTelemetry({
                source: "azureResources",
                databaseType: "azure-sql",
                nodeKind: "database",
                result: "systemDatabase",
            });
        });

        test("ignores resources from other providers", async () => {
            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.nonDatabaseResource),
            );

            expect(openExternal).to.not.have.been.called;
            expectOpenTelemetry({
                source: "azureResources",
                databaseType: "azure-sql",
                nodeKind: "other",
                result: "linkUnavailable",
            });
        });

        test("explains that the Hub is unavailable in a cloud with no Fabric portal", async () => {
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .callThrough()
                .withArgs("microsoft-sovereign-cloud")
                .returns({
                    get: () => "USGovernment",
                } as unknown as vscode.WorkspaceConfiguration);

            await integration["openInFabricDatabaseHub"](
                buildResourceNode(mockAzureResources.azureSqlDbDatabase2),
            );

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledOnce;
            expect(showInformationMessage.firstCall.args[0]).to.contain("US Government");
            expectOpenTelemetry({
                source: "azureResources",
                databaseType: "azure-sql",
                nodeKind: "database",
                result: "portalUnavailable",
            });
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
            expect(url.searchParams.get("databaseResourceId")).to.equal(
                "0d373898-c2da-4729-ac46-80c1ef8ed940",
            );
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
            ]);
            expectOpenTelemetry({
                source: "fabricWorkspace",
                databaseType: "fabric-sql",
                nodeKind: "database",
                result: "succeeded",
            });
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
            expectOpenTelemetry({
                source: "fabricWorkspace",
                databaseType: "unknown",
                nodeKind: "other",
                result: "linkUnavailable",
            });
        });
    });

    suite("Object Explorer", () => {
        test("opens an Azure SQL database found through a signed-in Azure account", async () => {
            getAccounts.resolves([{ id: "account-1", label: "user@contoso.com" }]);
            findSqlResource.resolves({
                accountId: "account-1",
                subscriptionId: "sub-1",
                resourceGroup: "Orders-RG",
            });

            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("tcp:contoso.database.windows.net,1433", "OrdersDb"),
            );

            expect(findSqlResource).to.have.been.calledWith("account-1", "contoso");
            const url = openedUrl();
            expect(url.origin).to.equal("https://app.fabric.microsoft.com");
            expect(url.searchParams.get("databaseResourceId")).to.equal(
                "/subscriptions/sub-1/resourceGroups/Orders-RG/providers/Microsoft.Sql/servers/contoso/databases/OrdersDb",
            );
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
            ]);
            const [openEvent] = telemetryFor(TelemetryActions.Open);
            expect(openEvent.additionalProps).to.deep.equal({
                source: "objectExplorer",
                databaseType: "azure-sql",
                nodeKind: "database",
                linkKind: "deepLink",
                azureLookup: "found",
                result: "succeeded",
            });
            expect(openEvent.additionalMeasurements?.azureLookupMs).to.be.a("number");
        });

        test("tries the connection's own Entra account first", async () => {
            getAccounts.resolves([{ id: "other-account", label: "other@contoso.com" }]);
            findSqlResource.withArgs("entra-account").resolves({
                accountId: "entra-account",
                subscriptionId: "sub-1",
                resourceGroup: "rg",
            });
            const node = new TreeNodeInfo(
                "OrdersDb",
                { type: "Database", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.Collapsed,
                "server/Databases/OrdersDb",
                undefined,
                "Database",
                undefined,
                {
                    id: connectionId,
                    server: "contoso.database.windows.net",
                    authenticationType: azureMfa,
                    accountId: "entra-account",
                } as IConnectionProfile,
                undefined,
                undefined,
                undefined,
                { metadataTypeName: "Database", name: "OrdersDb" } as ObjectMetadata,
            );

            await integration["openInFabricDatabaseHub"](node);

            expect(findSqlResource.firstCall.args[0]).to.equal("entra-account");
            expect(openedUrl().searchParams.has("databaseResourceId")).to.be.true;
        });

        test("searches the Hub by name when no Azure account is signed in", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("contoso.database.windows.net", "OrdersDb"),
            );

            const url = openedUrl();
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "search", operator: "contains", value: "OrdersDb" },
            ]);
            expect(telemetryFor(TelemetryActions.Open)[0].additionalProps).to.include({
                linkKind: "search",
                azureLookup: "noAccount",
                result: "succeeded",
            });
        });

        test("opens the Fabric ring of a connection scoped to a Fabric SQL database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildConnectionNode(
                    "abc.msit-database.fabric.microsoft.com,1433",
                    "Orders-0f8fad5b-d9cb-469f-a165-70867728950e",
                ),
            );

            const url = openedUrl();
            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(url.searchParams.get("databaseResourceId")).to.equal(
                "0f8fad5b-d9cb-469f-a165-70867728950e",
            );
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
            ]);
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "fabric-sql",
                nodeKind: "connection",
                result: "succeeded",
            });
        });

        test("ignores a connection that names no database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildConnectionNode("contoso.database.windows.net"),
            );

            expect(openExternal).to.not.have.been.called;
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "azure-sql",
                nodeKind: "connection",
                result: "linkUnavailable",
            });
        });

        test("ignores a Fabric SQL server in an unknown pre-production ring", async () => {
            await integration["openInFabricDatabaseHub"](
                buildConnectionNode("abc.future-database.fabric.microsoft.com", "Orders"),
            );

            expect(openExternal).to.not.have.been.called;
        });

        test("ignores servers the Hub has no inventory for", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("contoso.sql.azuresynapse.net", "Sales"),
            );

            expect(openExternal).to.not.have.been.called;
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "unknown",
                nodeKind: "database",
                result: "linkUnavailable",
            });
        });

        test("ignores containers, which can't be connected to Azure Arc", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("localhost,1434", "Sales", "sql2025"),
            );

            expect(connectionManager.connect).to.not.have.been.called;
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "unknown",
                nodeKind: "database",
                result: "linkUnavailable",
            });
        });

        test("checks a local SQL Server for its Azure Arc registration", async () => {
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult("SQLPROD01", false, true),
            );

            await integration["openInFabricDatabaseHub"](buildDatabaseNode("localhost", "Sales"));

            expect(connectionManager.connect).to.have.been.calledOnce;
            expect(showInformationMessage.firstCall.args[0]).to.contain("localhost");
        });

        test("warns instead of opening the Hub for a system database", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("contoso.database.windows.net", "master"),
            );

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledOnce;
            expect(showInformationMessage.firstCall.args[0]).to.contain("master");
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "azure-sql",
                nodeKind: "database",
                result: "systemDatabase",
            });
        });
    });

    suite("Object Explorer managed instances", () => {
        test("opens the managed instance, which the Hub lists instead of its databases", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("orders-mi.0a1b2c3d4e5f.database.windows.net", "OrdersDb"),
            );

            const url = openedUrl();
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSqlManagedInstance"] },
                { key: "search", operator: "contains", value: "orders-mi" },
            ]);
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "azure-sql-managed-instance",
                nodeKind: "database",
                result: "succeeded",
            });
        });

        test("opens the managed instance for its system databases too", async () => {
            await integration["openInFabricDatabaseHub"](
                buildDatabaseNode("orders-mi.public.0a1b2c3d4e5f.database.windows.net", "master"),
            );

            expect(showInformationMessage).to.not.have.been.called;
            expect(estateFilters(openedUrl())).to.deep.include({
                key: "search",
                operator: "contains",
                value: "orders-mi",
            });
        });
    });

    suite("Object Explorer SQL Server", () => {
        const server = "sqlprod01.contoso.com";
        const buildConnectionEvent = (
            eventConnectionId: string,
            fileUri: string,
        ): ConnectionSuccessfulEvent => {
            const connection = new ConnectionInfo();
            connection.credentials = { id: eventConnectionId, server } as IConnectionProfile;
            return { connection, fileUri };
        };
        const arcResourceId =
            "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/Arc-RG/providers/Microsoft.AzureArcData/SqlServerInstances/SQLPROD01";

        test("opens the Arc-enabled instance it's registered as", async () => {
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult(
                    "SQLPROD01",
                    true,
                    true,
                    `<row resourceId="${arcResourceId}" region="eastus"/>`,
                ),
            );

            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));

            const ownerUri = connectionManager.connect.firstCall.args[0];
            expect(connectionManager.connect.firstCall.args[1]).to.include({ server });
            expect(connectionManager.disconnect).to.have.been.calledWith(ownerUri);
            const url = openedUrl();
            expect(url.searchParams.get("databaseResourceId")).to.equal(arcResourceId);
            expect(estateFilters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["ArcSqlServer", "AzureSqlVM"] },
            ]);
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "database",
                arcRegistration: "registered",
                result: "succeeded",
            });
        });

        test("asks the user to connect a server that isn't Arc-enabled to Azure Arc", async () => {
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult("SQLPROD01", false, true),
            );
            showInformationMessage.resolves(LocalizedConstants.Azure.learnHowToConnectToAzureArc);

            await integration["openInFabricDatabaseHub"](buildConnectionNode(server));

            expect(showInformationMessage.firstCall.args[0]).to.contain(server);
            expect(openExternal).to.have.been.calledOnce;
            expect(openExternal.firstCall.args[0].toString()).to.equal(
                vscode.Uri.parse(azureArcConnectSqlServerLink).toString(),
            );
            const [promptEvent] = telemetryFor(TelemetryActions.Open);
            const { arcPromptId, ...promptProps } = promptEvent.additionalProps;
            expect(arcPromptId).to.be.a("string").that.is.not.empty;
            expect(promptProps).to.deep.equal({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "connection",
                arcRegistration: "notRegistered",
                followUp: "learnHow",
                result: "arcNotRegistered",
            });
            expect(promptEvent.additionalMeasurements).to.deep.equal({ promptCount: 1 });
        });

        test("credits the prompt once the server turns up connected to Azure Arc", async () => {
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult("SQLPROD01", false, true),
            );
            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));
            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));
            const promptEvents = telemetryFor(TelemetryActions.Open);
            const arcPromptId = promptEvents[0].additionalProps.arcPromptId;
            // A repeat prompt joins the first prompt's funnel.
            expect(promptEvents[1].additionalProps.arcPromptId).to.equal(arcPromptId);
            expect(promptEvents[1].additionalMeasurements).to.deep.equal({ promptCount: 2 });

            sendActionEvent.resetHistory();
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult(
                    "SQLPROD01",
                    true,
                    true,
                    `<row resourceId="${arcResourceId}"/>`,
                ),
            );
            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));

            expect(telemetryFor(TelemetryActions.ArcEnabledAfterPrompt)).to.deep.equal([
                {
                    additionalProps: {
                        arcPromptId,
                        detectedBy: "action",
                        learnHowOpened: "false",
                    },
                    additionalMeasurements: { daysSincePrompt: 0, promptCount: 2 },
                },
            ]);
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "database",
                arcRegistration: "registered",
                arcPromptId,
                result: "succeeded",
            });

            // The prompt is credited once.
            sendActionEvent.resetHistory();
            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));
            expect(telemetryFor(TelemetryActions.ArcEnabledAfterPrompt)).to.be.empty;
        });

        suite("when the user connects to a prompted server again", () => {
            const connectionEvent = (fileUri = "file:///query.sql"): ConnectionSuccessfulEvent =>
                buildConnectionEvent(connectionId, fileUri);

            setup(async () => {
                sqlToolsClient.sendRequest.resolves(
                    buildArcRegistrationResult("SQLPROD01", false, true),
                );
                showInformationMessage.resolves(
                    LocalizedConstants.Azure.learnHowToConnectToAzureArc,
                );
                await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));
                connectionManager.connect.resetHistory();
                openExternal.resetHistory();
                showInformationMessage.reset();
                sendActionEvent.resetHistory();
            });

            test("offers the Hub once the server is connected to Azure Arc", async () => {
                sqlToolsClient.sendRequest.resolves(
                    buildArcRegistrationResult(
                        "SQLPROD01",
                        true,
                        true,
                        `<row resourceId="${arcResourceId}"/>`,
                    ),
                );
                showInformationMessage.resolves(LocalizedConstants.Azure.openInFabricDatabaseHub);

                await integration["checkPromptedServer"](connectionEvent());

                // The check doesn't report connection errors the user never asked about.
                expect(connectionManager.connect.firstCall.args[2]).to.include({
                    shouldHandleErrors: false,
                });
                expect(showInformationMessage.firstCall.args[0]).to.contain(server);
                expect(openedUrl().searchParams.get("databaseResourceId")).to.equal(arcResourceId);
                const [credit] = telemetryFor(TelemetryActions.ArcEnabledAfterPrompt);
                expect(credit.additionalProps).to.include({
                    detectedBy: "connection",
                    learnHowOpened: "true",
                });
                expectOpenTelemetry({
                    source: "arcEnabledNotification",
                    databaseType: "arc-sql-server",
                    arcRegistration: "registered",
                    arcPromptId: credit.additionalProps.arcPromptId,
                    result: "succeeded",
                });
            });

            test("checks again at most once a day", async () => {
                await integration["checkPromptedServer"](connectionEvent());
                await integration["checkPromptedServer"](connectionEvent());

                expect(connectionManager.connect).to.have.been.calledOnce;
                expect(showInformationMessage).to.not.have.been.called;
                expect(telemetryFor(TelemetryActions.ArcEnabledAfterPrompt)).to.be.empty;
            });

            test("ignores the connections it opens to check", async () => {
                await integration["checkPromptedServer"](
                    connectionEvent("fabric-database-hub-arc-check-1234"),
                );

                expect(connectionManager.connect).to.not.have.been.called;
            });
        });

        test("doesn't check servers the user was never prompted for", async () => {
            await integration["checkPromptedServer"](
                buildConnectionEvent("other-connection", "file:///query.sql"),
            );

            expect(connectionManager.connect).to.not.have.been.called;
        });

        test("offers to search by machine name when the login can't read msdb", async () => {
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult("SQLPROD01", false, false),
            );
            showInformationMessage.resolves(LocalizedConstants.Azure.searchFabricDatabaseHub);

            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));

            expect(estateFilters(openedUrl())).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["ArcSqlServer", "AzureSqlVM"] },
                { key: "search", operator: "contains", value: "SQLPROD01" },
            ]);
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "database",
                arcRegistration: "unknown",
                result: "succeeded",
            });
        });

        test("records a dismissed search offer", async () => {
            sqlToolsClient.sendRequest.resolves(
                buildArcRegistrationResult("SQLPROD01", true, true),
            );

            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));

            expect(openExternal).to.not.have.been.called;
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "database",
                arcRegistration: "unknown",
                result: "dismissed",
            });
        });

        test("doesn't connect in a cloud with no Fabric portal", async () => {
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .callThrough()
                .withArgs("microsoft-sovereign-cloud")
                .returns({
                    get: () => "USGovernment",
                } as unknown as vscode.WorkspaceConfiguration);

            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));

            expect(connectionManager.connect).to.not.have.been.called;
            expect(showInformationMessage.firstCall.args[0]).to.contain("US Government");
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "database",
                result: "portalUnavailable",
            });
        });

        test("stops when the server can't be connected to", async () => {
            connectionManager.connect.resolves(false);

            await integration["openInFabricDatabaseHub"](buildDatabaseNode(server, "Sales"));

            expect(sqlToolsClient.sendRequest).to.not.have.been.called;
            expect(openExternal).to.not.have.been.called;
            expectOpenTelemetry({
                source: "objectExplorer",
                databaseType: "arc-sql-server",
                nodeKind: "database",
                result: "connectionFailed",
            });
        });
    });

    test("opens the link as is, so reserved characters in a name survive", async () => {
        await integration["openInFabricDatabaseHub"](
            buildDatabaseNode("contoso.database.windows.net", "Sales+Ops #2"),
        );

        // A Uri would be decoded and re-encoded by VS Code, turning the '+' into a space and
        // double-encoding the '#'.
        expect(openExternal.firstCall.args[0]).to.be.a("string");
        expect(estateFilters(openedUrl())).to.deep.include({
            key: "search",
            operator: "contains",
            value: "Sales+Ops #2",
        });
    });

    test("ignores nodes from unrelated trees", async () => {
        await integration["openInFabricDatabaseHub"](undefined);

        expect(openExternal).to.not.have.been.called;
        expectOpenTelemetry({
            source: "unknown",
            databaseType: "unknown",
            nodeKind: "other",
            result: "linkUnavailable",
        });
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
                    nodeKind: "database",
                },
            },
        );
    });
});
