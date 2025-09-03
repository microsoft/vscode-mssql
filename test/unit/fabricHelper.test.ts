/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { AxiosResponse } from "axios";
import { FabricHelper } from "../../src/fabric/fabricHelper";
import { HttpHelper } from "../../src/http/httpHelper";
import {
    ICapacity,
    IFabricError,
    ICapacityState,
    IWorkspace,
} from "../../src/sharedInterfaces/fabric";

suite("FabricHelper", () => {
    let sandbox: sinon.SinonSandbox;
    let mockHttpHelper: sinon.SinonStubbedInstance<HttpHelper>;

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
        mockHttpHelper = sandbox.createStubInstance(HttpHelper);

        // Mock the HttpHelper constructor to return our stubbed instance
        sandbox
            .stub(HttpHelper.prototype, "makeGetRequest")
            .callsFake(mockHttpHelper.makeGetRequest);

        // Mock vscode authentication
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
            expect(mockHttpHelper.makeGetRequest.calledOnce).to.be.true;
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
            } catch (error: unknown) {
                expect((error as Error).message).to.contain(
                    "Fabric API error occurred (CapacityNotFound): Capacity not found",
                );
            }
        });
    });

    suite("getFabricWorkspaces", () => {
        test("should return list of workspaces", async () => {
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
            expect(mockHttpHelper.makeGetRequest.calledOnce).to.be.true;
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
            } catch (error: unknown) {
                expect((error as Error).message).to.contain(
                    "Fabric API error occurred (CapacityNotFound): Capacity not found",
                );
            }
        });
    });
});
