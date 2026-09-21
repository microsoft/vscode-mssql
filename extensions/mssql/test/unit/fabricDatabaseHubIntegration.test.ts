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

import { FabricDatabaseHubIntegration } from "../../src/integration/fabricDatabaseHubIntegration";
import { mockAzureResources } from "./azureHelperStubs";
import { SqlArtifactTypes } from "../../src/sharedInterfaces/fabric";
import { createStubLogger, stubTelemetry } from "./utils";
import {
    AzureResourceItem,
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

    setup(() => {
        sandbox = sinon.createSandbox();
        openExternal = sandbox.stub(vscode.env, "openExternal").resolves(true);
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
