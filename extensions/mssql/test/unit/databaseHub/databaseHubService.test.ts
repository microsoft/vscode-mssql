/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { AzureResource, Wrapper } from "@microsoft/vscode-azureresources-api";

import { requestFor } from "../../../src/databaseHub/databaseHubContribution";
import {
    AccountDatabaseHubAzureLookup,
    FabricApiDatabaseHubLookup,
} from "../../../src/databaseHub/databaseHubLookups";
import {
    DatabaseHubServerFactsDetector,
    DatabaseHubServerFactsStore,
} from "../../../src/databaseHub/databaseHubServerFacts";
import {
    DatabaseHubConnectionProfile,
    DatabaseHubService,
    DatabaseHubSource,
    connectToArcLearnMoreUrl,
} from "../../../src/databaseHub/databaseHubService";
import { DatabaseHubServerFacts } from "../../../src/databaseHub/databaseHubTarget";
import * as LocalizedConstants from "../../../src/constants/locConstants";
import { AzureResourceItem } from "../../../src/integration/azureResourcesIntegration";
import { FabricWorkspaceItemNode } from "../../../src/integration/fabricIntegration";
import { SqlArtifactTypes } from "../../../src/sharedInterfaces/fabric";
import { TelemetryActions, TelemetryViews } from "../../../src/sharedInterfaces/telemetry";
import { mockAzureResources, mockSubscriptions } from "../azureHelperStubs";
import { createStubLogger, stubTelemetry } from "../utils";

chai.use(sinonChai);

class MemoryMemento implements vscode.Memento {
    private readonly _values = new Map<string, unknown>();
    keys(): readonly string[] {
        return [...this._values.keys()];
    }
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this._values.has(key) ? this._values.get(key) : defaultValue) as T | undefined;
    }
    update(key: string, value: unknown): Thenable<void> {
        this._values.set(key, value);
        return Promise.resolve();
    }
}

const sub = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
const serverId = `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Sql/servers/srv`;
const instanceId = `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Sql/managedInstances/mi`;
const arcId = `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.AzureArcData/sqlServerInstances/box01`;
const vmId = `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.SqlVirtualMachine/sqlVirtualMachines/vm01`;
const fabricItemId = "0d373898-c2da-4729-ac46-80c1ef8ed940";

