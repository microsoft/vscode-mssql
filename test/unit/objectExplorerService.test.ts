/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import {
    CreateSessionResult,
    ObjectExplorerService,
} from "../../src/objectExplorer/objectExplorerService";
import { expect } from "chai";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Logger } from "../../src/models/logger";
import { ConnectionStore } from "../../src/models/connectionStore";
import {
    IConnectionProfile,
    IConnectionProfileWithSource,
    IConnectionGroup,
} from "../../src/models/interfaces";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { CloseSessionRequest } from "../../src/models/contracts/objectExplorer/closeSessionRequest";
import { Deferred } from "../../src/protocol";
import { ExpandRequest } from "../../src/models/contracts/objectExplorer/expandNodeRequest";
import {
    ActivityObject,
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../../src/sharedInterfaces/telemetry";
import * as telemetry from "../../src/telemetry/telemetry";
import { RefreshRequest } from "../../src/models/contracts/objectExplorer/refreshSessionRequest";
import { ExpandErrorNode } from "../../src/objectExplorer/nodes/expandErrorNode";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { IAccount, IConnectionInfo, IServerInfo } from "vscode-mssql";
import { ConnectionUI } from "../../src/views/connectionUI";
import * as Utils from "../../src/models/utils";
import * as Constants from "../../src/constants/constants";
import { AccountStore } from "../../src/azure/accountStore";
import { AzureController } from "../../src/azure/azureController";
import {
    CreateSessionRequest,
    CreateSessionResponse,
    SessionCreatedParameters,
} from "../../src/models/contracts/objectExplorer/createSessionRequest";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";
import * as DockerUtils from "../../src/deployment/dockerUtils";
import { FirewallService } from "../../src/firewall/firewallService";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
// import providerSettings from "../../src/azure/providerSettings"; // unused
import {
    GetSessionIdRequest,
    GetSessionIdResponse,
} from "../../src/models/contracts/objectExplorer/getSessionIdRequest";
import { generateUUID } from "../e2e/baseFixtures";
import { ConnectionGroupNode } from "../../src/objectExplorer/nodes/connectionGroupNode";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { initializeIconUtils } from "./utils";

suite("OE Service Tests", () => {
    suite("rootNodeConnections", () => {
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let objectExplorerService: ObjectExplorerService;
        let sandbox: sinon.SinonSandbox;

        setup(() => {
            initializeIconUtils();
            sandbox = sinon.createSandbox();
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);

            sandbox.stub(mockConnectionStore, "rootGroupId").get(() => TEST_ROOT_GROUP_ID);

            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionManager.client = mockClient;

            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("rootNodeConnections should return empty array when no root nodes exist", () => {
            // Set up root with no children
            setUpOETreeRoot(objectExplorerService, []);

            // Call the getter
            const result = objectExplorerService.connections;

            // Verify the result is an empty array
            expect(result, "Result should be an empty array").to.be.an("array").that.is.empty;
        });

        test("rootNodeConnections should return connection profiles from root nodes", () => {
            // Create mock connection profiles
            const mockProfiles: IConnectionProfileWithSource[] = [
                {
                    id: "conn1",
                    server: "server1",
                    database: "db1",
                    authenticationType: "Integrated",
                    user: "",
                    password: "",
                    savePassword: false,
                    groupId: TEST_ROOT_GROUP_ID,
                } as IConnectionProfileWithSource,
                {
                    id: "conn2",
                    server: "server2",
                    database: "db1",
                    authenticationType: "Integrated",
                    user: "",
                    password: "",
                    savePassword: false,
                    groupId: TEST_ROOT_GROUP_ID,
                } as IConnectionProfileWithSource,
            ];

            setUpOETreeRoot(objectExplorerService, mockProfiles);

            // Call the getter
            const result = objectExplorerService.connections;

            // Verify the result
            expect(result, "Result should be an array with length 2")
                .to.be.an("array")
                .with.lengthOf(2);
            expect(result[0], "First result should match mock profile 0").to.deep.equal(
                mockProfiles[0],
            );
            expect(result[1], "Second result should match mock profile 1").to.deep.equal(
                mockProfiles[1],
            );
        });

        test("_rootTreeNodeArray should contain correct hierarchy of groups and connections", () => {
            const topLevelGroups = createMockConnectionGroups(2); // two top-level groups under root
            const subGroups = createMockConnectionGroups(2, topLevelGroups[0].id); // two subgroups under the first top-level group

            const allGroups = [...topLevelGroups, ...subGroups];

            const rootConnections = createMockConnectionProfiles(1);

            // Create mock connections:
            const connections = [
                ...rootConnections, // 1 directly under root
                ...createMockConnectionProfiles(2, topLevelGroups[0].id), // 2 under group0
                ...createMockConnectionProfiles(1, topLevelGroups[1].id), // 1 under group1
                ...createMockConnectionProfiles(2, subGroups[0].id), // 2 under subgroup0
            ];

            setUpOETreeRoot(objectExplorerService, connections, allGroups);

            const rootTreeNodeArray: Array<ConnectionNode | ConnectionGroupNode> = (
                objectExplorerService as any
            )._rootTreeNodeArray;

            expect(
                rootTreeNodeArray.length,
                "Root tree node array should only contain the root nodes",
            ).to.equal(3);

            const rootLevelNodes = {
                groups: rootTreeNodeArray.filter((node) => node instanceof ConnectionGroupNode),
                connections: rootTreeNodeArray.filter((node) => node instanceof ConnectionNode),
            };

            // Verify the root level groups are the ones we created
            const rootGroupIds = rootLevelNodes.groups.map(
                (node) => (node as ConnectionGroupNode).connectionGroup.id,
            );
            expect(rootGroupIds).to.have.members([topLevelGroups[0].id, topLevelGroups[1].id]);

            // Verify the root level connection is the one we created
            const rootConnection = rootLevelNodes.connections[0] as ConnectionNode;
            expect(rootConnection.connectionProfile.id).to.equal(rootConnections[0].id);
        });
    });

    suite("expandNode", () => {
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let objectExplorerService: ObjectExplorerService;
        let sandbox: sinon.SinonSandbox;
        let endStub: sinon.SinonStub;
        let endFailedStub: sinon.SinonStub;
        let startActivityStub: sinon.SinonStub;
        let mockLogger: sinon.SinonStubbedInstance<Logger>;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionManager.client = mockClient;
            endStub = sandbox.stub();
            endFailedStub = sandbox.stub();
            startActivityStub = sandbox.stub(telemetry, "startActivity").returns({
                end: endStub,
                endFailed: endFailedStub,
                correlationId: "",
                startTime: 0,
                update: sandbox.stub(),
            });
            // Mock the Logger.create static method
            mockLogger = sandbox.createStubInstance(Logger);
            sandbox.stub(Logger, "create").returns(mockLogger);
            mockLogger.verbose = sandbox.stub();
            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("expandNode should handle standard node expansion successfully", async () => {
            // Mock node and session ID
            const mockNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "server",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );

            const mockSessionId = "session123";
            const mockPromise = new Deferred<vscode.TreeItem[]>();

            // Setup child nodes that will be returned
            const mockChildNodes = [
                {
                    nodePath: "server/testNode/child1",
                    nodeType: "table",
                    nodeSubType: "",
                    label: "child1",
                },
                {
                    nodePath: "server/testNode/child2",
                    nodeType: "table",
                    nodeSubType: "",
                    label: "child2",
                },
            ];

            // Mock the expected expand response
            const mockExpandResponse = {
                sessionId: mockSessionId,
                nodes: mockChildNodes,
                errorMessage: "",
            };

            // Setup client to return true for the expand request
            mockClient.sendRequest.withArgs(ExpandRequest.type, sinon.match.any).resolves(true);

            // Call the method to test
            const expandPromise = objectExplorerService.expandNode(
                mockNode,
                mockSessionId,
                mockPromise,
            );

            // Wait a bit and then resolve the pending expand with our mock response
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get and resolve the deferred object from _pendingExpands
            const pendingExpandKey = `${mockSessionId}${mockNode.nodePath}`;
            const pendingExpand = (objectExplorerService as any)._pendingExpands.get(
                pendingExpandKey,
            );
            expect(pendingExpand, "Pending expand should exist").to.exist;
            pendingExpand.resolve(mockExpandResponse);

            // Wait for the expandNode promise to resolve
            const result = await expandPromise;

            // Verify the result
            expect(result, "Expand node should return true").to.be.true;

            // Verify telemetry was started correctly
            expect(startActivityStub.calledOnce, "Telemetry should be started once").to.be.true;
            expect(
                startActivityStub.args[0][0],
                "Telemetry view should be ObjectExplorer",
            ).to.equal(TelemetryViews.ObjectExplorer);
            expect(startActivityStub.args[0][1], "Telemetry action should be ExpandNode").to.equal(
                TelemetryActions.ExpandNode,
            );

            // Verify logging
            expect(mockLogger.verbose.called, "Logger should be called once for verbose").to.be
                .true;

            // Verify the request was sent correctly
            expect(mockClient.sendRequest.calledOnce, "Send request should be called once").to.be
                .true;
            expect(
                mockClient.sendRequest.args[0][0],
                "Request type should be ExpandRequest",
            ).to.equal(ExpandRequest.type);
            expect(mockClient.sendRequest.args[0][1], "Request payload should match").to.deep.equal(
                {
                    sessionId: mockSessionId,
                    nodePath: mockNode.nodePath,
                    filters: mockNode.filters,
                },
            );

            // Verify the children were mapped correctly
            const mappedChildren = (objectExplorerService as any)._treeNodeToChildrenMap.get(
                mockNode,
            );
            expect(mappedChildren, "Mapped children should exist").to.exist;
            expect(mappedChildren.length, "Mapped children length should be 2").to.equal(2);
            expect(mappedChildren[0].label, "First mapped child label should be child1").to.equal(
                "child1",
            );
            expect(mappedChildren[1].label, "Second mapped child label should be child2").to.equal(
                "child2",
            );

            // Verify telemetry was ended correctly
            expect(endStub.calledOnce, "Telemetry should be ended once").to.be.true;
            expect(endStub.args[0][0], "Telemetry status should be Succeeded").to.equal(
                ActivityStatus.Succeeded,
            );
            expect(
                endStub.args[0][2].childrenCount,
                "Telemetry children count should be 2",
            ).to.equal(2);

            // Verify the promise was resolved with the children
            const resolvedChildren = await mockPromise;
            expect(resolvedChildren, "Resolved children should match mapped children").to.equal(
                mappedChildren,
            );

            // Verify shouldRefresh was reset
            expect(mockNode.shouldRefresh, "Node shouldRefresh should be false").to.be.false;
        });

        test("expandNode should use RefreshRequest if node.shouldRefresh is true", async () => {
            // Mock node with shouldRefresh = true and session ID
            const mockNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "server",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );
            mockNode.shouldRefresh = true;
            const mockSessionId = "session123";
            const mockPromise = new Deferred<vscode.TreeItem[]>();

            // Setup child nodes that will be returned
            const mockChildNodes = [
                {
                    nodePath: "server/testNode/child1",
                    nodeType: "table",
                    nodeSubType: "",
                    label: "child1",
                },
            ];

            // Mock the expected refresh response
            const mockRefreshResponse = {
                sessionId: mockSessionId,
                nodes: mockChildNodes,
                errorMessage: "",
            };

            // Setup client to return true for the refresh request
            mockClient.sendRequest.withArgs(RefreshRequest.type, sinon.match.any).resolves(true);

            // Call the method to test
            const expandPromise = objectExplorerService.expandNode(
                mockNode,
                mockSessionId,
                mockPromise,
            );

            // Wait a bit and then resolve the pending expand with our mock response
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get and resolve the deferred object from _pendingExpands
            const pendingExpandKey = `${mockSessionId}${mockNode.nodePath}`;
            const pendingExpand = (objectExplorerService as any)._pendingExpands.get(
                pendingExpandKey,
            );
            expect(pendingExpand, "Pending expand should exist").to.exist;
            pendingExpand.resolve(mockRefreshResponse);

            // Wait for the expandNode promise to resolve
            const result = await expandPromise;

            // Verify the result
            expect(result, "Expand node should return true").to.be.true;

            // Verify the RefreshRequest was used instead of ExpandRequest
            expect(mockClient.sendRequest.calledOnce, "Send request should be called once").to.be
                .true;
            expect(
                mockClient.sendRequest.args[0][0],
                "Request type should be RefreshRequest",
            ).to.equal(RefreshRequest.type);

            // Verify shouldRefresh was reset to false
            expect(mockNode.shouldRefresh, "Node shouldRefresh should be false").to.be.false;
        });

        test("expandNode should handle error response from SQL Tools Service", async () => {
            // Mock node and session ID
            const mockNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "server",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );
            const mockSessionId = "session123";
            const mockPromise = new Deferred<vscode.TreeItem[]>();

            // Mock the error response
            const mockErrorMessage = "Test error from SQL Tools Service";
            const mockExpandResponse = {
                sessionId: mockSessionId,
                nodes: [],
                errorMessage: mockErrorMessage,
            };

            // Setup client to return true for the expand request
            mockClient.sendRequest.withArgs(ExpandRequest.type, sinon.match.any).resolves(true);

            // Call the method to test
            const expandPromise = objectExplorerService.expandNode(
                mockNode,
                mockSessionId,
                mockPromise,
            );

            // Wait a bit and then resolve the pending expand with our error response
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get and resolve the deferred object from _pendingExpands
            const pendingExpandKey = `${mockSessionId}${mockNode.nodePath}`;
            const pendingExpand = (objectExplorerService as any)._pendingExpands.get(
                pendingExpandKey,
            );
            expect(pendingExpand, "Pending expand should exist").to.exist;
            pendingExpand.resolve(mockExpandResponse);

            // Wait for the expandNode promise to resolve
            const result = await expandPromise;

            // Verify the result (should still be true because we received a response)
            expect(result, "Expand node should return true").to.be.true;

            // Verify error was logged
            expect(mockLogger.error.called, "Error should be logged").to.be.true;
            expect(
                mockLogger.error.args[0][0],
                "Error message should include mock error message",
            ).to.include(mockErrorMessage);

            // Verify error message was shown to user
            expect(
                mockVscodeWrapper.showErrorMessage.calledOnce,
                "Error message should be shown to user",
            ).to.be.true;
            expect(
                mockVscodeWrapper.showErrorMessage.args[0][0],
                "Error message should be mock error message",
            ).to.equal(mockErrorMessage);

            // Verify an error node was created and set as the only child
            const mappedChildren = (objectExplorerService as any)._treeNodeToChildrenMap.get(
                mockNode,
            );
            expect(mappedChildren, "Mapped children should exist").to.exist;
            expect(mappedChildren.length, "Mapped children length should be 1").to.equal(1);
            expect(
                mappedChildren[0],
                "First mapped child should be an ExpandErrorNode",
            ).to.be.instanceOf(ExpandErrorNode);
            expect(
                (mappedChildren[0] as ExpandErrorNode).tooltip,
                "First mapped child tooltip should be mock error message",
            ).to.equal(mockErrorMessage);

            // Verify telemetry was ended with failure
            expect(endFailedStub.calledOnce, "Telemetry should be ended with failure").to.be.true;
            expect(
                endFailedStub.args[0][0].message,
                "Telemetry message should be mock error message",
            ).to.equal(mockErrorMessage);

            // Verify the promise was resolved with the error node
            const resolvedChildren = await mockPromise;
            expect(
                resolvedChildren[0],
                "Resolved child should be an ExpandErrorNode",
            ).to.be.instanceOf(ExpandErrorNode);
            expect(
                (resolvedChildren[0] as ExpandErrorNode).tooltip,
                "Resolved child tooltip should be mock error message",
            ).to.equal(mockErrorMessage);
        });

        test("expandNode should handle null response from SQL Tools Service", async () => {
            // Mock node and session ID
            const mockNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "server",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );
            const mockSessionId = "session123";
            const mockPromise = new Deferred<vscode.TreeItem[]>();

            // Setup client to return true for the expand request
            mockClient.sendRequest.withArgs(ExpandRequest.type, sinon.match.any).resolves(true);

            // Call the method to test
            const expandPromise = objectExplorerService.expandNode(
                mockNode,
                mockSessionId,
                mockPromise,
            );

            // Wait a bit and then resolve the pending expand with null
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get and resolve the deferred object from _pendingExpands
            const pendingExpandKey = `${mockSessionId}${mockNode.nodePath}`;
            const pendingExpand = (objectExplorerService as any)._pendingExpands.get(
                pendingExpandKey,
            );
            expect(pendingExpand, "Pending expand should exist").to.exist;
            pendingExpand.resolve(undefined);

            // Wait for the expandNode promise to resolve
            const result = await expandPromise;

            // Verify the result (should be undefined)
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify the promise was resolved with undefined
            const resolvedChildren = await mockPromise;
            expect(resolvedChildren, "Resolved children should be undefined").to.be.undefined;
        });

        test("expandNode should handle false response from SQL Tools client", async () => {
            // Mock node and session ID
            const mockNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "server",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );
            const mockSessionId = "session123";
            const mockPromise = new Deferred<vscode.TreeItem[]>();

            // Setup client to return false for the expand request (indicates failure)
            mockClient.sendRequest.withArgs(ExpandRequest.type, sinon.match.any).resolves(false);

            // Call the method to test
            const result = await objectExplorerService.expandNode(
                mockNode,
                mockSessionId,
                mockPromise,
            );

            // Verify the result (should be undefined)
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify error message was shown to user
            expect(
                mockVscodeWrapper.showErrorMessage.calledOnce,
                "Error message should be shown to user",
            ).to.be.true;
            expect(
                mockVscodeWrapper.showErrorMessage.args[0][0],
                "Error message should be mock error message",
            ).to.equal(LocalizedConstants.msgUnableToExpand);

            // Verify the promise was resolved with undefined
            const resolvedChildren = await mockPromise;
            expect(resolvedChildren, "Resolved children should be undefined").to.be.undefined;
        });

        test("expandNode should handle exception from SQL Tools client", async () => {
            // Mock node and session ID
            const mockNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "server",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );
            const mockSessionId = "session123";
            const mockPromise = new Deferred<vscode.TreeItem[]>();

            // Setup client to throw an error
            const testError = new Error("Test client error");
            mockClient.sendRequest.withArgs(ExpandRequest.type, sinon.match.any).rejects(testError);
            0;

            try {
                // Call the method to test
                await objectExplorerService.expandNode(mockNode, mockSessionId, mockPromise);
            } catch (e) {
                expect(e, "Error should be test error").to.equal(testError);
            }
        });
    });

    suite("prepareConnectionProfile", () => {
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let objectExplorerService: ObjectExplorerService;
        let sandbox: sinon.SinonSandbox;
        let sendActionEventStub: sinon.SinonStub;
        let mockGenerateGuidStub: sinon.SinonStub;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
        let mockAzureController: sinon.SinonStubbedInstance<AzureController>;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionManager.client = mockClient;
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
            sandbox.stub(mockConnectionManager, "connectionUI").get(() => mockConnectionUI);
            sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");
            mockAccountStore = sandbox.createStubInstance(AccountStore);
            sandbox.stub(mockConnectionManager, "accountStore").get(() => mockAccountStore);
            mockAzureController = sandbox.createStubInstance(AzureController);
            mockAzureController.isAccountInCache = sandbox.stub();
            mockAzureController.isSqlAuthProviderEnabled = sandbox.stub();
            mockConnectionManager.azureController = mockAzureController;
            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("prepareConnectionProfile should create a new connection profile if none is provided", async () => {
            // Create a mock connection profile that would be returned by the UI
            const mockProfile: IConnectionProfile = {
                id: "existing-id",
                server: "testServer",
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: generateUUID(),
                savePassword: true,
            } as IConnectionProfile;

            // Setup connection UI to return the mock profile
            mockConnectionUI.createAndSaveProfile.resolves(mockProfile);
            mockConnectionManager.getServerInfo.returns({ serverVersion: "12.0.0" } as IServerInfo);
            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with undefined connection info
            const result = await (objectExplorerService as any).prepareConnectionProfile(undefined);

            // Verify the result matches the mock profile
            expect(result, "Result should match mock profile").to.deep.equal(mockProfile);

            // Verify connection UI was called
            expect(
                mockConnectionUI.createAndSaveProfile.calledOnce,
                "Connection UI should be called once",
            ).to.be.true;

            // Verify telemetry was sent
            expect(sendActionEventStub.calledOnce, "Telemetry should be sent once").to.be.true;
            expect(
                sendActionEventStub.args[0][0],
                "Telemetry view should be ObjectExplorer",
            ).to.equal(TelemetryViews.ObjectExplorer);
            expect(
                sendActionEventStub.args[0][1],
                "Telemetry action should be CreateConnection",
            ).to.equal(TelemetryActions.CreateConnection);
        });

        test("prepareConnectionProfile should return undefined if user cancels profile creation", async () => {
            // Setup connection UI to return undefined (user canceled)
            mockConnectionUI.createAndSaveProfile.resolves(undefined);

            // Call the method with undefined connection info
            const result = await (objectExplorerService as any).prepareConnectionProfile(undefined);

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify connection UI was called
            expect(
                mockConnectionUI.createAndSaveProfile.calledOnce,
                "Connection UI should be called once",
            ).to.be.true;
        });

        test("prepareConnectionProfile should generate a GUID if id is missing", async () => {
            mockGenerateGuidStub = sandbox.stub(Utils, "generateGuid").returns("mock-guid-12345");

            // Create a mock connection profile without an ID
            const mockProfile: IConnectionProfile = {
                server: "testServer",
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: generateUUID(),
                savePassword: true,
            } as IConnectionProfile;

            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result has the generated GUID
            expect(result.id, "Result ID should be mock-guid-12345").to.equal("mock-guid-12345");

            // Verify Utils.generateGuid was called
            expect(mockGenerateGuidStub.calledOnce, "Utils.generateGuid should be called once").to
                .be.true;
        });

        test("prepareConnectionProfile should handle connection string with savePassword=true", async () => {
            // Create a mock connection profile with a connection string
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                connectionString: "Server=testServer;Database=testDB;",
                savePassword: true,
            } as IConnectionProfile;

            // Setup connection store to return a connection string with password
            const expectedConnectionString = `Server=testServer;Database=testDB;Password=${generateUUID()};`;
            mockConnectionStore.lookupPassword.resolves(expectedConnectionString);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result has the updated connection string
            expect(
                result.connectionString,
                "Result connection string should match expected",
            ).to.equal(expectedConnectionString);

            // Verify connection store was called with correct parameters
            expect(
                mockConnectionStore.lookupPassword.calledOnce,
                "Connection store should be called once",
            ).to.be.true;
            expect(
                mockConnectionStore.lookupPassword.args[0][0],
                "Connection store should be called with mock profile",
            ).to.equal(mockProfile);
            expect(
                mockConnectionStore.lookupPassword.args[0][1],
                "Connection store should be called with isConnectionString = true",
            ).to.be.true; // isConnectionString = true
        });

        test("prepareConnectionProfile should return undefined for connection string with savePassword=false", async () => {
            // Create a mock connection profile with a connection string but savePassword=false
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                connectionString: "Server=testServer;Database=testDB;",
                savePassword: false,
            } as IConnectionProfile;

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify connection store was NOT called
            expect(
                mockConnectionStore.lookupPassword.called,
                "Connection store should not be called",
            ).to.be.false;
        });

        test("prepareConnectionProfile should proceed if container connection throws when attempting to check container status", async () => {
            // Create a mock SQL Login profile with empty password but savePassword=true
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: "", // Empty password
                savePassword: true,
                containerName: "someContainer",
            } as IConnectionProfile;

            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            const containerStub = sandbox
                .stub(DockerUtils, "restartContainer")
                .throws(new Error("Failed to restart container"));

            // Call the method with the mock profile
            await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

            expect(containerStub.called, "Container restart should be attempted").to.be.true;
        });

        test("prepareConnectionProfile should return undefined if password not handled properly", async () => {
            // Create a mock SQL Login profile with empty password
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: "", // Empty password
                savePassword: false,
            } as IConnectionProfile;

            // Setup connection manager to return false (user canceled)
            mockConnectionManager.handlePasswordBasedCredentials.resolves(false);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;
        });

        test("prepareConnectionProfile should handle Windows Authentication (Integrated)", async () => {
            // Create a mock Integrated authentication profile
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: "Integrated",
                user: "",
                password: "",
                azureAccountToken: "some-token", // This should be cleared
            } as IConnectionProfile;

            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is correct
            expect(result, "Result should exist").to.exist;
            expect(result.id, "Result ID should match").to.equal("test-id");
            expect(result.server, "Result server should match").to.equal("testServer");

            // Verify Azure account token was cleared
            expect(result.azureAccountToken, "Result Azure account token should be undefined").to.be
                .undefined;

            // Verify password lookup and prompts were NOT called
            expect(
                mockConnectionStore.lookupPassword.called,
                "Connection store should not be called",
            ).to.be.false;
            expect(
                mockConnectionUI.promptForPassword.called,
                "Connection UI should not prompt for password",
            ).to.be.false;
        });

        test("prepareConnectionProfile should handle Azure MFA with account in cache", async () => {
            // (objectExplorerService as any).refreshAccount = sandbox.stub(); // Method removed
            // Create a mock account
            const mockAccount = {
                key: { id: "account-id", providerId: "azure" },
                displayInfo: {
                    displayName: "Test User",
                    email: "test@example.com",
                },
            } as IAccount;

            // Create a mock Azure MFA profile
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: Constants.azureMfa,
                accountId: "account-id",
                azureAccountToken: "existing-token",
            } as IConnectionProfile;

            // Setup account store to return the mock account
            mockAccountStore.getAccount.withArgs("account-id").resolves(mockAccount);

            // Setup Azure controller
            mockAzureController.isSqlAuthProviderEnabled.returns(true);
            mockAzureController.isAccountInCache.withArgs(mockAccount).resolves(true);
            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is correct
            expect(result, "Result should exist").to.exist;
            expect(result.id, "Result ID should match").to.equal("test-id");
            expect(result.server, "Result server should match").to.equal("testServer");
            expect(result.user, "Result user should match").to.equal("Test User");
            expect(result.email, "Result email should match").to.equal("test@example.com");
            expect(result.azureAccountToken, "Result Azure account token should match").to.equal(
                "existing-token",
            );

            // Verify account store was called
            expect(mockAccountStore.getAccount.calledOnce, "Account store should be called once").to
                .be.true;

            // Verify Azure controller methods were called
            expect(
                mockAzureController.isSqlAuthProviderEnabled.calledOnce,
                "Azure controller should check SQL auth provider",
            ).to.be.true;
            expect(
                mockAzureController.isAccountInCache.calledOnce,
                "Azure controller should check account in cache",
            ).to.be.true;

            // Verify profile was saved after updating user/email
            expect(
                mockConnectionUI.saveProfile.calledOnce,
                "Connection UI should save profile once",
            ).to.be.true;
            expect(
                mockConnectionUI.saveProfile.args[0][0],
                "Saved profile should match result",
            ).to.equal(result);

            // Verify refreshAccount was NOT called (no refresh needed) - method removed
            // expect(
            //     (objectExplorerService as any).refreshAccount.called,
            //     "Refresh account should not be called",
            // ).to.be.false;
        });

        test("prepareConnectionProfile should refresh account for Azure MFA with account not in cache", async () => {
            // (objectExplorerService as any).refreshAccount = sandbox.stub(); // Method removed

            // Create a mock account
            const mockAccount = {
                key: { id: "account-id", providerId: "azure" },
                displayInfo: {
                    displayName: "Test User",
                    email: "test@example.com",
                },
            } as IAccount;

            // Create a mock Azure MFA profile
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: Constants.azureMfa,
                accountId: "account-id",
                azureAccountToken: undefined, // No token yet
            } as IConnectionProfile;

            // Setup account store to return the mock account
            mockAccountStore.getAccount.withArgs("account-id").resolves(mockAccount);

            // Setup Azure controller - account NOT in cache
            mockAzureController.isSqlAuthProviderEnabled.returns(true);
            mockAzureController.isAccountInCache.withArgs(mockAccount).resolves(false);
            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is correct
            expect(result, "Result should exist").to.exist;
            expect(result.id, "Result ID should match").to.equal("test-id");
            expect(result.server, "Result server should match").to.equal("testServer");
            expect(result.user, "Result user should match").to.equal("Test User");
            expect(result.email, "Result email should match").to.equal("test@example.com");

            // Verify refreshAccount was called since account not in cache - method removed
            // expect(
            //     (objectExplorerService as any).refreshAccount.calledOnce,
            //     "Refresh account should be called once",
            // ).to.be.true;
            // expect(
            //     (objectExplorerService as any).refreshAccount.args[0][0],
            //     "Refresh account should be called with mock account",
            // ).to.equal(mockAccount);
            // expect(
            //     (objectExplorerService as any).refreshAccount.args[0][1],
            //     "Refresh account should be called with result",
            // ).to.equal(result);
        });

        test("prepareConnectionProfile should refresh account for Azure MFA when account not found", async () => {
            // (objectExplorerService as any).refreshAccount = sandbox.stub(); // Method removed

            // Create a mock Azure MFA profile with account ID but no account found
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: Constants.azureMfa,
                accountId: "missing-account-id",
                azureAccountToken: undefined, // No token yet
            } as IConnectionProfile;

            // Setup account store to return undefined (account not found)
            mockAccountStore.getAccount.withArgs("missing-account-id").returns(undefined);

            // Setup Azure controller
            mockAzureController.isSqlAuthProviderEnabled.returns(true);
            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is correct
            expect(result, "Result should exist").to.exist;
            expect(result.id, "Result ID should match").to.equal("test-id");
            expect(result.server, "Result server should match").to.equal("testServer");

            // Verify refreshAccount was called with undefined account - method removed
            // expect(
            //     (objectExplorerService as any).refreshAccount.calledOnce,
            //     "Refresh account should be called once",
            // ).to.be.true;
            // expect(
            //     (objectExplorerService as any).refreshAccount.args[0][0],
            //     "Refresh account should be called with undefined account",
            // ).to.be.undefined;
            // expect(
            //     (objectExplorerService as any).refreshAccount.args[0][1],
            //     "Refresh account should be called with result",
            // ).to.equal(result);
        });

        test("prepareConnectionProfile should handle Azure MFA when SQL auth provider disabled", async () => {
            // (objectExplorerService as any).refreshAccount = sandbox.stub(); // Method removed

            // Create a mock account
            const mockAccount = {
                key: { id: "account-id", providerId: "azure" },
                displayInfo: {
                    displayName: "Test User",
                    email: "test@example.com",
                },
            } as IAccount;

            // Create a mock Azure MFA profile
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: Constants.azureMfa,
                accountId: "account-id",
                azureAccountToken: undefined, // No token yet
            } as IConnectionProfile;

            // Setup account store to return the mock account
            mockAccountStore.getAccount.withArgs("account-id").resolves(mockAccount);

            // Setup Azure controller - SQL auth provider disabled
            mockAzureController.isSqlAuthProviderEnabled.returns(false);
            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is correct
            expect(result, "Result should exist").to.exist;
            expect(result.id, "Result ID should match").to.equal("test-id");
            expect(result.server, "Result server should match").to.equal("testServer");

            // User and email should NOT be set since SQL auth provider is disabled
            expect(result.user, "Result user should be undefined").to.be.undefined;
            expect(result.email, "Result email should be undefined").to.be.undefined;

            // Verify saveProfile was NOT called
            expect(mockConnectionUI.saveProfile.called, "Connection UI should not save profile").to
                .be.false;

            // Verify refreshAccount was called - method removed
            // expect(
            //     (objectExplorerService as any).refreshAccount.calledOnce,
            //     "Refresh account should be called once",
            // ).to.be.true;
        });

        test("prepareConnectionProfile should not refresh Azure MFA account if token exists", async () => {
            // (objectExplorerService as any).refreshAccount = sandbox.stub(); // Method removed
            // Create a mock account
            const mockAccount = {
                key: { id: "account-id", providerId: "azure" },
                displayInfo: {
                    displayName: "Test User",
                    email: "test@example.com",
                },
            } as IAccount;

            // Create a mock Azure MFA profile with an existing token
            const mockProfile: IConnectionProfile = {
                id: "test-id",
                server: "testServer",
                database: "testDB",
                authenticationType: Constants.azureMfa,
                accountId: "account-id",
                azureAccountToken: "existing-token", // Token already exists
            } as IConnectionProfile;

            // Setup account store to return the mock account
            mockAccountStore.getAccount.withArgs("account-id").resolves(mockAccount);

            // Setup Azure controller - SQL auth provider enabled, account in cache
            mockAzureController.isSqlAuthProviderEnabled.returns(true);
            mockAzureController.isAccountInCache.withArgs(mockAccount).resolves(true);
            mockConnectionManager.handlePasswordBasedCredentials.resolves(true);

            // Call the method with the mock profile
            const result = await (objectExplorerService as any).prepareConnectionProfile(
                mockProfile,
            );

            // Verify the result is correct
            expect(result, "Result should exist").to.exist;
            expect(result.id, "Result ID should match").to.equal("test-id");
            expect(result.server, "Result server should match").to.equal("testServer");
            expect(result.azureAccountToken, "Result azure account token should match").to.equal(
                "existing-token",
            );

            // Verify refreshAccount was NOT called since token already exists - method removed
            // expect(
            //     (objectExplorerService as any).refreshAccount.called,
            //     "Refresh account should not be called",
            // ).to.be.false;
        });
    });

    suite("handleSessionCreationFailure", () => {
        let sandbox: sinon.SinonSandbox;
        let mockLogger: sinon.SinonStubbedInstance<Logger>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let mockFirewallService: sinon.SinonStubbedInstance<FirewallService>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let objectExplorerService: ObjectExplorerService;
        let mockActivityObject: ActivityObject;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockLogger = sandbox.createStubInstance(Logger);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
            mockFirewallService = sandbox.createStubInstance(FirewallService);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockAccountStore = sandbox.createStubInstance(AccountStore);

            mockConnectionManager.client = mockClient;
            (mockConnectionManager as any)._connectionUI = mockConnectionUI;
            (mockConnectionManager as any)._firewallService = mockFirewallService;
            (mockConnectionManager as any)._accountStore = mockAccountStore;
            mockActivityObject = {
                correlationId: "test-correlation-id",
                end: sandbox.stub(),
                update: sandbox.stub(),
                endFailed: sandbox.stub(),
                startTime: performance.now(),
            };
            mockLogger = sandbox.createStubInstance(Logger);
            sandbox.stub(Logger, "create").returns(mockLogger);

            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
            (objectExplorerService as any).logger = mockLogger;
            (objectExplorerService as any).connectionUI = mockConnectionUI;
            (objectExplorerService as any).firewallService = mockFirewallService;
        });
        teardown(() => {
            sandbox.restore();
        });

        test("handleSessionCreationFailure should handle basic error without error number", async () => {
            mockVscodeWrapper.showErrorMessage = sandbox.stub();
            // Create a failure response with just an error message
            const failureResponse = createMockFailureResponse({
                errorMessage: "Connection failed",
            });

            const connectionProfile = createMockConnectionProfile();

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                mockActivityObject,
            );

            // Verify the result is false (no retry)
            expect(result, "Result should be false").to.be.false;

            // Verify telemetry was NOT updated (no error number)
            expect(
                (mockActivityObject.update as sinon.SinonStub<any[], any>).called,
                "Telemetry should not be updated",
            ).to.be.false;

            // Verify error was logged
            expect(mockLogger.error.calledOnce, "Error should be logged").to.be.true;
            expect(
                mockLogger.error.args[0][0],
                "Error message should include session creation failed",
            ).to.include("Session creation failed");
            expect(mockLogger.error.args[0][0]).to.include("Connection failed");

            // Verify error message was shown to user
            expect(
                mockVscodeWrapper.showErrorMessage.calledOnce,
                "Error message should be shown to user",
            ).to.be.true;
            expect(
                mockVscodeWrapper.showErrorMessage.args[0][0],
                "Error message should include connection failed",
            ).to.include("Connection failed");
        });

        test("handleSessionCreationFailure should update telemetry when error number is present", async () => {
            // Create a failure response with error number and message
            const failureResponse = createMockFailureResponse({
                errorNumber: 12345,
                errorMessage: "Connection failed",
            });

            const connectionProfile = createMockConnectionProfile({
                authenticationType: "SqlLogin",
            });

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                mockActivityObject,
            );

            // Verify the result is false (no retry)
            expect(result, "Result should be false").to.be.false;

            const updateStub = mockActivityObject.update as sinon.SinonStub<any[], any>;

            // Verify telemetry was updated with error number
            expect(updateStub.calledOnce, "Telemetry should be updated once").to.be.true;
            expect(updateStub.args[0][0].connectionType, "Connection type should match").to.equal(
                "SqlLogin",
            );
            expect(updateStub.args[0][1].errorNumber, "Error number should match").to.equal(12345);
        });

        test("handleSessionCreationFailure should handle SSL certificate validation error", async () => {
            (objectExplorerService as any).getConnectionNodeFromProfile = sandbox.stub();
            // Create a failure response with SSL certificate validation error
            const failureResponse = createMockFailureResponse({
                errorNumber: Constants.errorSSLCertificateValidationFailed,
                errorMessage: "SSL certificate validation failed",
            });

            const connectionProfile = createMockConnectionProfile();
            const updateStub = mockActivityObject.update as sinon.SinonStub<any[], any>;

            // Setup fixed profile from handleSSLError
            const fixedProfile = createMockConnectionProfile();
            fixedProfile.trustServerCertificate = true;

            mockConnectionManager.handleSSLError.resolves(fixedProfile);

            // Set up a mock connection node to be returned for the fixed profile
            const mockConnectionNode = {
                updateConnectionProfile: sandbox.stub(),
            };

            (objectExplorerService as any).getConnectionNodeFromProfile
                .withArgs(fixedProfile)
                .returns(mockConnectionNode);

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                mockActivityObject,
            );

            // Verify the result is true (retry)
            expect(result, "Result should be true").to.be.true;

            // Verify SSL error was handled
            expect(
                mockLogger.verbose.calledWith("Fixing SSL trust server certificate error."),
                "Verbose log should indicate SSL error fix",
            ).to.be.true;
            expect(
                mockConnectionManager.handleSSLError.calledOnce,
                "Handle SSL error should be called once",
            ).to.be.true;
            expect(
                mockConnectionManager.handleSSLError.args[0][0],
                "Connection profile should match",
            ).to.equal(connectionProfile);

            // Verify telemetry was updated for SSL error
            expect(updateStub.calledTwice, "Telemetry should be updated twice").to.be.true;
            expect(
                updateStub.args[1][0].errorHandled,
                "Error handled should be trustServerCertificate",
            ).to.equal("trustServerCertificate");
            expect(updateStub.args[1][0].isFixed, "Is fixed should be true").to.equal("true");

            // Verify connection node was updated
            expect(
                mockConnectionNode.updateConnectionProfile.calledOnce,
                "Connection node should be updated once",
            ).to.be.true;
            expect(
                mockConnectionNode.updateConnectionProfile.args[0][0],
                "Connection profile should match",
            ).to.equal(fixedProfile);
        });

        test("handleSessionCreationFailure should return false if SSL error handling returns no profile", async () => {
            // Create a failure response with SSL certificate validation error
            const failureResponse = createMockFailureResponse({
                errorNumber: Constants.errorSSLCertificateValidationFailed,
                errorMessage: "SSL certificate validation failed",
            });

            const connectionProfile = createMockConnectionProfile();
            const telemetryActivity = mockActivityObject;
            const updateStub = telemetryActivity.update as sinon.SinonStub<any[], any>;

            // Setup handleSSLError to return undefined (user canceled)
            mockConnectionManager.handleSSLError.resolves(undefined);

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                telemetryActivity,
            );

            // Verify the result is false (no retry)
            expect(result, "Result should be false").to.be.false;

            // Verify SSL error was handled
            expect(
                mockLogger.verbose.calledWith("Fixing SSL trust server certificate error."),
                "Verbose log should indicate SSL error fix",
            ).to.be.true;
            expect(
                mockConnectionManager.handleSSLError.calledOnce,
                "Handle SSL error should be called once",
            ).to.be.true;

            // Verify telemetry was updated for SSL error
            expect(updateStub.calledTwice, "Telemetry should be updated twice").to.be.true;
            expect(
                updateStub.args[1][0].errorHandled,
                "Error handled should be trustServerCertificate",
            ).to.equal("trustServerCertificate");
            expect(updateStub.args[1][0].isFixed, "Is fixed should be false").to.equal("false");
        });

        test("handleSessionCreationFailure should handle firewall error", async () => {
            // Modify isFirewallError to return true for this test
            sandbox.stub(ObjectExplorerUtils, "isFirewallError");

            (ObjectExplorerUtils.isFirewallError as sinon.SinonStub).returns(true);

            // Create a failure response with firewall error
            const failureResponse = createMockFailureResponse({
                errorNumber: Constants.errorFirewallRule,
                errorMessage: "Firewall rule error",
            });

            const connectionProfile = createMockConnectionProfile();
            const telemetryActivity = mockActivityObject;
            const updateStub = telemetryActivity.update as sinon.SinonStub<any[], any>;

            // Setup handleFirewallRule to return success
            mockFirewallService.handleFirewallRule.resolves({
                result: true,
                ipAddress: "192.168.1.1",
            });

            // handleFirewallError removed in refactoring
            // mockConnectionUI.handleFirewallError.resolves(true);

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                telemetryActivity,
            );

            // Verify the result is true (retry)
            expect(result, "Result should be true").to.be.true;

            // Verify firewall error was handled
            expect(
                mockFirewallService.handleFirewallRule.calledOnce,
                "Handle firewall rule should be called once",
            ).to.be.true;
            expect(
                mockFirewallService.handleFirewallRule.args[0][0],
                "Error number should match",
            ).to.equal(Constants.errorFirewallRule);
            expect(
                mockFirewallService.handleFirewallRule.args[0][1],
                "Error message should match",
            ).to.equal("Firewall rule error");

            // handleFirewallError removed in refactoring
            // Verify connection UI handled firewall error
            // expect(
            //     mockConnectionUI.handleFirewallError.calledOnce,
            //     "Handle firewall error should be called once",
            // ).to.be.true;
            // expect(
            //     mockConnectionUI.handleFirewallError.args[0][0],
            //     "Connection profile should match",
            // ).to.equal(connectionProfile);
            // expect(
            //     mockConnectionUI.handleFirewallError.args[0][1],
            //     "Failure response should match",
            // ).to.equal(failureResponse);

            // Verify telemetry was updated for firewall error
            expect(updateStub.calledTwice, "Telemetry should be updated twice").to.be.true;
            expect(
                updateStub.args[1][0].errorHandled,
                "Error handled should be firewallRule",
            ).to.equal("firewallRule");
            expect(updateStub.args[1][0].isFixed, "Is fixed should be true").to.equal("true");

            // Verify success was logged
            expect(
                mockLogger.verbose.calledWith("Firewall rule added for IP address 192.168.1.1"),
                "Verbose log should indicate firewall rule added",
            ).to.be.true;
        });

        test("handleSessionCreationFailure should return false if firewall rule was not fixed", async () => {
            // Modify isFirewallError to return true for this test
            sandbox.stub(ObjectExplorerUtils, "isFirewallError");
            (ObjectExplorerUtils.isFirewallError as sinon.SinonStub).returns(true);

            // Create a failure response with firewall error
            const failureResponse = createMockFailureResponse({
                errorNumber: Constants.errorFirewallRule,
                errorMessage: "Firewall rule error",
            });

            const connectionProfile = createMockConnectionProfile();
            const updateStub = mockActivityObject.update as sinon.SinonStub<any[], any>;

            // Setup handleFirewallRule to return success with IP address
            mockFirewallService.handleFirewallRule.resolves({
                result: true,
                ipAddress: "192.168.1.1",
            });

            // handleFirewallError removed in refactoring
            // mockConnectionUI.handleFirewallError.resolves(false);

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                mockActivityObject,
            );

            // Verify the result is false (no retry)
            expect(result, "Result should be false").to.be.false;

            // Verify error was logged
            expect(
                mockLogger.error.calledWith("Firewall rule not added for IP address 192.168.1.1"),
                "Verbose log should indicate firewall rule not added",
            ).to.be.true;

            // Verify telemetry was updated for firewall error
            expect(updateStub.calledTwice, "Telemetry should be updated twice").to.be.true;
            expect(
                updateStub.args[1][0].errorHandled,
                "Error handled should be firewallRule",
            ).to.equal("firewallRule");
            expect(updateStub.args[1][0].isFixed, "Is fixed should be false").to.equal("false");
        });

        test("handleSessionCreationFailure should skip firewall handling if handleFirewallRule returns no result", async () => {
            // Modify isFirewallError to return true for this test
            sandbox.stub(ObjectExplorerUtils, "isFirewallError");
            (ObjectExplorerUtils.isFirewallError as sinon.SinonStub).returns(true);

            // Create a failure response with firewall error
            const failureResponse = createMockFailureResponse({
                errorNumber: Constants.errorFirewallRule,
                errorMessage: "Firewall rule error",
            });

            const connectionProfile = createMockConnectionProfile();

            // Setup handleFirewallRule to return no result
            mockFirewallService.handleFirewallRule.resolves({
                result: false,
                ipAddress: undefined,
            });

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                mockActivityObject,
            );

            // Verify the result is false (no retry)
            expect(result, "Result should be false").to.be.false;

            // handleFirewallError removed in refactoring
            // Verify connection UI was NOT called
            // expect(
            //     mockConnectionUI.handleFirewallError.called,
            //     "Handle firewall error should not be called",
            // ).to.be.false;
        });

        test("handleSessionCreationFailure should handle Azure MFA authentication error needing refresh", async () => {
            // Modify needsAccountRefresh to return true for this test
            (objectExplorerService as any).needsAccountRefresh = sandbox.stub();
            (objectExplorerService as any).needsAccountRefresh.returns(true);

            // Create a failure response
            const failureResponse = createMockFailureResponse({
                errorNumber: 12345,
                errorMessage: "Azure authentication error",
            });

            const connectionProfile = createMockConnectionProfile({
                authenticationType: Constants.azureMfa,
                accountId: "azure-account-id",
                user: "test-user",
            });
            const updateStub = mockActivityObject.update as sinon.SinonStub<any[], any>;

            // Create a mock account
            const mockAccount = createMockAccount("azure-account-id");

            // Setup account store to return the mock account
            mockAccountStore.getAccount.withArgs("azure-account-id").resolves(mockAccount);

            // Setup refreshAccount to return success - method removed
            // sandbox.stub(objectExplorerService as any, "refreshAccount").resolves(true);

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationFailure(
                failureResponse,
                connectionProfile,
                mockActivityObject,
            );

            // Verify the result is true (retry)
            expect(result, "Result should be true").to.be.true;

            // Verify needsAccountRefresh was called
            expect(
                (objectExplorerService as any).needsAccountRefresh.calledOnce,
                "Needs account refresh should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).needsAccountRefresh.args[0][0],
                "Failure response should match",
            ).to.equal(failureResponse);
            expect(
                (objectExplorerService as any).needsAccountRefresh.args[0][1],
                "User should match",
            ).to.equal("test-user");

            // Verify account refresh was initiated - method removed
            // expect(
            //     (objectExplorerService as any).refreshAccount.calledOnce,
            //     "Refresh account should be called once",
            // ).to.be.true;
            // expect(
            //     (objectExplorerService as any).refreshAccount.args[0][0],
            //     "Mock account should match",
            // ).to.equal(mockAccount);
            // expect(
            //     (objectExplorerService as any).refreshAccount.args[0][1],
            //     "Connection profile should match",
            // ).to.equal(connectionProfile);

            // Verify telemetry was updated
            expect(updateStub.calledTwice, "Telemetry should be updated twice").to.be.true;
            // expect(
            //     updateStub.args[1][0].errorHandled,
            //     "Error handled should be refreshAccount",
            // ).to.equal("refreshAccount"); // Method removed
            expect(updateStub.args[1][0].isFixed, "Is fixed should be true").to.equal("true");

            // Verify success was logged
            expect(
                mockLogger.verbose.calledWith(`Token refreshed successfully for azure-account-id`),
                "Verbose log should indicate token refreshed successfully",
            ).to.be.true;
        });
    });

    suite("handleSessionCreationSuccess", () => {
        let sandbox: sinon.SinonSandbox;
        let mockLogger: sinon.SinonStubbedInstance<Logger>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let objectExplorerService: ObjectExplorerService;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockLogger = sandbox.createStubInstance(Logger);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);

            sandbox.stub(mockConnectionStore, "rootGroupId").get(() => TEST_ROOT_GROUP_ID);

            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionManager.client = mockClient;
            (mockConnectionManager as any)._connectionUI = mockConnectionUI;

            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
            (objectExplorerService as any).logger = mockLogger;
        });

        teardown(() => {
            sandbox.restore();
        });

        test("handleSessionCreationSuccess should return undefined when success is false", async () => {
            setUpOETreeRoot(objectExplorerService, []);

            // Create a failed success response
            const failedResponse = createMockSuccessResponse(false);
            const connectionProfile = createMockConnectionProfile();

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationSuccess(
                failedResponse,
                connectionProfile,
            );

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify the root tree node array is still empty
            expect(
                (objectExplorerService as any)._rootTreeNodeArray,
                "Root tree node array should be empty",
            ).to.be.an("array").that.is.empty;
        });

        test("handleSessionCreationSuccess should create a new connection node when none exists", async () => {
            mockConnectionManager.connect = sandbox.stub();
            sandbox.spy(objectExplorerService as any, "addConnectionNode");
            setUpOETreeRoot(objectExplorerService, []);
            // Create a successful response
            const successResponse = createMockSuccessResponse();
            const connectionProfile = createMockConnectionProfile();

            // Stub getConnectionNodeFromProfile to return undefined (no existing node)
            sandbox
                .stub(objectExplorerService as any, "getConnectionNodeFromProfile")
                .onFirstCall()
                .returns(undefined)
                .onSecondCall()
                .callsFake((profile) => {
                    // Return the newly created node on second call
                    return (objectExplorerService as any)._rootTreeNodeArray.find(
                        (n: ConnectionNode) => n.connectionProfile.id === profile.id,
                    );
                });

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationSuccess(
                successResponse,
                connectionProfile,
            );

            // Verify the result
            expect(result, "Result should exist").to.exist;
            expect(result.sessionId, "Session ID should be test-session-id").to.equal(
                "test-session-id",
            );
            expect(result.connectionNode, "Connection node should exist").to.exist;

            // Verify a new connection node was created and added to the root tree node array
            expect(
                (objectExplorerService as any)._rootTreeNodeArray.length,
                "Root tree node array should have length 1",
            ).to.equal(1);
            const newNode: ConnectionNode = (objectExplorerService as any)._rootTreeNodeArray[0];
            expect(newNode, "New node should be an instance of ConnectionNode").to.be.instanceOf(
                ConnectionNode,
            );
            expect(newNode.connectionProfile, "Connection profile should match").to.deep.equal(
                connectionProfile,
            );

            // Verify updateToConnectedState was called on the new node
            expect(newNode.nodeStatus, "New node status should be Connected").to.be.equal(
                "Connected",
            );

            // Verify connect was called
            expect(mockConnectionManager.connect.calledOnce, "Connect should be called once").to.be
                .true;
            expect(
                mockConnectionManager.connect.args[0][0],
                "Session ID should be test-session-id",
            ).to.equal(`test-session-id`);
            expect(
                mockConnectionManager.connect.args[0][1],
                "Connection profile should match",
            ).to.deep.equal(connectionProfile);

            // Verify addConnectionNode was called
            expect(
                (objectExplorerService as any).addConnectionNode.calledOnce,
                "Add connection node at right position should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).addConnectionNode.args[0][0],
                "New node should be added to the root tree node array",
            ).to.equal(newNode);
        });

        test("handleSessionCreationSuccess should update existing connection node", async () => {
            sandbox.spy(objectExplorerService as any, "addConnectionNode");

            // Create a successful response
            const successResponse = createMockSuccessResponse();
            const connectionProfile = createMockConnectionProfile();

            // Create an existing node
            setUpOETreeRoot(objectExplorerService, [connectionProfile]);
            const existingNode = (objectExplorerService as any)._rootTreeNodeArray[0];

            // Spy on the node's methods
            const updateProfileSpy = sandbox.stub();
            existingNode.updateConnectionProfile = updateProfileSpy;
            const updateStateSpy = sandbox.stub();
            existingNode.updateToConnectedState = updateStateSpy;

            // Stub getConnectionNodeFromProfile to return the existing node
            sandbox
                .stub(objectExplorerService as any, "getConnectionNodeFromProfile")
                .returns(existingNode);

            // Call the method
            const result = await (objectExplorerService as any).handleSessionCreationSuccess(
                successResponse,
                connectionProfile,
            );

            // Verify the result
            expect(result, "Result should exist").to.exist;
            expect(result.sessionId, "Session ID should be test-session-id").to.equal(
                "test-session-id",
            );
            expect(result.connectionNode, "Connection node should exist").to.equal(existingNode);

            // Verify no new node was created - array still has only one node
            expect(
                (objectExplorerService as any)._rootTreeNodeArray.length,
                "Root tree node array should have length 1",
            ).to.equal(1);

            // Verify updateConnectionProfile was called on the existing node
            expect(updateProfileSpy.calledOnce, "Update connection profile should be called once")
                .to.be.true;
            expect(updateProfileSpy.args[0][0], "Connection profile should match").to.equal(
                connectionProfile,
            );

            // Verify updateToConnectedState was called
            expect(updateStateSpy.calledOnce, "Update to connected state should be called once").to
                .be.true;
            expect(updateStateSpy.args[0][0].nodeInfo, "Node info should match").to.equal(
                successResponse.rootNode,
            );
            expect(updateStateSpy.args[0][0].sessionId, "Session ID should match").to.equal(
                successResponse.sessionId,
            );
            expect(
                updateStateSpy.args[0][0].connectionProfile,
                "Connection profile should match",
            ).to.equal(connectionProfile);

            // Verify addConnectionNode was NOT called (not a new connection)
            expect(
                (objectExplorerService as any).addConnectionNode.called,
                "Add connection node should NOT be called",
            ).to.be.false;
        });
    });

    // Commented out: refreshAccount method removed in connection refactoring
    /*suite("refreshAccount", () => {
        let sandbox: sinon.SinonSandbox;
        let mockLogger: sinon.SinonStubbedInstance<Logger>;
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockAzureController: sinon.SinonStubbedInstance<AzureController>;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
        let mockWithProgress: sinon.SinonStub;
        let objectExplorerService: ObjectExplorerService;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let mockFirewallService: sinon.SinonStubbedInstance<FirewallService>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockLogger = sandbox.createStubInstance(Logger);
            sandbox.stub(Logger, "create").returns(mockLogger);

            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockAzureController = sandbox.createStubInstance(AzureController);
            mockAzureController.refreshAccessToken = sandbox.stub();
            mockAzureController.populateAccountProperties = sandbox.stub();
            mockAccountStore = sandbox.createStubInstance(AccountStore);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
            mockFirewallService = sandbox.createStubInstance(FirewallService);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionManager.client = mockClient;
            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionManager.accountStore = mockAccountStore;
            mockConnectionManager.azureController = mockAzureController;

            mockWithProgress = sandbox.stub(vscode.window, "withProgress");
            mockWithProgress.callsFake((options, task) => {
                const mockProgress = {
                    report: sandbox.stub(),
                };
                const mockToken = {
                    onCancellationRequested: sandbox.stub(),
                };

                return task(mockProgress, mockToken);
            });

            // Set up the object explorer service
            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
            (objectExplorerService as any).logger = mockLogger;
            (objectExplorerService as any).connectionUI = mockConnectionUI;
            (objectExplorerService as any).firewallService = mockFirewallService;
        });

        teardown(() => {
            sandbox.restore();
        });

        test("refreshAccount should refresh token successfully", async () => {
            // Create mock account and connection credentials
            const mockAccount = createMockAccount();
            const mockConnectionCredentials = createMockConnectionProfile({
                tenantId: "tenant-id",
            }) as ConnectionCredentials;

            // Setup Azure controller to return a token
            mockAzureController.refreshAccessToken.resolves({
                token: "new-access-token",
                expiresOn: 10000, // 1 hour from now
            } as IToken);

            // Call the method
            const result = await (objectExplorerService as any).refreshAccount(
                mockAccount,
                mockConnectionCredentials,
            );

            // Verify the result is true (success)
            expect(result, "Refresh account should return true").to.be.true;

            // Verify Azure controller was called with correct parameters
            expect(
                mockAzureController.refreshAccessToken.calledOnce,
                "Azure controller should be called once",
            ).to.be.true;
            expect(
                mockAzureController.refreshAccessToken.args[0][0],
                "Mock account should match",
            ).to.equal(mockAccount);
            expect(
                mockAzureController.refreshAccessToken.args[0][1],
                "Mock account store should match",
            ).to.equal(mockAccountStore);
            expect(
                mockAzureController.refreshAccessToken.args[0][2],
                "Tenant ID should match",
            ).to.equal("tenant-id");
            expect(
                mockAzureController.refreshAccessToken.args[0][3],
                "Database resource should match",
            ).to.equal(providerSettings.resources.databaseResource);

            // Verify connection credentials were updated with new token
            expect(
                mockConnectionCredentials.azureAccountToken,
                "Azure account token should match",
            ).to.equal("new-access-token");
            expect(mockConnectionCredentials.expiresOn, "Expires on should exist").to.exist;

            // Verify withProgress was called with correct title
            expect(mockWithProgress.calledOnce, "withProgress should be called once").to.be.true;
            expect(mockWithProgress.args[0][0].title, "withProgress title should match").to.equal(
                LocalizedConstants.ObjectExplorer.AzureSignInMessage,
            );
        });

        test("refreshAccount should show error message if token refresh fails", async () => {
            // Create mock account and connection credentials
            const mockAccount = createMockAccount();
            const mockConnectionCredentials =
                createMockConnectionProfile() as ConnectionCredentials;

            // Setup Azure controller to return no token
            mockAzureController.refreshAccessToken.resolves(undefined);

            // Setup showErrorMessage to return a button click
            mockVscodeWrapper.showErrorMessage.resolves(LocalizedConstants.refreshTokenLabel);

            // Setup populateAccountProperties to return a profile with a token
            mockAzureController.populateAccountProperties.resolves({
                azureAccountToken: "populated-access-token",
                expiresOn: 1000, // 1 hour from now
            } as IConnectionProfile);

            // Call the method
            const result = await (objectExplorerService as any).refreshAccount(
                mockAccount,
                mockConnectionCredentials,
            );

            // Verify the result is true (success)
            expect(result, "Refresh account should return true").to.be.true;

            // Verify Azure controller was called
            expect(
                mockAzureController.refreshAccessToken.calledOnce,
                "Azure controller should be called once",
            ).to.be.true;

            // Verify error message was shown
            expect(
                mockVscodeWrapper.showErrorMessage.calledOnce,
                "Error message should be shown once",
            ).to.be.true;
            expect(
                mockVscodeWrapper.showErrorMessage.args[0][0],
                "Error message should match",
            ).to.equal(LocalizedConstants.msgAccountRefreshFailed);
            expect(
                mockVscodeWrapper.showErrorMessage.args[0][1],
                "Refresh token label should match",
            ).to.equal(LocalizedConstants.refreshTokenLabel);

            // Verify populateAccountProperties was called since refresh button was clicked
            expect(
                mockAzureController.populateAccountProperties.calledOnce,
                "Populate account properties should be called once",
            ).to.be.true;

            // Verify connection credentials were updated with populated token
            expect(
                mockConnectionCredentials.azureAccountToken,
                "Azure account token should match",
            ).to.equal("populated-access-token");
            expect(mockConnectionCredentials.expiresOn, "Expires on should exist").to.exist;
        });

        test("refreshAccount should handle user cancellation of refresh", async () => {
            // Create mock account and connection credentials
            const mockAccount = createMockAccount();
            const mockConnectionCredentials =
                createMockConnectionProfile() as ConnectionCredentials;

            // Setup Azure controller to return no token
            mockAzureController.refreshAccessToken.resolves(undefined);

            // Setup showErrorMessage to return undefined (user closed dialog)
            mockVscodeWrapper.showErrorMessage.resolves(undefined);

            // Call the method
            const result = await (objectExplorerService as any).refreshAccount(
                mockAccount,
                mockConnectionCredentials,
            );

            // Verify the result is true (success) - the method still resolves true even if user cancels
            expect(result, "Refresh account should return true").to.be.true;

            // Verify error was logged
            expect((mockLogger.error as sinon.SinonStub).calledOnce, "Error should be logged").to.be
                .true;

            // Verify populateAccountProperties was NOT called since user didn't click refresh
            expect(
                mockAzureController.populateAccountProperties.called,
                "Populate account properties should not be called",
            ).to.be.false;
        });

        test("refreshAccount should handle progress cancellation", async () => {
            // Create mock account and connection credentials
            const mockAccount = createMockAccount();
            const mockConnectionCredentials =
                createMockConnectionProfile() as ConnectionCredentials;

            mockVscodeWrapper.showErrorMessage.resolves(LocalizedConstants.refreshTokenLabel);

            // Modify withProgress to simulate cancellation
            mockWithProgress.restore(); // Restore the original stub
            mockWithProgress = sandbox.stub(vscode.window, "withProgress");
            mockWithProgress.callsFake((options, task) => {
                const mockProgress = {
                    report: sandbox.stub(),
                };
                const mockToken = {
                    onCancellationRequested: (callback: () => void) => {
                        // Immediately trigger cancellation
                        callback();
                        return { dispose: sandbox.stub() };
                    },
                };

                return task(mockProgress, mockToken);
            });

            // Call the method
            const result = await (objectExplorerService as any).refreshAccount(
                mockAccount,
                mockConnectionCredentials,
            );

            // Verify the result is false (cancelled)
            expect(result, "Refresh account should return false").to.be.false;

            // Verify cancellation was logged
            expect(
                mockLogger.verbose.calledWith("Azure sign in cancelled by user."),
                "Verbose log should indicate cancellation",
            ).to.be.true;
        });

        test("refreshAccount should handle errors during refresh", async () => {
            // Create mock account and connection credentials
            const mockAccount = createMockAccount();
            const mockConnectionCredentials =
                createMockConnectionProfile() as ConnectionCredentials;

            // Setup Azure controller to throw an error
            const testError = new Error("Test refresh error");
            mockAzureController.refreshAccessToken.rejects(testError);

            // Call the method
            const result = await (objectExplorerService as any).refreshAccount(
                mockAccount,
                mockConnectionCredentials,
            );

            // Verify the result is false (error)
            expect(result, "Refresh account should return false").to.be.false;

            // Verify error was logged
            expect(
                mockLogger.error.calledWith("Error refreshing account: " + testError),
                "Error should be logged",
            ).to.be.true;

            // Verify error message was shown
            expect(
                mockVscodeWrapper.showErrorMessage.calledOnce,
                "Error message should be shown once",
            ).to.be.true;
            expect(
                mockVscodeWrapper.showErrorMessage.args[0][0],
                "Error message should match",
            ).to.equal(testError.message);
        });
    });*/

    suite("getNodeIdentifier", () => {
        let sandbox: sinon.SinonSandbox;
        let objectExplorerService: ObjectExplorerService;

        setup(() => {
            sandbox = sinon.createSandbox();
            const mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            const mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionManager.client = mockClient;
            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("getNodeIdentifier should return the correct identifier for a given node with session", () => {
            // Create a mock node
            const mockNode = new ConnectionNode({
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "",
                profileName: "profile1",
            } as IConnectionProfile);

            // Call the method
            const result = (objectExplorerService as any).getNodeIdentifier(mockNode);

            // Verify the result
            expect(result, "Node identifier should match").to.equal("server1_db1_profile1");
        });

        test("getNodeIdentifier should return the correct identifier for a node with a session", () => {
            // Create a mock node without a connection profile
            const mockNode = {
                id: "node1",
                connectionProfile: undefined,
                sessionId: "session1",
            } as TreeNodeInfo;

            // Call the method
            const result = (objectExplorerService as any).getNodeIdentifier(mockNode);

            // Verify the result
            expect(result, "Node identifier should match").to.equal("session1");
        });
    });

    suite("ObjectExplorerService - createSession Tests", () => {
        let sandbox: sinon.SinonSandbox;
        let objectExplorerService: ObjectExplorerService;
        let endStub: sinon.SinonStub;
        let endFailedStub: sinon.SinonStub;
        let startActivityStub: sinon.SinonStub;
        let mockActivity: ActivityObject;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockLogger: sinon.SinonStubbedInstance<Logger>;

        setup(() => {
            sandbox = sinon.createSandbox();
            const mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);

            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionStore.readAllConnections.resolves([]);
            sandbox.stub(mockConnectionStore, "rootGroupId").get(() => TEST_ROOT_GROUP_ID);

            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockConnectionManager.client = mockClient;
            mockConnectionManager.connectionStore = mockConnectionStore;

            endStub = sandbox.stub();
            endFailedStub = sandbox.stub();
            mockActivity = {
                end: endStub,
                endFailed: endFailedStub,
                correlationId: "",
                startTime: 0,
                update: sandbox.stub(),
            };
            startActivityStub = sandbox.stub(telemetry, "startActivity").returns(mockActivity);
            mockLogger = sandbox.createStubInstance(Logger);
            sandbox.stub(Logger, "create").returns(mockLogger);
            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("createSession should return undefined if prepareConnectionProfile returns undefined", async () => {
            // Setup prepareConnectionProfile to return undefined (user cancelled)
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(undefined);

            const connectionInfo: IConnectionInfo = {
                server: "TestServer",
                database: "TestDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: generateUUID(),
            } as IConnectionInfo;

            // Preemptively set maps to insulate from getRootNodes() byproducts
            objectExplorerService["_connectionGroupNodes"] = new Map();
            objectExplorerService["_connectionNodes"] = new Map();

            // Call the method
            const result = await objectExplorerService.createSession(connectionInfo);

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify prepareConnectionProfile was called with the connection info
            expect(
                (objectExplorerService as any).prepareConnectionProfile.calledOnce,
                "Prepare connection profile should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).prepareConnectionProfile.args[0][0],
                "Prepare connection profile should be called with connection info",
            ).to.equal(connectionInfo);

            // Verify telemetry was started
            expect(startActivityStub.calledOnce, "Telemetry should be started once").to.be.true;
            expect(startActivityStub.args[0][0], "Telemetry view should match").to.equal(
                TelemetryViews.ObjectExplorer,
            );
            expect(startActivityStub.args[0][1], "Telemetry action should match").to.equal(
                TelemetryActions.CreateSession,
            );
            expect(
                startActivityStub.args[0][3].connectionType,
                "Connection type should match",
            ).to.equal("SqlLogin");
        });

        test("createSession should call client to get session ID and create session", async () => {
            // Setup prepareConnectionProfile to return a profile
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to return session ID and create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = {
                sessionId: "test-session-id",
            };
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);

            (objectExplorerService as any).handleSessionCreationSuccess = sandbox.stub();
            const sessionCreationSuccessResponse = {
                sessionId: "test-session-id",
                connectionNode: { label: "TestServer" } as any,
            };
            (objectExplorerService as any).handleSessionCreationSuccess.resolves(
                sessionCreationSuccessResponse,
            );

            const createConnectionStub = sandbox.stub(
                ConnectionCredentials,
                "createConnectionDetails",
            );

            // Preemptively set maps to insulate from getRootNodes() byproducts
            objectExplorerService["_connectionGroupNodes"] = new Map();
            objectExplorerService["_connectionNodes"] = new Map();

            // Call the method
            const resultPromise = objectExplorerService.createSession();
            await new Promise((resolve) => setTimeout(resolve, 10));
            const promise = (objectExplorerService as any)._pendingSessionCreations.get(
                "test-session-id",
            );
            const sessionCreatedParameters: SessionCreatedParameters = {
                sessionId: "test-session-id",
                success: true,
                errorMessage: "",
                errorNumber: undefined,
                rootNode: { label: "TestServer" } as any,
            };
            if (promise) {
                promise.resolve(sessionCreatedParameters);
            }

            const result = await resultPromise;

            // Verify the result
            expect(result, "Result should match session creation success response").to.equal(
                sessionCreationSuccessResponse,
            );

            // Verify telemetry was started and ended with success
            expect(startActivityStub.calledOnce, "Telemetry should be started once").to.be.true;
            expect(endStub.calledOnce, "Telemetry should be ended once").to.be.true;
            expect(endStub.args[0][0], "Telemetry status should be succeeded").to.equal(
                ActivityStatus.Succeeded,
            );
            expect(endStub.args[0][1].connectionType, "Connection type should match").to.equal(
                connectionProfile.authenticationType,
            );

            // Verify client requests were sent
            expect(mockClient.sendRequest.calledTwice, "Client should send two requests").to.be
                .true;
            expect(
                mockClient.sendRequest.firstCall.args[0],
                "First request type should match",
            ).to.equal(GetSessionIdRequest.type);
            expect(
                mockClient.sendRequest.secondCall.args[0],
                "Second request type should match",
            ).to.equal(CreateSessionRequest.type);

            // Verify connection details were created and passed to the requests
            expect(createConnectionStub.calledOnce, "Connection details should be created once").to
                .be.true;
            expect(createConnectionStub.args[0][0], "Connection profile should match").to.equal(
                connectionProfile,
            );

            // Verify pending session creation was set up and cleaned up
            expect(
                (objectExplorerService as any)._pendingSessionCreations.size,
                "Pending session creations should be empty",
            ).to.equal(0);
        });

        test("createSession should handle successful session creation", async () => {
            // Setup prepareConnectionProfile to return a profile
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to return session ID and create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = {
                sessionId: "test-session-id",
            };
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);

            // Setup successful session creation result
            const successResult: CreateSessionResult = {
                sessionId: "test-session-id",
                connectionNode: { label: "TestServer" } as any,
            };
            (objectExplorerService as any).handleSessionCreationSuccess = sandbox.stub();
            (objectExplorerService as any).handleSessionCreationSuccess.resolves(successResult);

            // Call the method
            const resultPromise = objectExplorerService.createSession();

            // Simulate session created notification
            const sessionCreatedResponse = {
                sessionId: "test-session-id",
                success: true,
                errorMessage: "",
                errorNumber: undefined,
                rootNode: { label: "TestServer" } as any,
            };

            // Wait a bit for the promise to be set up
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get the deferred object and resolve it
            const pendingSession = (objectExplorerService as any)._pendingSessionCreations.get(
                "test-session-id",
            );
            expect(pendingSession, "Pending session should exist").to.exist;
            pendingSession.resolve(sessionCreatedResponse);

            // Wait for the result
            const result = await resultPromise;

            // Verify the result
            expect(result, "Result should match session creation success response").to.equal(
                successResult,
            );

            // Verify handleSessionCreationSuccess was called with the correct parameters
            expect(
                (objectExplorerService as any).handleSessionCreationSuccess.calledOnce,
                "handleSessionCreationSuccess should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).handleSessionCreationSuccess.args[0][0],
                "Session created response should match",
            ).to.equal(sessionCreatedResponse);
            expect(
                (objectExplorerService as any).handleSessionCreationSuccess.args[0][1],
                "Connection profile should match",
            ).to.equal(connectionProfile);
        });

        test("createSession should handle session creation failure", async () => {
            // Setup prepareConnectionProfile to return a profile
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to return session ID and create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = {
                sessionId: "test-session-id",
            };
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);

            // Setup handleSessionCreationFailure to return true (should retry)
            (objectExplorerService as any).handleSessionCreationFailure = sandbox.stub();
            (objectExplorerService as any).handleSessionCreationFailure.resolves(true);

            // Call the method
            const resultPromise = objectExplorerService.createSession();

            // Simulate session created notification with failure
            const failureResponse = {
                sessionId: "test-session-id",
                success: false,
                errorMessage: "Authentication failed",
                errorNumber: 12345,
                rootNode: { label: "TestServer" } as any,
            };

            // Wait a bit for the promise to be set up
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get the deferred object and resolve it with failure
            const pendingSession = (objectExplorerService as any)._pendingSessionCreations.get(
                "test-session-id",
            );
            expect(pendingSession, "Pending session should exist").to.exist;
            pendingSession.resolve(failureResponse);

            // Wait for the result
            const result = await resultPromise;

            // Verify the result includes retry flag
            expect(result, "Result should include retry flag").to.deep.equal({
                sessionId: undefined,
                connectionNode: undefined,
                shouldRetryOnFailure: true,
            });

            // Verify failure was logged
            expect(
                mockLogger.error.calledWith(
                    `Session creation failed with error: Authentication failed`,
                ),
                "Error logging should indicate session creation failure",
            ).to.be.true;

            // Verify handleSessionCreationFailure was called with the correct parameters
            expect(
                (objectExplorerService as any).handleSessionCreationFailure.calledOnce,
                "handleSessionCreationFailure should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).handleSessionCreationFailure.args[0][0],
                "Session creation failure response should match",
            ).to.equal(failureResponse);
            expect(
                (objectExplorerService as any).handleSessionCreationFailure.args[0][1],
                "Connection profile should match",
            ).to.equal(connectionProfile);
            expect(
                (objectExplorerService as any).handleSessionCreationFailure.args[0][2],
                "Activity should match",
            ).to.equal(mockActivity);

            // Verify telemetry recorded failure
            expect(endFailedStub.calledOnce, "Telemetry should record session creation failure").to
                .be.true;
        });

        test("createSession should handle session creation failure without retry", async () => {
            // Setup prepareConnectionProfile to return a profile
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to return session ID and create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = {
                sessionId: "test-session-id",
            };
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);

            // Setup handleSessionCreationFailure to return false (should not retry)
            (objectExplorerService as any).handleSessionCreationFailure = sandbox.stub();
            (objectExplorerService as any).handleSessionCreationFailure.resolves(false);

            // Call the method
            const resultPromise = objectExplorerService.createSession();

            // Simulate session created notification with failure
            const failureResponse = {
                sessionId: "test-session-id",
                success: false,
                errorMessage: "Authentication failed",
                errorNumber: 12345,
                rootNode: { label: "TestServer" } as any,
            };

            // Wait a bit for the promise to be set up
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get the deferred object and resolve it with failure
            const pendingSession = (objectExplorerService as any)._pendingSessionCreations.get(
                "test-session-id",
            );
            expect(pendingSession, "Pending session should exist").to.exist;
            pendingSession.resolve(failureResponse);

            // Wait for the result
            const result = await resultPromise;

            // Verify the result includes retry flag as false
            expect(result, "Result should include retry flag").to.deep.equal({
                sessionId: undefined,
                connectionNode: undefined,
                shouldRetryOnFailure: false,
            });
        });

        test("createSession should return undefined if CreateSessionResponse is false", async () => {
            // Setup prepareConnectionProfile to return a profile
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to return session ID but fail to create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = undefined;
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);

            (objectExplorerService as any).handleSessionCreationSuccess = sandbox.stub();
            (objectExplorerService as any).handleSessionCreationFailure = sandbox.stub();

            // Call the method
            const result = await objectExplorerService.createSession();

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify client requests were sent
            expect(mockClient.sendRequest.calledTwice, "Client requests should be sent twice").to.be
                .true;

            // Verify session creation handlers were not called
            expect(
                (objectExplorerService as any).handleSessionCreationSuccess.called,
                "handleSessionCreationSuccess should not be called",
            ).to.be.false;
            expect(
                (objectExplorerService as any).handleSessionCreationFailure.called,
                "handleSessionCreationFailure should not be called",
            ).to.be.false;
        });

        test("createSession should generate telemetry with correct connection type", async () => {
            // Test with provided connection info
            const connectionInfo: IConnectionInfo = {
                server: "TestServer",
                database: "TestDB",
                authenticationType: "AzureMFA",
                user: "testUser",
                password: generateUUID(),
            } as IConnectionInfo;

            // Setup to return undefined to end the test early
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(undefined);

            // Preemptively set maps to insulate from getRootNodes() byproducts
            objectExplorerService["_connectionGroupNodes"] = new Map();
            objectExplorerService["_connectionNodes"] = new Map();

            // Call the method
            await objectExplorerService.createSession(connectionInfo);

            // Verify telemetry was started with correct connection type
            expect(
                startActivityStub.calledOnce,
                "Telemetry should be started with correct connection type",
            ).to.be.true;
            expect(
                startActivityStub.args[0][3].connectionType,
                "Connection type should match",
            ).to.equal("AzureMFA");

            // Reset stubs
            startActivityStub.resetHistory();
            (objectExplorerService as any).prepareConnectionProfile.resetHistory();

            // Test with undefined connection info (new connection)
            await objectExplorerService.createSession(undefined);

            // Verify telemetry was started with 'newConnection'
            expect(startActivityStub.calledOnce, "Telemetry should be started with 'newConnection'")
                .to.be.true;
            expect(
                startActivityStub.args[0][3].connectionType,
                "Connection type should match",
            ).to.equal("newConnection");
        });

        test("createSession should handle client request errors gracefully", async () => {
            // Setup prepareConnectionProfile to return a profile
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to throw an error on sendRequest
            const testError = new Error("Client request failed");
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .rejects(testError);

            // Call the method and expect it to throw
            try {
                await objectExplorerService.createSession();
                // If we get here, the test failed
                expect.fail("Method should have thrown an error");
            } catch (error) {
                // Verify the error was propagated
                expect(error, "Error should match test error").to.equal(testError);
            }
        });

        test("createSession should handle unexpected session creation notification", async () => {
            // Setup prepareConnectionProfile to return a profile
            const connectionProfile = createMockConnectionProfile();
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(connectionProfile);

            // Setup client to return session ID and create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = {
                sessionId: "test-session-id",
            };
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);
            (objectExplorerService as any).handleSessionCreationSuccess = sandbox.stub();
            (objectExplorerService as any).handleSessionCreationFailure = sandbox.stub();
            // Call the method
            const resultPromise = objectExplorerService.createSession();

            // Simulate session created notification with wrong session ID
            const wrongSessionResponse = {
                sessionId: "wrong-session-id",
                success: true,
                errorMessage: "",
                errorNumber: undefined,
                rootNode: { label: "TestServer" } as any,
            };

            // Wait a bit for the promise to be set up
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get the deferred object for the correct session ID
            const pendingSession = (objectExplorerService as any)._pendingSessionCreations.get(
                "test-session-id",
            );
            expect(pendingSession, "Pending session should exist").to.exist;

            // Create and resolve a deferred for the wrong session ID
            const wrongPendingSession = new Deferred<SessionCreatedParameters>();
            (objectExplorerService as any)._pendingSessionCreations.set(
                "wrong-session-id",
                wrongPendingSession,
            );
            wrongPendingSession.resolve(wrongSessionResponse);

            // Resolve the correct session
            const correctSessionResponse = {
                sessionId: "test-session-id",
                success: true,
                errorMessage: "",
                errorNumber: undefined,
                rootNode: { label: "TestServer" } as any,
            };
            pendingSession.resolve(correctSessionResponse);

            // Setup handleSessionCreationSuccess to return a result
            const successResult: CreateSessionResult = {
                sessionId: "test-session-id",
                connectionNode: { label: "TestServer" } as any,
            };
            (objectExplorerService as any).handleSessionCreationSuccess.resolves(successResult);

            // Wait for the result
            const result = await resultPromise;

            // Verify the result
            expect(result, "Result should match success result").to.equal(successResult);

            // Verify only the correct session was cleaned up
            expect(
                (objectExplorerService as any)._pendingSessionCreations.has("test-session-id"),
                "Pending session for test-session-id should be cleaned up",
            ).to.be.false;
            expect(
                (objectExplorerService as any)._pendingSessionCreations.has("wrong-session-id"),
                "Pending session for wrong-session-id should exist",
            ).to.be.true;
        });

        test("createSession should use new connection profile when none is provided", async () => {
            // Setup prepareConnectionProfile to create and return a new profile
            const newConnectionProfile = createMockConnectionProfile({
                id: "new-profile-id",
                authenticationType: "SqlLogin",
            });
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(newConnectionProfile);

            // Setup client to return session ID and create session
            const sessionIdResponse: GetSessionIdResponse = { sessionId: "test-session-id" };
            mockClient.sendRequest
                .withArgs(GetSessionIdRequest.type, sinon.match.any)
                .resolves(sessionIdResponse);

            const createSessionResponse: CreateSessionResponse = {
                sessionId: "test-session-id",
            };
            mockClient.sendRequest
                .withArgs(CreateSessionRequest.type, sinon.match.any)
                .resolves(createSessionResponse);

            // Setup successful session creation
            const successResult: CreateSessionResult = {
                sessionId: "test-session-id",
                connectionNode: { label: "TestServer" } as any,
            };
            (objectExplorerService as any).handleSessionCreationSuccess = sandbox.stub();
            (objectExplorerService as any).handleSessionCreationSuccess.resolves(successResult);

            const createConnectionDetails = sandbox.stub(
                ConnectionCredentials,
                "createConnectionDetails",
            );

            // Preemptively set maps to insulate from getRootNodes() byproducts
            objectExplorerService["_connectionGroupNodes"] = new Map();
            objectExplorerService["_connectionNodes"] = new Map();

            // Call the method without connection info
            const resultPromise = objectExplorerService.createSession();

            // Simulate session created notification
            const sessionCreatedResponse = {
                sessionId: "test-session-id",
                success: true,
                errorMessage: "",
                errorNumber: undefined,
                rootNode: { label: "TestServer" } as any,
            };

            // Wait a bit for the promise to be set up
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get the deferred object and resolve it
            const pendingSession = (objectExplorerService as any)._pendingSessionCreations.get(
                "test-session-id",
            );
            expect(pendingSession, "Pending session should exist").to.exist;
            pendingSession.resolve(sessionCreatedResponse);

            // Wait for the result
            const result = await resultPromise;

            // Verify the result
            expect(result).to.equal(successResult);

            // Verify prepareConnectionProfile was called with undefined
            expect(
                (objectExplorerService as any).prepareConnectionProfile.calledOnce,
                "prepareConnectionProfile should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).prepareConnectionProfile.args[0][0],
                "Connection profile should be undefined",
            ).to.be.undefined;

            // Verify connection details were created with the new profile
            expect(createConnectionDetails.calledOnce, "Connection details should be created once")
                .to.be.true;
            expect(
                createConnectionDetails.args[0][0],
                "Connection details should match new profile",
            ).to.equal(newConnectionProfile);

            // Verify telemetry was updated with the new authentication type
            expect(endStub.calledOnce, "Telemetry end should be called once").to.be.true;
            expect(
                endStub.args[0][1].connectionType,
                "Connection type should be SqlLogin",
            ).to.equal("SqlLogin");
        });
    });

    suite("getRootNodes test", () => {
        let sandbox: sinon.SinonSandbox;
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let endStub: sinon.SinonStub;
        let endFailedStub: sinon.SinonStub;
        let startActivityStub: sinon.SinonStub;
        let mockLogger: sinon.SinonStubbedInstance<Logger>;
        let objectExplorerService: ObjectExplorerService;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionManager.client = mockClient;

            sandbox.stub(mockConnectionStore, "rootGroupId").get(() => TEST_ROOT_GROUP_ID);

            endStub = sandbox.stub();
            endFailedStub = sandbox.stub();
            startActivityStub = sandbox.stub(telemetry, "startActivity").returns({
                end: endStub,
                endFailed: endFailedStub,
                correlationId: "",
                startTime: 0,
                update: sandbox.stub(),
            });
            mockLogger = sandbox.createStubInstance(Logger);
            sandbox.stub(Logger, "create").returns(mockLogger);
            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                () => {},
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("getRootNodes should return AddConnectionNodes when no saved connections exist", async () => {
            // Setup connection store to return empty array
            mockConnectionStore.readAllConnections.resolves([]);
            mockConnectionStore.readAllConnectionGroups.resolves([createMockRootConnectionGroup()]);

            // Setup getAddConnectionNodes to return a mock nodes
            const mockAddConnectionNodes = [
                { label: "Add Connection" },
                { label: "Create Local Container Connection" },
            ];
            (objectExplorerService as any).getAddConnectionNodes = sandbox.stub();
            (objectExplorerService as any).getAddConnectionNodes.returns(mockAddConnectionNodes);

            // Call the method
            const result = await (objectExplorerService as any).getRootNodes();

            // Verify the result
            expect(result, "Result should match mock add connection nodes").to.equal(
                mockAddConnectionNodes,
            );

            // Verify connection store was called
            expect(
                mockConnectionStore.readAllConnections.calledOnce,
                "Connection store should be called once",
            ).to.be.true;

            // Verify getAddConnectionNodes was called
            expect((objectExplorerService as any).getAddConnectionNodes.calledOnce).to.be.true;

            // Verify telemetry was tracked
            expect(startActivityStub.calledOnce, "Telemetry start should be called once").to.be
                .true;
            expect(
                startActivityStub.args[0][0],
                "Telemetry view should be ObjectExplorer",
            ).to.equal(TelemetryViews.ObjectExplorer);
            expect(startActivityStub.args[0][1], "Telemetry action should be ExpandNode").to.equal(
                TelemetryActions.ExpandNode,
            );
            expect(startActivityStub.args[0][3].nodeType, "Node type should be root").to.equal(
                "root",
            );

            // Verify activity ended with success
            expect(endStub.calledOnce, "Telemetry end should be called once").to.be.true;
            expect(endStub.args[0][0], "Telemetry end status should be Succeeded").to.equal(
                ActivityStatus.Succeeded,
            );
            expect(
                endStub.args[0][2].childrenCount,
                "Telemetry end should have zero children",
            ).to.equal(0);
        });

        test("getRootNodes should create connection nodes from saved profiles", async () => {
            // Setup connection store to return connections (not empty)
            const mockConnections = createMockConnectionProfiles(2);
            mockConnectionStore.readAllConnections.resolves(mockConnections);
            mockConnectionStore.readAllConnectionGroups.resolves([createMockRootConnectionGroup()]);

            // Call the method
            const result = await (objectExplorerService as any).getRootNodes();

            // Verify the result
            expect(result, "Result should match saved nodes").to.have.length(2);
            expect(result[0].label, "First node label should match").to.equal(
                mockConnections[0].profileName,
            );
            expect(result[1].label, "Second node label should match").to.equal(
                mockConnections[1].profileName,
            );

            // Verify connection store was called
            expect(
                mockConnectionStore.readAllConnections.calledOnce,
                "Connection store should be called once",
            ).to.be.true;

            // Verify telemetry ended with correct node count
            expect(endStub.calledOnce, "Telemetry end should be called once").to.be.true;
            expect(endStub.args[0][2].nodeCount, "Telemetry end node count should be 2").to.equal(
                2,
            );
        });

        test("getRootNodes should handle error in connection store", async () => {
            // Setup connection store to throw error
            const testError = new Error("Failed to read connections");
            mockConnectionStore.readAllConnections.rejects(testError);

            // Call the method and expect it to throw
            try {
                await (objectExplorerService as any).getRootNodes();
                // If we get here, the test failed
                expect.fail("Method should have thrown an error");
            } catch (error) {
                // Verify the error is passed through
                expect(error, "Error should be passed through").to.equal(testError);

                // Verify telemetry was started but not ended
                expect(startActivityStub.calledOnce, "Telemetry start should be called once").to.be
                    .true;
                expect(endStub.called, "Telemetry end should not be called").to.be.false;
                expect(endFailedStub.called, "Telemetry end failed should not be called").to.be
                    .false; // We're letting the error propagate
            }
        });

        test("getRootNodes should return empty array when no groups or connections exist", async () => {
            // Setup connection store to return empty arrays for both connections and groups
            mockConnectionStore.readAllConnections.resolves([]);
            mockConnectionStore.readAllConnectionGroups.resolves([]);

            // Call the method
            const result = await (objectExplorerService as any).getRootNodes();

            // Verify the result is an empty array
            expect(result, "Result should be an empty array").to.be.an("array").that.is.empty;
        });

        test("getRootNodes should return groups and connections in correct order", async () => {
            // Create two root-level groups and one root-level connection
            const rootGroups = createMockConnectionGroups(2);
            const rootConnections = createMockConnectionProfiles(1);

            // Setup connection store to return the mock data
            mockConnectionStore.readAllConnectionGroups.resolves([
                createMockRootConnectionGroup(),
                ...rootGroups,
            ]);
            mockConnectionStore.readAllConnections.resolves(rootConnections);

            // Call the method
            const result = await (objectExplorerService as any).getRootNodes();

            // Verify we have all expected nodes
            expect(result.length, "Should have 3 root nodes (2 groups + 1 connection)").to.equal(3);

            // Verify groups come before connections
            const firstTwoAreGroups = result
                .slice(0, 2)
                .every((node) => node instanceof ConnectionGroupNode);
            const lastIsConnection = result[2] instanceof ConnectionNode;
            expect(firstTwoAreGroups, "First two nodes should be groups").to.be.true;
            expect(lastIsConnection, "Last node should be a connection").to.be.true;

            // Verify the specific groups and connection
            const resultGroupIds = result
                .filter((node) => node instanceof ConnectionGroupNode)
                .map((node) => (node as ConnectionGroupNode).connectionGroup.id);
            expect(resultGroupIds).to.have.members([rootGroups[0].id, rootGroups[1].id]);

            const resultConnection = result[2] as ConnectionNode;
            expect(resultConnection.connectionProfile.id).to.equal(rootConnections[0].id);
        });

        test("getRootNodes should handle nested group hierarchy correctly", async () => {
            // Set up mock data:
            // ROOT
            // ├── topLevelGroup
            // │   ├── connection
            // │   └── childGroup
            // └── rootConnection

            const topLevelGroups = createMockConnectionGroups(1);
            const topLevelGroup = topLevelGroups[0];

            const groupConnections = createMockConnectionProfiles(1, topLevelGroup.id);
            const childGroups = createMockConnectionGroups(1, topLevelGroup.id);
            const rootConnections = createMockConnectionProfiles(1); // at root level

            mockConnectionStore.readAllConnectionGroups.resolves([
                createMockRootConnectionGroup(),
                ...topLevelGroups,
                ...childGroups,
            ]);
            mockConnectionStore.readAllConnections.resolves([
                ...groupConnections,
                ...rootConnections,
            ]);

            await (objectExplorerService as any).getRootNodes();

            // Verify the result:
            const connectionGroupNodes = (objectExplorerService as any)
                ._connectionGroupNodes as Map<string, ConnectionGroupNode>;
            const connectionNodes = (objectExplorerService as any)._connectionNodes as Map<
                string,
                ConnectionNode
            >;

            // Verify top-level connection group
            const topLevelGroupNode = connectionGroupNodes.get(topLevelGroup.id);
            expect(topLevelGroupNode, "Top-level group node should exist").to.exist;
            expect(
                topLevelGroupNode.connectionGroup.id,
                "Top-level group ID should match",
            ).to.equal(topLevelGroup.id);
            expect(topLevelGroupNode.connectionGroup.parentId, "Parent ID should match").to.equal(
                topLevelGroup.parentId,
            );
            expect(topLevelGroupNode.parentNode, "parent of a top-level node should be undefined")
                .to.be.undefined;
            expect(
                topLevelGroupNode.children.length,
                "Top-level group should have 2 children",
            ).to.equal(2);

            // Verify root's children
            const rootNode = connectionGroupNodes.get(TEST_ROOT_GROUP_ID);
            expect(rootNode.children.length, "Root should have 2 children").to.equal(2);
            expect(rootNode.children).to.include(topLevelGroupNode);

            // Verify connection under root group
            const groupConnection = connectionNodes.get(groupConnections[0].id);
            expect(groupConnection, "Group connection should exist").to.exist;
            expect(
                (groupConnection.parentNode as ConnectionGroupNode)?.connectionGroup.id,
            ).to.equal(topLevelGroup.id);

            // Verify child group under root group
            const childGroup = connectionGroupNodes.get(childGroups[0].id);
            expect(childGroup, "Child group should exist").to.exist;
            expect((childGroup.parentNode as ConnectionGroupNode)?.connectionGroup.id).to.equal(
                topLevelGroup.id,
            );

            // Verify root-level connection
            const topLevelConnection = connectionNodes.get(rootConnections[0].id);
            expect(topLevelConnection, "Top-level connection should exist").to.exist;

            expect(
                topLevelConnection.connectionProfile.id,
                "Top-level connection ID should match",
            ).to.equal(rootConnections[0].id);
            expect(topLevelConnection.connectionProfile.groupId, "Group ID should match").to.equal(
                TEST_ROOT_GROUP_ID,
            );

            expect(topLevelConnection.parentNode).to.be.undefined;
            expect(rootNode.children).to.include(topLevelConnection);
        });
    });

    suite("Miscellaneous", () => {
        let objectExplorerService: ObjectExplorerService;

        let sandbox: sinon.SinonSandbox;

        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
        let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
        let mockAzureController: sinon.SinonStubbedInstance<AzureController>;
        let mockFirewallService: sinon.SinonStubbedInstance<FirewallService>;
        let mockWithProgress: sinon.SinonStub;

        let mockLogger: sinon.SinonStubbedInstance<Logger>;
        let startActivityStub: sinon.SinonStub;
        let mockRefreshCallback: sinon.SinonStub;
        let endStub: sinon.SinonStub;
        let endFailedStub: sinon.SinonStub;

        setup(() => {
            sandbox = sinon.createSandbox();
            // Create stubs for dependencies
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
            mockVscodeWrapper.showErrorMessage = sandbox
                .stub<[string, ...string[]], Thenable<string>>()
                .resolves();
            mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
            mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            sandbox.stub(mockConnectionStore, "rootGroupId").get(() => TEST_ROOT_GROUP_ID);
            mockConnectionManager.client = mockClient;
            mockConnectionManager.connectionStore = mockConnectionStore;
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
            sandbox.stub(mockConnectionManager, "connectionUI").get(() => mockConnectionUI);
            mockAccountStore = sandbox.createStubInstance(AccountStore);
            sandbox.stub(mockConnectionManager, "accountStore").get(() => mockAccountStore);
            mockAzureController = sandbox.createStubInstance(AzureController);
            mockAzureController.isAccountInCache = sandbox.stub();
            mockAzureController.isSqlAuthProviderEnabled = sandbox.stub();
            mockAzureController.refreshAccessToken = sandbox.stub();
            mockAzureController.populateAccountProperties = sandbox.stub();
            mockConnectionManager.azureController = mockAzureController;
            mockFirewallService = sandbox.createStubInstance(FirewallService);
            (mockConnectionManager as any)._firewallService = mockFirewallService;

            mockWithProgress = sandbox.stub(vscode.window, "withProgress");
            mockWithProgress.callsFake((options, task) => {
                const mockProgress = {
                    report: sandbox.stub(),
                };
                const mockToken = {
                    onCancellationRequested: sandbox.stub(),
                };

                return task(mockProgress, mockToken);
            });

            // Mock Telemetry
            endStub = sandbox.stub();
            endFailedStub = sandbox.stub();
            startActivityStub = sandbox.stub(telemetry, "startActivity").returns({
                end: endStub,
                endFailed: endFailedStub,
                correlationId: "",
                startTime: 0,
                update: sandbox.stub(),
            });
            mockRefreshCallback = sandbox.stub();

            // Mock the Logger.create static method
            mockLogger = sandbox.createStubInstance(Logger);
            sandbox.stub(Logger, "create").returns(mockLogger);
            mockLogger.verbose = sandbox.stub();
            mockLogger.error = sandbox.stub();

            objectExplorerService = new ObjectExplorerService(
                mockVscodeWrapper,
                mockConnectionManager,
                mockRefreshCallback,
            );
        });

        teardown(() => {
            sandbox.restore();
        });

        test("getConnectionNodeFromProfile should return the correct node for a given profile", () => {
            // Create mock connection profiles
            const mockProfiles: IConnectionProfileWithSource[] = [
                {
                    id: "conn1",
                    server: "server1",
                    database: "db1",
                    authenticationType: "Integrated",
                    user: "",
                    password: "",
                    savePassword: false,
                    groupId: TEST_ROOT_GROUP_ID,
                } as IConnectionProfileWithSource,
                {
                    id: "conn2",
                    server: "server2",
                    database: "db1",
                    authenticationType: "Integrated",
                    user: "",
                    password: "",
                    savePassword: false,
                    groupId: TEST_ROOT_GROUP_ID,
                } as IConnectionProfileWithSource,
            ];

            setUpOETreeRoot(objectExplorerService, mockProfiles);

            // Call the method with the first profile
            const result = (objectExplorerService as any).getConnectionNodeFromProfile(
                mockProfiles[0],
            );

            // Verify the result
            expect(result, "Result should be a ConnectionNode").to.be.instanceOf(ConnectionNode);
            expect(result.connectionProfile, "Connection profile should match").to.deep.equal(
                mockProfiles[0],
            );

            // Call the method with a non-existent profile
            const nonExistentProfile = {
                id: "conn3",
                server: "server3",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: TEST_ROOT_GROUP_ID,
            } as IConnectionProfileWithSource;
            const resultNonExistent = (objectExplorerService as any).getConnectionNodeFromProfile(
                nonExistentProfile,
            );

            // Verify the result is undefined
            expect(resultNonExistent, "Result should be undefined").to.be.undefined;
        });

        test("closeSession should call closeSession on client, disconnectNode and cleanNodeChildren", async () => {
            const mockProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                groupId: TEST_ROOT_GROUP_ID,
            } as IConnectionProfile;
            setUpOETreeRoot(objectExplorerService, [mockProfile]);

            const nodeChildren = [
                {
                    id: "child1",
                    connectionProfile: mockProfile,
                    sessionId: "session1",
                } as TreeNodeInfo,
            ];

            const mockNode = (objectExplorerService as any)._connectionNodes.get(mockProfile.id);
            mockNode.sessionId = "session1";

            (objectExplorerService as any)._treeNodeToChildrenMap = new Map();
            (objectExplorerService as any)._treeNodeToChildrenMap.set(mockNode, nodeChildren);

            // Set up the mock client to resolve
            mockClient.sendRequest.resolves({
                success: true,
                sessionId: "session1",
            });

            // Call the method
            await objectExplorerService.closeSession(mockNode);

            // Verify that the client closeSession method was called
            expect(mockClient.sendRequest.calledOnce, "Client closeSession should be called once")
                .to.be.true;
            expect(
                mockClient.sendRequest.firstCall.args[0],
                "First argument should be CloseSessionRequest.type",
            ).to.equal(CloseSessionRequest.type);
            expect(
                (mockClient.sendRequest.firstCall.args[1] as ConnectionNode).sessionId,
                "Session ID should match",
            ).to.equal("session1");

            // Verify that disconnectNode was called
            expect(
                mockConnectionManager.disconnect.calledOnce,
                "disconnectNode should be called once",
            ).to.be.true;
            expect(
                mockConnectionManager.disconnect.firstCall.args[0],
                "Session ID should match",
            ).to.equal("session1");

            // Verify that node and its children were removed from the map
            expect(
                (objectExplorerService as any)._treeNodeToChildrenMap.has(mockNode),
                "Node should be removed from map",
            ).to.be.false;
            expect(
                (objectExplorerService as any)._treeNodeToChildrenMap.has(nodeChildren[0]),
                "Child node should be removed from map",
            ).to.be.false;

            // Root tree node array should still contain the node
            expect(
                (objectExplorerService as any)._rootTreeNodeArray,
                "Root tree node array should still contain the node",
            ).to.include(mockNode);
        });

        test("createSession should return undefined if prepareConnectionProfile returns undefined", async () => {
            // Setup prepareConnectionProfile to return undefined (user cancelled)
            (objectExplorerService as any).prepareConnectionProfile = sandbox.stub();
            (objectExplorerService as any).prepareConnectionProfile.resolves(undefined);

            // Preemptively set maps to insulate from getRootNodes() byproducts
            objectExplorerService["_connectionGroupNodes"] = new Map();
            objectExplorerService["_connectionNodes"] = new Map();

            const connectionInfo: IConnectionInfo = {
                server: "TestServer",
                database: "TestDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: generateUUID(),
            } as IConnectionInfo;

            // Call the method
            const result = await objectExplorerService.createSession(connectionInfo);

            // Verify the result is undefined
            expect(result, "Result should be undefined").to.be.undefined;

            // Verify prepareConnectionProfile was called with the connection info
            expect(
                (objectExplorerService as any).prepareConnectionProfile.calledOnce,
                "prepareConnectionProfile should be called once",
            ).to.be.true;
            expect(
                (objectExplorerService as any).prepareConnectionProfile.args[0][0],
                "Connection info should match",
            ).to.equal(connectionInfo);

            // Verify telemetry was started
            expect(startActivityStub.calledOnce, "Telemetry should be started once").to.be.true;
            expect(
                startActivityStub.args[0][0],
                "First argument should be TelemetryViews.ObjectExplorer",
            ).to.equal(TelemetryViews.ObjectExplorer);
            expect(
                startActivityStub.args[0][1],
                "Second argument should be TelemetryActions.CreateSession",
            ).to.equal(TelemetryActions.CreateSession);
            expect(
                startActivityStub.args[0][3].connectionType,
                "Connection type should be SqlLogin",
            ).to.equal("SqlLogin");
        });
    });
});

