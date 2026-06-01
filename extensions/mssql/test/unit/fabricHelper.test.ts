/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import sinonChai from "sinon-chai";
import { AxiosResponse } from "axios";
import { FabricHelper } from "../../src/fabric/fabricHelper";
import { HttpClient } from "../../src/http/httpClient";
import {
    ICapacity,
    IFabricError,
    ICapacityState,
    IWorkspace,
    ISqlDbArtifact,
    ISqlEndpointArtifact,
    IWarehouseArtifact,
} from "../../src/sharedInterfaces/fabric";
import { getErrorMessage } from "../../src/utils/utils";

chai.use(sinonChai);

suite("FabricHelper", () => {
    let sandbox: sinon.SinonSandbox;
    let mockHttpHelper: sinon.SinonStubbedInstance<HttpClient>;

    const mockTenantId = "test-tenant-id";

    const mockCapacities: ICapacity[] = [
        {
            id: "capacity-1",
            displayName: "Test Capacity 1",
            region: "East US",
            sku: "F2",
            state: ICapacityState.Active,
        },
        {
            id: "capacity-2",
            displayName: "Test Capacity 2",
            region: "West US",
            sku: "F4",
            state: ICapacityState.Active,
        },
    ];

    const mockAuthSession: vscode.AuthenticationSession = {
        id: "test-session-id",
        accessToken: "test-access-token",
        account: {
            id: "test-account-id",
            label: "test-account-label",
        },
        scopes: ["https://analysis.windows.net/powerbi/api/.default"],
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        mockHttpHelper = sandbox.createStubInstance(HttpClient);

        sandbox
            .stub(HttpClient.prototype, "makeGetRequest")
            .callsFake(mockHttpHelper.makeGetRequest);

        sandbox.stub(vscode.authentication, "getSession").resolves(mockAuthSession);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("getFabricCapacities", () => {
        test("should return list of capacities", async () => {
            const mockResponse = { value: mockCapacities };
            mockHttpHelper.makeGetRequest.resolves({
                data: mockResponse,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse<{ value: ICapacity[] }>["config"],
            } as AxiosResponse<{ value: ICapacity[] }>);

            const result = await FabricHelper.getFabricCapacities(mockTenantId);

            expect(result).to.deep.equal(mockCapacities);
            expect(mockHttpHelper.makeGetRequest).to.have.been.calledOnceWith(
                "https://api.fabric.microsoft.com/v1/capacities",
                "test-access-token",
            );
        });

        test("should throw error when API returns Fabric error", async () => {
            const fabricError: IFabricError = {
                errorCode: "CapacityNotFound",
                message: "Capacity not found",
            };
            mockHttpHelper.makeGetRequest.resolves({
                data: fabricError,
                status: 404,
                statusText: "Not Found",
                headers: {},
                config: {} as AxiosResponse<IFabricError>["config"],
            } as AxiosResponse<IFabricError>);

            try {
                await FabricHelper.getFabricCapacities(mockTenantId);
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect(getErrorMessage(error)).to.contain(
                    "Fabric API error occurred (CapacityNotFound): Capacity not found",
                );
            }
        });
    });

    suite("Getters", () => {
        test("getFabricWorkspaces", async () => {
            const capacityId = "capacity-1";
            const mockWorkspaces: IWorkspace[] = [
                {
                    id: "workspace-1",
                    displayName: "Test Workspace 1",
                    description: "Test workspace description",
                    type: "Workspace",
                    capacityId,
                    databases: ["db1"],
                    sqlAnalyticsEndpoints: ["endpoint1"],
                    workspace: {
                        name: "Test Workspace 1",
                        id: "workspace-1",
                    },
                },
                {
                    id: "workspace-2",
                    displayName: "Test Workspace 2",
                    description: "Another test workspace",
                    type: "Workspace",
                    capacityId,
                    databases: ["db2"],
                    sqlAnalyticsEndpoints: ["endpoint2"],
                    workspace: {
                        name: "Test Workspace 2",
                        id: "workspace-2",
                    },
                },
            ];

            const mockResponse = { value: mockWorkspaces };
            mockHttpHelper.makeGetRequest.resolves({
                data: mockResponse,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse<{ value: IWorkspace[] }>["config"],
            } as AxiosResponse<{ value: IWorkspace[] }>);

            const result = await FabricHelper.getFabricWorkspaces(capacityId);

            expect(result).to.deep.equal(mockWorkspaces);
            expect(mockHttpHelper.makeGetRequest).to.have.been.calledOnceWith(
                "https://api.fabric.microsoft.com/v1/workspaces",
                "test-access-token",
            );
        });

        test("getWorkspace", async () => {
            const capacityId = "capacity-1";
            const mockWorkspace: IWorkspace = {
                id: "workspace-1",
                displayName: "Test Workspace 1",
                description: "Test workspace description",
                type: "Workspace",
                capacityId,
                databases: ["db1"],
                sqlAnalyticsEndpoints: ["endpoint1"],
                workspace: {
                    name: "Test Workspace 1",
                    id: "workspace-1",
                },
            };

            const mockResponse = { value: mockWorkspace };
            mockHttpHelper.makeGetRequest.resolves({
                data: mockResponse,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse<{ value: IWorkspace }>["config"],
            } as AxiosResponse<{ value: IWorkspace }>);

            const result = await FabricHelper.getFabricWorkspace("workspace-1", "mock-tenant-id");

            expect(result).to.deep.equal({ value: mockWorkspace });
            expect(mockHttpHelper.makeGetRequest).to.have.been.calledOnceWith(
                "https://api.fabric.microsoft.com/v1/workspaces/workspace-1",
                "test-access-token",
            );
        });

        test("getFabricDatabases", async () => {
            const mockDatabases: ISqlDbArtifact[] = [
                {
                    id: "fabric-sqldb-1",
                    displayName: "Test SQL Db",
                    description: "Test sqldb description",
                    type: "SQLDatabase",
                    properties: {
                        connectionInfo: "someConnInfo",
                        connectionString: "someConnString",
                        databaseName: "testDbName",
                        serverFqdn: "testDbName.database.fabric.net",
                    },
                    workspaceId: "test-workspace-id",
                },
            ];

            const mockResponse = { value: mockDatabases };
            mockHttpHelper.makeGetRequest.resolves({
                data: mockResponse,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse<{ value: ISqlDbArtifact[] }>["config"],
            } as AxiosResponse<{ value: ISqlDbArtifact[] }>);

            const result = await FabricHelper.getFabricDatabases(
                { displayName: "Test Workspace", id: "test-workspace-id" } as IWorkspace,
                "mock-tenant-id",
            );

            expect(result).to.deep.equal([
                {
                    id: "fabric-sqldb-1",
                    server: "testDbName.database.fabric.net",
                    displayName: "Test SQL Db",
                    databases: ["testDbName"],
                    collectionId: "test-workspace-id",
                    collectionName: "Test Workspace",
                    tenantId: "mock-tenant-id",
                    type: "SQLDatabase",
                },
            ]);
            expect(mockHttpHelper.makeGetRequest).to.have.been.calledOnceWith(
                "https://api.fabric.microsoft.com/v1/workspaces/test-workspace-id/sqlDatabases",
                "test-access-token",
            );
        });

        test("getFabricSqlEndpoints", async () => {
            const mockDatabases: ISqlEndpointArtifact[] = [
                {
                    id: "fabric-sqlendpoint-1",
                    displayName: "Test SQL Endpoint",
                    description: "Test sql endpoint description",
                    type: "SQLEndpoint",
                    properties: {},
                    workspaceId: "test-workspace-id",
                },
            ];

            const mockResponse = { value: mockDatabases };
            mockHttpHelper.makeGetRequest.resolves({
                data: mockResponse,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse<{ value: ISqlEndpointArtifact[] }>["config"],
            } as AxiosResponse<{ value: ISqlEndpointArtifact[] }>);

            const result = await FabricHelper.getFabricSqlEndpoints(
                { displayName: "Test Workspace", id: "test-workspace-id" } as IWorkspace,
                "mock-tenant-id",
            );

            expect(result).to.deep.equal([
                {
                    id: "fabric-sqlendpoint-1",
                    server: undefined,
                    displayName: "Test SQL Endpoint",
                    databases: [],
                    collectionId: "test-workspace-id",
                    collectionName: "Test Workspace",
                    tenantId: "mock-tenant-id",
                    type: "SQLEndpoint",
                },
            ]);
            expect(mockHttpHelper.makeGetRequest).to.have.been.calledOnceWith(
                "https://api.fabric.microsoft.com/v1/workspaces/test-workspace-id/sqlEndpoints",
                "test-access-token",
            );
        });

        test("getFabricWarehouses", async () => {
            const mockWarehouses: IWarehouseArtifact[] = [
                {
                    id: "fabric-warehouse-1",
                    displayName: "Test Warehouse",
                    description: "Test warehouse description",
                    type: "Warehouse",
                    properties: {
                        connectionString: "testwarehouse.datawarehouse.fabric.microsoft.com",
                        createdDate: "2023-09-28T22:52:13.78",
                        lastUpdatedTime: "2023-10-04T22:56:33.283",
                        collationType: "Latin1_General_100_CI_AS_KS_WS_SC_UTF8",
                    },
                    workspaceId: "test-workspace-id",
                },
            ];

            const mockResponse = { value: mockWarehouses };
            mockHttpHelper.makeGetRequest.resolves({
                data: mockResponse,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse<{ value: IWarehouseArtifact[] }>["config"],
            } as AxiosResponse<{ value: IWarehouseArtifact[] }>);

            const result = await FabricHelper.getFabricWarehouses(
                { displayName: "Test Workspace", id: "test-workspace-id" } as IWorkspace,
                "mock-tenant-id",
            );

            expect(result).to.deep.equal([
                {
                    id: "fabric-warehouse-1",
                    server: "testwarehouse.datawarehouse.fabric.microsoft.com",
                    displayName: "Test Warehouse",
                    databases: [],
                    collectionId: "test-workspace-id",
                    collectionName: "Test Workspace",
                    tenantId: "mock-tenant-id",
                    type: "Warehouse",
                },
            ]);
            expect(mockHttpHelper.makeGetRequest).to.have.been.calledOnceWith(
                "https://api.fabric.microsoft.com/v1/workspaces/test-workspace-id/warehouses",
                "test-access-token",
            );
        });

        test("should throw error when API returns Fabric error", async () => {
            const capacityId = "capacity-1";
            const fabricError: IFabricError = {
                errorCode: "CapacityNotFound",
                message: "Capacity not found",
            };

            mockHttpHelper.makeGetRequest.resolves({
                data: fabricError,
                status: 404,
                statusText: "Not Found",
                headers: {},
                config: {} as AxiosResponse<IFabricError>["config"],
            } as AxiosResponse<IFabricError>);

            try {
                await FabricHelper.getFabricWorkspaces(capacityId);
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect(getErrorMessage(error)).to.contain(
                    "Fabric API error occurred (CapacityNotFound): Capacity not found",
                );
            }
        });
    });
});