suite("DatabaseHubService", () => {
    let sandbox: sinon.SinonSandbox;
    let openExternal: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let sendActionEvent: sinon.SinonStub;
    let store: DatabaseHubServerFactsStore;
    let azure: sinon.SinonStubbedInstance<AccountDatabaseHubAzureLookup>;
    let fabric: sinon.SinonStubbedInstance<FabricApiDatabaseHubLookup>;
    let service: DatabaseHubService;
    let liveServerInfo: sinon.SinonStub;

    const openedUrl = (): URL => new URL(openExternal.lastCall.args[0].toString(true));
    const filters = (url: URL): unknown =>
        JSON.parse(url.searchParams.get("estateView")!).state.filters;

    const open = (
        profile: Partial<DatabaseHubConnectionProfile>,
        database?: string,
        facts?: Partial<DatabaseHubServerFacts>,
    ) => {
        const full = { id: "c1", server: "", ...profile };
        if (facts) {
            void store.set(full.id, { server: full.server, ...facts });
        }
        return service.open(
            { kind: "connection", profile: full, database },
            DatabaseHubSource.ObjectExplorer,
        );
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        openExternal = sandbox.stub(vscode.env, "openExternal").resolves(true);
        showInformationMessage = sandbox.stub(vscode.window, "showInformationMessage").resolves();
        sandbox.stub(vscode.window, "withProgress").callsFake((_options, task) =>
            task({ report: () => undefined }, {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => undefined }),
            } as never),
        );
        ({ sendActionEvent } = stubTelemetry(sandbox));

        store = new DatabaseHubServerFactsStore(new MemoryMemento());
        liveServerInfo = sandbox.stub().returns(undefined);
        const detector = sandbox.createStubInstance(DatabaseHubServerFactsDetector);
        detector.ensure.callsFake(async (profile) => store.get(profile));
        azure = sandbox.createStubInstance(AccountDatabaseHubAzureLookup);
        azure.accounts.resolves(["account"]);
        azure.azureSqlServerId.resolves(undefined);
        azure.managedInstanceId.resolves(undefined);
        azure.sqlVirtualMachineId.resolves(undefined);
        fabric = sandbox.createStubInstance(FabricApiDatabaseHubLookup);
        fabric.sqlDatabaseId.resolves(undefined);
        service = new DatabaseHubService(
            store,
            detector,
            azure,
            fabric,
            async () => undefined,
            liveServerInfo,
            createStubLogger(sandbox),
        );
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    suite("Azure SQL Database", () => {
        test("deep-links with the saved server ID, without an Azure lookup", async () => {
            await open({ server: "srv.database.windows.net", resourceId: serverId }, "orders");

            const url = openedUrl();
            expect(url.searchParams.get("databaseResourceId")).to.equal(
                `${serverId}/databases/orders`,
            );
            expect(filters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "subscription", operator: "in", value: [sub.toLowerCase()] },
            ]);
            expect(azure.accounts).to.not.have.been.called;
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    connectionInfo: { authenticationType: undefined },
                    additionalProps: {
                        source: "objectExplorer",
                        platform: "azureSqlDatabase",
                        result: "deepLinked",
                    },
                },
            );
        });

        test("looks up the logical server that @@SERVERNAME names behind an alias", async () => {
            azure.azureSqlServerId.withArgs("account", "srv").resolves(serverId);

            await open({ server: "orders.contoso.com", accountId: "account" }, "orders", {
                engineEdition: 5,
                logicalServerName: "srv",
            });

            expect(azure.accounts).to.have.been.calledWith("account");
            expect(openedUrl().searchParams.get("databaseResourceId")).to.equal(
                `${serverId}/databases/orders`,
            );
        });

        test("searches for the database when the server can't be found", async () => {
            await open({ server: "srv.database.windows.net" }, "orders");

            const url = openedUrl();
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(filters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "search", operator: "contains", value: "orders" },
            ]);
        });

        test("tells the user that system databases aren't in the Hub", async () => {
            await open({ server: "srv.database.windows.net" }, "master");

            expect(openExternal).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledWith(
                LocalizedConstants.Azure.systemDatabaseNotInFabricDatabaseHub("master"),
            );
        });
    });

    test("deep-links a managed instance, from any of its databases", async () => {
        azure.managedInstanceId.withArgs("account", "mi").resolves(instanceId);

        await open({ server: "mi.zone.database.windows.net" }, "master");

        const url = openedUrl();
        expect(url.searchParams.get("databaseResourceId")).to.equal(instanceId);
        expect(filters(url)).to.deep.equal([
            { key: "resourceType", operator: "in", value: ["AzureSqlManagedInstance"] },
            { key: "subscription", operator: "in", value: [sub.toLowerCase()] },
        ]);
    });

    suite("Fabric SQL database", () => {
        test("deep-links with the GUID at the end of the database name, in its ring", async () => {
            await open(
                { server: "x.msit-database.fabric.microsoft.com" },
                `Orders-${fabricItemId}`,
            );

            const url = openedUrl();
            expect(url.origin).to.equal("https://msit.fabric.microsoft.com");
            expect(url.searchParams.get("databaseResourceId")).to.equal(fabricItemId);
            expect(filters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["FabricSql"] },
            ]);
        });

        test("finds the item in the workspace that the host encodes", async () => {
            fabric.sqlDatabaseId
                .withArgs("0d373898-c2da-4729-ac46-80c1ef8ed940", "Orders", "tenant")
                .resolves(fabricItemId);

            await open(
                {
                    server: "bu3trggc3jdstlcgqda67dwzia-abcdefghijklmnopqrstuvwxyz.database.fabric.microsoft.com",
                    tenantId: "tenant",
                },
                "Orders",
            );

            expect(openedUrl().searchParams.get("databaseResourceId")).to.equal(fabricItemId);
        });
    });

    suite("SQL Server", () => {
        test("deep-links with the Arc resource ID", async () => {
            await open({ server: "box01" }, undefined, {
                engineEdition: 3,
                arc: { state: "registered", resourceId: arcId, onAzureVm: false },
            });

            const url = openedUrl();
            expect(url.searchParams.get("databaseResourceId")).to.equal(arcId);
            expect(filters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["ArcSqlServer", "AzureSqlVM"] },
                { key: "subscription", operator: "in", value: [sub.toLowerCase()] },
            ]);
        });

        test("deep-links an Azure VM's SQL virtual machine when Arc has no ID", async () => {
            azure.sqlVirtualMachineId.withArgs("account", "vm01").resolves(vmId);

            await open({ server: "vm01.contoso.com" }, undefined, {
                engineEdition: 2,
                machineName: "vm01",
                arc: { state: "notRegistered" },
            });

            const url = openedUrl();
            expect(url.searchParams.get("databaseResourceId")).to.equal(vmId);
            expect(filters(url)).to.deep.include({
                key: "resourceType",
                operator: "in",
                value: ["AzureSqlVM"],
            });
        });

        test("offers to connect a local server to Arc, or open the whole estate", async () => {
            showInformationMessage.resolves(LocalizedConstants.DatabaseHub.openDatabaseHub);

            await open({ server: "localhost" }, undefined, {
                engineEdition: 4,
                machineName: "devbox",
                arc: { state: "notRegistered" },
            });

            expect(azure.sqlVirtualMachineId).to.not.have.been.called;
            expect(showInformationMessage).to.have.been.calledWith(
                LocalizedConstants.DatabaseHub.arcNotRegistered("devbox"),
            );
            const url = openedUrl();
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(filters(url)).to.deep.equal([]);
        });

        test("opens Microsoft Learn from the Arc prompt", async () => {
            showInformationMessage.resolves(LocalizedConstants.DatabaseHub.learnHowToConnectToArc);

            await open({ server: "localhost" }, undefined, { arc: { state: "notRegistered" } });

            expect(openExternal.lastCall.args[0].toString()).to.equal(
                vscode.Uri.parse(connectToArcLearnMoreUrl).toString(),
            );
        });

        test("searches by machine name when the login can't read the Arc table", async () => {
            await open({ server: "box01.contoso.com" }, undefined, {
                engineEdition: 3,
                machineName: "BOX01",
                arc: { state: "unknown" },
            });

            expect(filters(openedUrl())).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["ArcSqlServer", "AzureSqlVM"] },
                { key: "search", operator: "contains", value: "BOX01" },
            ]);
        });
    });

    test("doesn't open the Hub for a container", async () => {
        await open({ server: "localhost,1433", containerName: "sql1" }, "db");

        expect(openExternal).to.not.have.been.called;
        expect(showInformationMessage).to.have.been.calledWith(
            LocalizedConstants.DatabaseHub.notInDatabaseHub,
        );
    });

    suite("telemetry", () => {
        const serverInfo = {
            isCloud: true,
            serverVersion: "12.0.2000.8",
            serverEdition: "SQL Azure",
            engineEditionId: 5,
        };

        test("sends the server info of the open connection", async () => {
            liveServerInfo.returns(serverInfo);

            await open(
                {
                    server: "srv.database.windows.net",
                    resourceId: serverId,
                    authenticationType: "AzureMFA",
                },
                "orders",
            );

            expect(sendActionEvent).to.have.been.calledWithMatch(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    connectionInfo: { authenticationType: "AzureMFA" },
                    serverInfo,
                },
            );
        });

        test("sends the server info saved from an earlier connection", async () => {
            await open({ server: "box01" }, undefined, {
                engineEdition: 3,
                serverVersion: "16.0.4135.4",
                serverEdition: "Enterprise Edition (64-bit)",
                isCloud: false,
                arc: { state: "registered", resourceId: arcId, onAzureVm: false },
            });

            expect(sendActionEvent).to.have.been.calledWithMatch(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                {
                    serverInfo: {
                        isCloud: false,
                        serverVersion: "16.0.4135.4",
                        serverEdition: "Enterprise Edition (64-bit)",
                        engineEditionId: 3,
                    },
                },
            );
        });

        test("sends the engine edition of resources from the Azure and Fabric views", async () => {
            await service.open(
                requestFor({ subscription: { subscriptionId: sub } })!,
                DatabaseHubSource.AzureResources,
            );

            expect(sendActionEvent).to.have.been.calledWithMatch(
                TelemetryViews.FabricDatabaseHub,
                TelemetryActions.Open,
                { serverInfo: { isCloud: true, engineEditionId: 5 } },
            );
        });
    });

    suite("tree nodes of other extensions", () => {
        const resourceNode = (resource: { id?: string }): Wrapper => {
            const item: AzureResourceItem = { resource: resource as AzureResource };
            return { unwrap: <T>() => item as T };
        };

        test("deep-links an Azure Resources database by its ARM ID", async () => {
            const database = mockAzureResources.azureSqlDbDatabase2;

            await service.open(
                requestFor(resourceNode(database))!,
                DatabaseHubSource.AzureResources,
            );

            const url = openedUrl();
            expect(url.searchParams.get("databaseResourceId")).to.equal(database.id);
            expect(filters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                {
                    key: "subscription",
                    operator: "in",
                    value: [mockSubscriptions[0].subscriptionId.toLowerCase()],
                },
            ]);
        });

        test("filters to a subscription for the SQL databases folder", async () => {
            await service.open(
                requestFor({ subscription: { subscriptionId: sub } })!,
                DatabaseHubSource.AzureResources,
            );

            const url = openedUrl();
            expect(url.searchParams.has("databaseResourceId")).to.be.false;
            expect(filters(url)).to.deep.equal([
                { key: "resourceType", operator: "in", value: ["AzureSql"] },
                { key: "subscription", operator: "in", value: [sub.toLowerCase()] },
            ]);
        });

        test("deep-links a Fabric workspace SQL database by its item ID", async () => {
            const node: FabricWorkspaceItemNode = {
                artifact: {
                    id: fabricItemId,
                    type: SqlArtifactTypes.SqlDatabase,
                    displayName: "Orders",
                    description: undefined,
                    workspaceId: "workspace",
                    fabricEnvironment: "DAILY",
                },
            };

            await service.open(requestFor(node)!, DatabaseHubSource.FabricWorkspace);

            const url = openedUrl();
            expect(url.origin).to.equal("https://daily.fabric.microsoft.com");
            expect(url.searchParams.get("databaseResourceId")).to.equal(fabricItemId);
        });

        test("has nothing to open for other nodes", () => {
            expect(requestFor(undefined)).to.be.undefined;
            expect(
                requestFor({
                    artifact: { type: SqlArtifactTypes.Warehouse },
                } as FabricWorkspaceItemNode),
            ).to.be.undefined;
        });
    });
});