const TEST_ROOT_GROUP_ID = "test-root-group-id";

function createMockConnectionProfiles(
    count: number,
    groupId: string = TEST_ROOT_GROUP_ID,
): IConnectionProfileWithSource[] {
    const profiles: IConnectionProfileWithSource[] = [];
    for (let i = 0; i < count; i++) {
        profiles.push({
            profileName: `profile${i}`,
            id: `${groupId}_conn${i}`,
            server: `server${i}`,
            database: `db${i}`,
            authenticationType: "SqlLogin",
            user: "",
            password: "",
            savePassword: false,
            groupId: groupId,
        } as IConnectionProfileWithSource);
    }
    return profiles;
}

function createMockRootConnectionGroup(): IConnectionGroup {
    return {
        id: TEST_ROOT_GROUP_ID,
        name: ConnectionConfig.RootGroupName,
    };
}

function createMockConnectionGroups(
    count: number,
    parentId: string = TEST_ROOT_GROUP_ID,
): IConnectionGroup[] {
    const groups: IConnectionGroup[] = [];
    for (let i = 0; i < count; i++) {
        groups.push({
            id: `${parentId}_group${i}`,
            name: `Group ${i}`,
            parentId: parentId,
            description: `Test group ${i}`,
        });
    }
    return groups;
}

