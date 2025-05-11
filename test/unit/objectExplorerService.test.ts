/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { ObjectExplorerService } from "../../src/objectExplorer/objectExplorerService";
import { expect } from "chai";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Logger } from "../../src/models/logger";
import { ConnectionStore } from "../../src/models/connectionStore";
import { IConnectionProfile, IConnectionProfileWithSource } from "../../src/models/interfaces";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { CloseSessionRequest } from "../../src/models/contracts/objectExplorer/closeSessionRequest";
import { Deferred } from "../../src/protocol";
import { ExpandRequest } from "../../src/models/contracts/objectExplorer/expandNodeRequest";
import {
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../../src/sharedInterfaces/telemetry";
import * as telemetry from "../../src/telemetry/telemetry";
import { RefreshRequest } from "../../src/models/contracts/objectExplorer/refreshSessionRequest";
import { ExpandErrorNode } from "../../src/objectExplorer/nodes/expandErrorNode";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { IAccount, IServerInfo } from "vscode-mssql";
import { ConnectionUI } from "../../src/views/connectionUI";
import * as Utils from "../../src/models/utils";
import * as Constants from "../../src/constants/constants";
import { AccountStore } from "../../src/azure/accountStore";
import { AzureController } from "../../src/azure/azureController";

suite("Object Explorer Service Tests", () => {
    let objectExplorerService: ObjectExplorerService;

    let sandbox: sinon.SinonSandbox;

    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
    let mockAzureController: sinon.SinonStubbedInstance<AzureController>;

    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let startActivityStub: sinon.SinonStub;
    let mockRefreshCallback: sinon.SinonStub;
    let endStub: sinon.SinonStub;
    let endFailedStub: sinon.SinonStub;
    let sendActionEventStub: sinon.SinonStub;

    let mockGenerateGuidStub: sinon.SinonStub;

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
        mockConnectionManager.client = mockClient;
        mockConnectionManager.connectionStore = mockConnectionStore;
        mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
        sandbox.stub(mockConnectionManager, "connectionUI").get(() => mockConnectionUI);
        mockAccountStore = sandbox.createStubInstance(AccountStore);
        sandbox.stub(mockConnectionManager, "accountStore").get(() => mockAccountStore);
        mockAzureController = sandbox.createStubInstance(AzureController);
        mockAzureController.isAccountInCache = sandbox.stub();
        mockAzureController.isSqlAuthProviderEnabled = sandbox.stub();
        mockConnectionManager.azureController = mockAzureController;

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
        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");
        mockRefreshCallback = sandbox.stub();

        // Mock the Logger.create static method
        mockLogger = sandbox.createStubInstance(Logger);
        sandbox.stub(Logger, "create").returns(mockLogger);

        // Mock Utils
        mockGenerateGuidStub = sandbox.stub(Utils, "generateGuid").returns("mock-guid-12345");

        objectExplorerService = new ObjectExplorerService(
            mockVscodeWrapper,
            mockConnectionManager,
            mockRefreshCallback,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("cleanNodeChildren should remove node and all its children from the map", () => {
        // Create mock tree nodes
        const rootNode = { id: "root" } as vscode.TreeItem;
        const childNode1 = { id: "child1" } as vscode.TreeItem;
        const childNode2 = { id: "child2" } as vscode.TreeItem;
        const grandchildNode1 = { id: "grandchild1" } as vscode.TreeItem;

        // Set up the tree structure in the map
        (objectExplorerService as any)._treeNodeToChildrenMap = new Map();
        (objectExplorerService as any)._treeNodeToChildrenMap.set(rootNode, [
            childNode1,
            childNode2,
        ]);
        (objectExplorerService as any)._treeNodeToChildrenMap.set(childNode1, [grandchildNode1]);
        (objectExplorerService as any)._treeNodeToChildrenMap.set(childNode2, []);
        (objectExplorerService as any)._treeNodeToChildrenMap.set(grandchildNode1, []);

        // Call the method to test
        (objectExplorerService as any).cleanNodeChildren(rootNode);

        // Verify that all nodes were removed from the map
        expect((objectExplorerService as any)._treeNodeToChildrenMap.has(rootNode)).to.be.false;
        expect((objectExplorerService as any)._treeNodeToChildrenMap.has(childNode1)).to.be.false;
        expect((objectExplorerService as any)._treeNodeToChildrenMap.has(childNode2)).to.be.false;
        expect((objectExplorerService as any)._treeNodeToChildrenMap.has(grandchildNode1)).to.be
            .false;
    });

    test("getSavedConnectionNodes should return empty array when no connections exist", async () => {
        // Setup mock to return empty array
        mockConnectionStore.readAllConnections.resolves([]);

        // Call the method
        const result = await (objectExplorerService as any).getSavedConnectionNodes();

        // Verify the result is an empty array
        expect(result).to.be.an("array").that.is.empty;
        expect(mockConnectionStore.readAllConnections.calledOnce).to.be.true;
    });

    test("getSavedConnectionNodes should transform connections to ConnectionNode objects", async () => {
        // Create mock connections
        const mockConnections: IConnectionProfileWithSource[] = [
            {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "",
            } as IConnectionProfileWithSource,
            {
                id: "conn2",
                server: "server2",
                database: "db2",
                authenticationType: "SqlLogin",
                user: "user2",
                password: "pwd2",
                savePassword: true,
                groupId: "",
            } as IConnectionProfileWithSource,
        ];

        // Setup mock to return connections
        mockConnectionStore.readAllConnections.resolves(mockConnections);

        // Call the method
        const result = await (objectExplorerService as any).getSavedConnectionNodes();

        // Verify the result
        expect(result).to.be.an("array").with.lengthOf(2);
        expect(result[0]).to.be.instanceOf(ConnectionNode);
        expect(result[1]).to.be.instanceOf(ConnectionNode);
    });

    test("getSavedConnectionNodes should filter out duplicate connections", async () => {
        // Create mock connections with duplicates (same id)
        const mockConnections: IConnectionProfileWithSource[] = [
            {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "",
            } as IConnectionProfileWithSource,
            {
                id: "conn1", // Duplicate ID
                server: "server1-duplicate",
                database: "db2",
                authenticationType: "SqlLogin",
                user: "user2",
                password: "pwd2",
                savePassword: true,
                groupId: "",
            } as IConnectionProfileWithSource,
            {
                id: "conn2",
                server: "server2",
                database: "db2",
                authenticationType: "SqlLogin",
                user: "user2",
                password: "pwd2",
                savePassword: true,
                groupId: "",
            } as IConnectionProfileWithSource,
        ];

        // Setup mock to return connections with duplicates
        mockConnectionStore.readAllConnections.resolves(mockConnections);

        // Call the method
        const result = await (objectExplorerService as any).getSavedConnectionNodes();

        // Verify the result - should have filtered duplicates
        expect(result).to.be.an("array").with.lengthOf(2);

        // Verify the map was used properly - only unique IDs should remain
        const resultIds = new Set(result.map((node: ConnectionNode) => node.connectionProfile.id));
        expect(resultIds.size).to.equal(2);
        expect(resultIds.has("conn1")).to.be.true;
        expect(resultIds.has("conn2")).to.be.true;

        // Verify the logger was called for the duplicate
        expect(mockLogger.verbose.calledOnce).to.be.true;
        expect(mockLogger.verbose.firstCall.args[0]).to.include(
            "Duplicate connection ID found: conn1",
        );
    });

    test("rootNodeConnections should return empty array when no root nodes exist", () => {
        // Set up empty root tree node array
        (objectExplorerService as any)._rootTreeNodeArray = [];

        // Call the getter
        const result = objectExplorerService.rootNodeConnections;

        // Verify the result is an empty array
        expect(result).to.be.an("array").that.is.empty;
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
                groupId: "",
            } as IConnectionProfileWithSource,
            {
                id: "conn2",
                server: "server2",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "",
            } as IConnectionProfileWithSource,
        ];

        // Create mock root nodes
        const mockRootNodes: TreeNodeInfo[] = [
            new ConnectionNode(mockProfiles[0]),
            new ConnectionNode(mockProfiles[1]),
        ];

        // Set up the root tree node array
        (objectExplorerService as any)._rootTreeNodeArray = mockRootNodes;

        // Call the getter
        const result = objectExplorerService.rootNodeConnections;

        // Verify the result
        expect(result).to.be.an("array").with.lengthOf(2);
        expect(result[0]).to.deep.equal(mockProfiles[0]);
        expect(result[1]).to.deep.equal(mockProfiles[1]);
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
                groupId: "",
            } as IConnectionProfileWithSource,
            {
                id: "conn2",
                server: "server2",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "",
            } as IConnectionProfileWithSource,
        ];

        // Create mock root nodes
        const mockRootNodes: TreeNodeInfo[] = [
            new ConnectionNode(mockProfiles[0]),
            new ConnectionNode(mockProfiles[1]),
        ];

        // Set up the root tree node array
        (objectExplorerService as any)._rootTreeNodeArray = mockRootNodes;

        // Call the method with the first profile
        const result = (objectExplorerService as any).getConnectionNodeFromProfile(mockProfiles[0]);

        // Verify the result
        expect(result).to.be.instanceOf(ConnectionNode);
        expect(result.connectionProfile).to.deep.equal(mockProfiles[0]);

        // Call the method with a non-existent profile
        const nonExistentProfile = {
            id: "conn3",
            server: "server3",
            database: "db1",
            authenticationType: "Integrated",
            user: "",
            password: "",
            savePassword: false,
            groupId: "",
        } as IConnectionProfileWithSource;
        const resultNonExistent = (objectExplorerService as any).getConnectionNodeFromProfile(
            nonExistentProfile,
        );

        // Verify the result is undefined
        expect(resultNonExistent).to.be.undefined;
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
        expect(result).to.equal("server1_db1_profile1");
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
        expect(result).to.equal("session1");
    });

    test("closeSession should call closeSession on client, disconnectNode and cleanNodeChildren", async () => {
        // Create a mock node
        const mockNode = new ConnectionNode({
            id: "conn1",
            server: "server1",
            database: "db1",
            authenticationType: "Integrated",
        } as IConnectionProfile);

        const nodeChildren = [
            {
                id: "child1",
                connectionProfile: {
                    id: "child1",
                    server: "server1",
                    database: "db1",
                    authenticationType: "Integrated",
                },
                sessionId: "session1",
            } as TreeNodeInfo,
        ];

        mockNode.sessionId = "session1";

        (objectExplorerService as any)._rootTreeNodeArray = [mockNode];
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
        expect(mockClient.sendRequest.calledOnce).to.be.true;
        expect(mockClient.sendRequest.firstCall.args[0]).to.equal(CloseSessionRequest.type);
        expect((mockClient.sendRequest.firstCall.args[1] as ConnectionNode).sessionId).to.equal(
            "session1",
        );

        // Verify that disconnectNode was called
        expect(mockConnectionManager.disconnect.calledOnce).to.be.true;
        expect(mockConnectionManager.disconnect.firstCall.args[0]).to.equal("session1");

        // Verify that node and its children were removed from the map
        expect((objectExplorerService as any)._treeNodeToChildrenMap.has(mockNode)).to.be.false;
        expect((objectExplorerService as any)._treeNodeToChildrenMap.has(nodeChildren[0])).to.be
            .false;

        // Root tree node array should still contain the node
        expect((objectExplorerService as any)._rootTreeNodeArray).to.include(mockNode);
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
        const pendingExpand = (objectExplorerService as any)._pendingExpands.get(pendingExpandKey);
        expect(pendingExpand).to.exist;
        pendingExpand.resolve(mockExpandResponse);

        // Wait for the expandNode promise to resolve
        const result = await expandPromise;

        // Verify the result
        expect(result).to.be.true;

        // Verify telemetry was started correctly
        expect(startActivityStub.calledOnce).to.be.true;
        expect(startActivityStub.args[0][0]).to.equal(TelemetryViews.ObjectExplorer);
        expect(startActivityStub.args[0][1]).to.equal(TelemetryActions.ExpandNode);

        // Verify logging
        expect(mockLogger.verbose.called).to.be.true;

        // Verify the request was sent correctly
        expect(mockClient.sendRequest.calledOnce).to.be.true;
        expect(mockClient.sendRequest.args[0][0]).to.equal(ExpandRequest.type);
        expect(mockClient.sendRequest.args[0][1]).to.deep.equal({
            sessionId: mockSessionId,
            nodePath: mockNode.nodePath,
            filters: mockNode.filters,
        });

        // Verify the children were mapped correctly
        const mappedChildren = (objectExplorerService as any)._treeNodeToChildrenMap.get(mockNode);
        expect(mappedChildren).to.exist;
        expect(mappedChildren.length).to.equal(2);
        expect(mappedChildren[0].label).to.equal("child1");
        expect(mappedChildren[1].label).to.equal("child2");

        // Verify telemetry was ended correctly
        expect(endStub.calledOnce).to.be.true;
        expect(endStub.args[0][0]).to.equal(ActivityStatus.Succeeded);
        expect(endStub.args[0][2].childrenCount).to.equal(2);

        // Verify the promise was resolved with the children
        const resolvedChildren = await mockPromise;
        expect(resolvedChildren).to.equal(mappedChildren);

        // Verify shouldRefresh was reset
        expect(mockNode.shouldRefresh).to.be.false;
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
        const pendingExpand = (objectExplorerService as any)._pendingExpands.get(pendingExpandKey);
        expect(pendingExpand).to.exist;
        pendingExpand.resolve(mockRefreshResponse);

        // Wait for the expandNode promise to resolve
        const result = await expandPromise;

        // Verify the result
        expect(result).to.be.true;

        // Verify the RefreshRequest was used instead of ExpandRequest
        expect(mockClient.sendRequest.calledOnce).to.be.true;
        expect(mockClient.sendRequest.args[0][0]).to.equal(RefreshRequest.type);

        // Verify shouldRefresh was reset to false
        expect(mockNode.shouldRefresh).to.be.false;
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
        const pendingExpand = (objectExplorerService as any)._pendingExpands.get(pendingExpandKey);
        expect(pendingExpand).to.exist;
        pendingExpand.resolve(mockExpandResponse);

        // Wait for the expandNode promise to resolve
        const result = await expandPromise;

        // Verify the result (should still be true because we received a response)
        expect(result).to.be.true;

        // Verify error was logged
        expect(mockLogger.error.called).to.be.true;
        expect(mockLogger.error.args[0][0]).to.include(mockErrorMessage);

        // Verify error message was shown to user
        expect(mockVscodeWrapper.showErrorMessage.calledOnce).to.be.true;
        expect(mockVscodeWrapper.showErrorMessage.args[0][0]).to.equal(mockErrorMessage);

        // Verify an error node was created and set as the only child
        const mappedChildren = (objectExplorerService as any)._treeNodeToChildrenMap.get(mockNode);
        expect(mappedChildren).to.exist;
        expect(mappedChildren.length).to.equal(1);
        expect(mappedChildren[0]).to.be.instanceOf(ExpandErrorNode);
        expect((mappedChildren[0] as ExpandErrorNode).tooltip).to.equal(mockErrorMessage);

        // Verify telemetry was ended with failure
        expect(endFailedStub.calledOnce).to.be.true;
        expect(endFailedStub.args[0][0].message).to.equal(mockErrorMessage);

        // Verify the promise was resolved with the error node
        const resolvedChildren = await mockPromise;
        expect(resolvedChildren[0]).to.be.instanceOf(ExpandErrorNode);
        expect((resolvedChildren[0] as ExpandErrorNode).tooltip).to.equal(mockErrorMessage);
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
        const pendingExpand = (objectExplorerService as any)._pendingExpands.get(pendingExpandKey);
        expect(pendingExpand).to.exist;
        pendingExpand.resolve(undefined);

        // Wait for the expandNode promise to resolve
        const result = await expandPromise;

        // Verify the result (should be undefined)
        expect(result).to.be.undefined;

        // Verify the promise was resolved with undefined
        const resolvedChildren = await mockPromise;
        expect(resolvedChildren).to.be.undefined;
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
        const result = await objectExplorerService.expandNode(mockNode, mockSessionId, mockPromise);

        // Verify the result (should be undefined)
        expect(result).to.be.undefined;

        // Verify error message was shown to user
        expect(mockVscodeWrapper.showErrorMessage.calledOnce).to.be.true;
        expect(mockVscodeWrapper.showErrorMessage.args[0][0]).to.equal(
            LocalizedConstants.msgUnableToExpand,
        );

        // Verify the promise was resolved with undefined
        const resolvedChildren = await mockPromise;
        expect(resolvedChildren).to.be.undefined;
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
            expect(e).to.equal(testError);
        }
    });

    test("prepareConnectionProfile should create a new connection profile if none is provided", async () => {
        // Create a mock connection profile that would be returned by the UI
        const mockProfile: IConnectionProfile = {
            id: "existing-id",
            server: "testServer",
            database: "testDB",
            authenticationType: "SqlLogin",
            user: "testUser",
            password: "testPassword",
            savePassword: true,
        } as IConnectionProfile;

        // Setup connection UI to return the mock profile
        mockConnectionUI.createAndSaveProfile.resolves(mockProfile);
        mockConnectionManager.getServerInfo.returns({ serverVersion: "12.0.0" } as IServerInfo);

        // Call the method with undefined connection info
        const result = await (objectExplorerService as any).prepareConnectionProfile(undefined);

        // Verify the result matches the mock profile
        expect(result).to.deep.equal(mockProfile);

        // Verify connection UI was called
        expect(mockConnectionUI.createAndSaveProfile.calledOnce).to.be.true;

        // Verify telemetry was sent
        expect(sendActionEventStub.calledOnce).to.be.true;
        expect(sendActionEventStub.args[0][0]).to.equal(TelemetryViews.ObjectExplorer);
        expect(sendActionEventStub.args[0][1]).to.equal(TelemetryActions.CreateConnection);
    });

    test("prepareConnectionProfile should return undefined if user cancels profile creation", async () => {
        // Setup connection UI to return undefined (user canceled)
        mockConnectionUI.createAndSaveProfile.resolves(undefined);

        // Call the method with undefined connection info
        const result = await (objectExplorerService as any).prepareConnectionProfile(undefined);

        // Verify the result is undefined
        expect(result).to.be.undefined;

        // Verify connection UI was called
        expect(mockConnectionUI.createAndSaveProfile.calledOnce).to.be.true;
    });

    test("prepareConnectionProfile should generate a GUID if id is missing", async () => {
        // Create a mock connection profile without an ID
        const mockProfile: IConnectionProfile = {
            server: "testServer",
            database: "testDB",
            authenticationType: "SqlLogin",
            user: "testUser",
            password: "testPassword",
            savePassword: true,
        } as IConnectionProfile;

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result has the generated GUID
        expect(result.id).to.equal("mock-guid-12345");

        // Verify Utils.generateGuid was called
        expect(mockGenerateGuidStub.calledOnce).to.be.true;
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
        const expectedConnectionString = "Server=testServer;Database=testDB;Password=myPassword;";
        mockConnectionStore.lookupPassword.resolves(expectedConnectionString);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result has the updated connection string
        expect(result.connectionString).to.equal(expectedConnectionString);

        // Verify connection store was called with correct parameters
        expect(mockConnectionStore.lookupPassword.calledOnce).to.be.true;
        expect(mockConnectionStore.lookupPassword.args[0][0]).to.equal(mockProfile);
        expect(mockConnectionStore.lookupPassword.args[0][1]).to.be.true; // isConnectionString = true
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
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is undefined
        expect(result).to.be.undefined;

        // Verify connection store was NOT called
        expect(mockConnectionStore.lookupPassword.called).to.be.false;
    });

    test("prepareConnectionProfile should handle SQL Login with saved password", async () => {
        // Create a mock SQL Login profile with empty password but savePassword=true
        const mockProfile: IConnectionProfile = {
            id: "test-id",
            server: "testServer",
            database: "testDB",
            authenticationType: "SqlLogin",
            user: "testUser",
            password: "", // Empty password
            savePassword: true,
        } as IConnectionProfile;

        // Setup connection store to return a saved password
        const savedPassword = "savedPassword123";
        mockConnectionStore.lookupPassword.resolves(savedPassword);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result has the saved password
        expect(result.password).to.equal(savedPassword);

        // Verify connection store was called with correct parameters
        expect(mockConnectionStore.lookupPassword.calledOnce).to.be.true;
        expect(mockConnectionStore.lookupPassword.args[0][0]).to.equal(mockProfile);
        expect(mockConnectionStore.lookupPassword.args[0][1]).to.be.undefined; // isConnectionString = undefined

        // Verify user was NOT prompted for password
        expect(mockConnectionUI.promptForPassword.called).to.be.false;
    });

    test("prepareConnectionProfile should prompt for password for SQL Login with no saved password", async () => {
        // Create a mock SQL Login profile with empty password and savePassword=false
        const mockProfile: IConnectionProfile = {
            id: "test-id",
            server: "testServer",
            database: "testDB",
            authenticationType: "SqlLogin",
            user: "testUser",
            password: "", // Empty password
            savePassword: false,
        } as IConnectionProfile;

        // Setup connection store to return undefined (no saved password)
        mockConnectionStore.lookupPassword.resolves(undefined);

        // Setup connection UI to return a password when prompted
        const promptedPassword = "promptedPassword123";
        mockConnectionUI.promptForPassword.resolves(promptedPassword);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result has the prompted password
        expect(result.password).to.equal(promptedPassword);

        // Verify connection store was NOT called (since savePassword=false)
        expect(mockConnectionStore.lookupPassword.called).to.be.false;

        // Verify user was prompted for password
        expect(mockConnectionUI.promptForPassword.calledOnce).to.be.true;

        // Verify Azure account token was cleared
        expect(result.azureAccountToken).to.be.undefined;
    });

    test("prepareConnectionProfile should return undefined if user cancels password prompt", async () => {
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

        // Setup connection UI to return undefined when prompted (user canceled)
        mockConnectionUI.promptForPassword.resolves(undefined);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is undefined
        expect(result).to.be.undefined;

        // Verify user was prompted for password
        expect(mockConnectionUI.promptForPassword.calledOnce).to.be.true;
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

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is correct
        expect(result).to.exist;
        expect(result.id).to.equal("test-id");
        expect(result.server).to.equal("testServer");

        // Verify Azure account token was cleared
        expect(result.azureAccountToken).to.be.undefined;

        // Verify password lookup and prompts were NOT called
        expect(mockConnectionStore.lookupPassword.called).to.be.false;
        expect(mockConnectionUI.promptForPassword.called).to.be.false;
    });

    test("prepareConnectionProfile should handle Azure MFA with account in cache", async () => {
        (objectExplorerService as any).refreshAccount = sandbox.stub();
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
        mockAccountStore.getAccount.withArgs("account-id").returns(mockAccount);

        // Setup Azure controller
        mockAzureController.isSqlAuthProviderEnabled.returns(true);
        mockAzureController.isAccountInCache.withArgs(mockAccount).resolves(true);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is correct
        expect(result).to.exist;
        expect(result.id).to.equal("test-id");
        expect(result.server).to.equal("testServer");
        expect(result.user).to.equal("Test User");
        expect(result.email).to.equal("test@example.com");
        expect(result.azureAccountToken).to.equal("existing-token");

        // Verify account store was called
        expect(mockAccountStore.getAccount.calledOnce).to.be.true;

        // Verify Azure controller methods were called
        expect(mockAzureController.isSqlAuthProviderEnabled.calledOnce).to.be.true;
        expect(mockAzureController.isAccountInCache.calledOnce).to.be.true;

        // Verify profile was saved after updating user/email
        expect(mockConnectionUI.saveProfile.calledOnce).to.be.true;
        expect(mockConnectionUI.saveProfile.args[0][0]).to.equal(result);

        // Verify refreshAccount was NOT called (no refresh needed)
        expect((objectExplorerService as any).refreshAccount.called).to.be.false;
    });

    test("prepareConnectionProfile should refresh account for Azure MFA with account not in cache", async () => {
        (objectExplorerService as any).refreshAccount = sandbox.stub();

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
        mockAccountStore.getAccount.withArgs("account-id").returns(mockAccount);

        // Setup Azure controller - account NOT in cache
        mockAzureController.isSqlAuthProviderEnabled.returns(true);
        mockAzureController.isAccountInCache.withArgs(mockAccount).resolves(false);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is correct
        expect(result).to.exist;
        expect(result.id).to.equal("test-id");
        expect(result.server).to.equal("testServer");
        expect(result.user).to.equal("Test User");
        expect(result.email).to.equal("test@example.com");

        // Verify refreshAccount was called since account not in cache
        expect((objectExplorerService as any).refreshAccount.calledOnce).to.be.true;
        expect((objectExplorerService as any).refreshAccount.args[0][0]).to.equal(mockAccount);
        expect((objectExplorerService as any).refreshAccount.args[0][1]).to.equal(result);
    });

    test("prepareConnectionProfile should refresh account for Azure MFA when account not found", async () => {
        (objectExplorerService as any).refreshAccount = sandbox.stub();

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

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is correct
        expect(result).to.exist;
        expect(result.id).to.equal("test-id");
        expect(result.server).to.equal("testServer");

        // Verify refreshAccount was called with undefined account
        expect((objectExplorerService as any).refreshAccount.calledOnce).to.be.true;
        expect((objectExplorerService as any).refreshAccount.args[0][0]).to.be.undefined;
        expect((objectExplorerService as any).refreshAccount.args[0][1]).to.equal(result);
    });

    test("prepareConnectionProfile should handle Azure MFA when SQL auth provider disabled", async () => {
        (objectExplorerService as any).refreshAccount = sandbox.stub();

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
        mockAccountStore.getAccount.withArgs("account-id").returns(mockAccount);

        // Setup Azure controller - SQL auth provider disabled
        mockAzureController.isSqlAuthProviderEnabled.returns(false);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is correct
        expect(result).to.exist;
        expect(result.id).to.equal("test-id");
        expect(result.server).to.equal("testServer");

        // User and email should NOT be set since SQL auth provider is disabled
        expect(result.user).to.be.undefined;
        expect(result.email).to.be.undefined;

        // Verify saveProfile was NOT called
        expect(mockConnectionUI.saveProfile.called).to.be.false;

        // Verify refreshAccount was called
        expect((objectExplorerService as any).refreshAccount.calledOnce).to.be.true;
    });

    test("prepareConnectionProfile should not refresh Azure MFA account if token exists", async () => {
        (objectExplorerService as any).refreshAccount = sandbox.stub();
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
        mockAccountStore.getAccount.withArgs("account-id").returns(mockAccount);

        // Setup Azure controller - SQL auth provider enabled, account in cache
        mockAzureController.isSqlAuthProviderEnabled.returns(true);
        mockAzureController.isAccountInCache.withArgs(mockAccount).resolves(true);

        // Call the method with the mock profile
        const result = await (objectExplorerService as any).prepareConnectionProfile(mockProfile);

        // Verify the result is correct
        expect(result).to.exist;
        expect(result.id).to.equal("test-id");
        expect(result.server).to.equal("testServer");
        expect(result.azureAccountToken).to.equal("existing-token");

        // Verify refreshAccount was NOT called since token already exists
        expect((objectExplorerService as any).refreshAccount.called).to.be.false;
    });
});