function setUpOETreeRoot(
    objectExplorerService: ObjectExplorerService,
    profiles: IConnectionProfile[],
    groups: IConnectionGroup[] = [],
) {
    const rootNode = new ConnectionGroupNode({
        id: TEST_ROOT_GROUP_ID,
        name: ConnectionConfig.RootGroupName,
    });

    (objectExplorerService as any)._connectionGroupNodes = new Map<string, ConnectionGroupNode>([
        [rootNode.connectionGroup.id, rootNode],
    ]);
    (objectExplorerService as any)._connectionNodes = new Map<string, ConnectionNode>();

    // First set up all connection group nodes
    for (const group of groups) {
        const parentNode = (objectExplorerService as any)._connectionGroupNodes.get(group.parentId);
        if (parentNode) {
            const groupNode = new ConnectionGroupNode(group);
            (objectExplorerService as any)._connectionGroupNodes.set(group.id, groupNode);
            parentNode.addChild(groupNode);
        }
    }

    // Then set up all connection nodes
    for (const profile of profiles) {
        const parentNode = (objectExplorerService as any)._connectionGroupNodes.get(
            profile.groupId,
        );

        const connectionNode = new ConnectionNode(profile, parentNode);
        (objectExplorerService as any)._connectionNodes.set(profile.id, connectionNode);
        parentNode.addChild(connectionNode);
    }
}

// Helper function to create a mock failure response
function createMockFailureResponse(
    options: {
        errorNumber?: number;
        errorMessage?: string;
    } = {},
): SessionCreatedParameters {
    return {
        success: false,
        sessionId: "",
        rootNode: null,
        errorNumber: options.errorNumber,
        errorMessage: options.errorMessage || "",
    } as SessionCreatedParameters;
}

// Helper function to create a mock connection profile
function createMockConnectionProfile(
    options: {
        id?: string;
        authenticationType?: string;
        accountId?: string;
        user?: string;
        tenantId?: string;
    } = {},
): IConnectionProfile {
    return {
        id: options.id || "test-id",
        server: "TestServer",
        database: "TestDB",
        authenticationType: options.authenticationType || "SqlLogin",
        user: options.user ?? "testUser",
        password: generateUUID(),
        savePassword: true,
        accountId: options.accountId,
        tenantId: options.tenantId,
        groupId: TEST_ROOT_GROUP_ID,
    } as IConnectionProfile;
}

// Helper function to create a mock account
function createMockAccount(id: string = "account-id"): IAccount {
    return {
        key: {
            id: id,
            providerId: "azure",
        },
        displayInfo: {
            displayName: "Test User",
            email: "test@example.com",
            userId: id,
        },
    } as IAccount;
}

function createMockSuccessResponse(success: boolean = true): SessionCreatedParameters {
    return {
        success: success,
        sessionId: "test-session-id",
        rootNode: {
            nodePath: "/",
            nodeType: "Server",
            nodeSubType: "",
            label: "TestServer",
            isLeaf: false,
            nodeStatus: "Connected",
            errorMessage: "",
            metadata: null,
        },
        errorNumber: undefined,
        errorMessage: "",
    };
}
