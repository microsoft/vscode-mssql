/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";
import { ObjectExplorerService } from "../../src/objectExplorer/objectExplorerService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { expect, assert } from "chai";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { AddConnectionTreeNode } from "../../src/objectExplorer/nodes/addConnectionTreeNode";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { AccountSignInTreeNode } from "../../src/objectExplorer/nodes/accountSignInTreeNode";
import { ConnectTreeNode } from "../../src/objectExplorer/nodes/connectTreeNode";
import { NodeInfo } from "../../src/models/contracts/objectExplorer/nodeInfo";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IConnectionInfo } from "vscode-mssql";
import { IConnectionProfile } from "../../src/models/interfaces";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { ConnectionGroupNode } from "../../src/objectExplorer/nodes/connectionGroupNode";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { initializeIconUtils } from "./utils";

suite("Object Explorer Provider Tests", function () {
    let objectExplorerService: TypeMoq.IMock<ObjectExplorerService>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let objectExplorerProvider: ObjectExplorerProvider;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let outputChannel: TypeMoq.IMock<vscode.OutputChannel>;
    let testObjectExplorerService: ObjectExplorerService;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;

    setup(() => {
        initializeIconUtils();
        let mockContext: TypeMoq.IMock<vscode.ExtensionContext> =
            TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );
        connectionManager.setup((c) => c.client).returns(() => client.object);
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        client.setup((c) => c.onNotification(TypeMoq.It.isAny(), TypeMoq.It.isAny()));
        connectionManager.object.client = client.object;

        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);

        vscodeWrapper.setup((v) => v.showErrorMessage(TypeMoq.It.isAnyString()));

        outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        outputChannel.setup((c) => c.clear());
        outputChannel.setup((c) => c.append(TypeMoq.It.isAny()));
        outputChannel.setup((c) => c.show(TypeMoq.It.isAny()));

        vscodeWrapper.setup((v) => v.outputChannel).returns(() => outputChannel.object);

        connectionManager.setup((c) => c.vscodeWrapper).returns(() => vscodeWrapper.object);
        connectionManager.object.vscodeWrapper = vscodeWrapper.object;

        connectionStore = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );

        connectionStore.setup((c) => c.rootGroupId).returns(() => "root-group-id");

        connectionManager.setup((cm) => cm.connectionStore).returns(() => connectionStore.object);

        objectExplorerProvider = new ObjectExplorerProvider(
            vscodeWrapper.object,
            connectionManager.object,
        );
        expect(
            objectExplorerProvider,
            "Object Explorer Provider is initialzied properly",
        ).is.not.equal(undefined);

        objectExplorerService = TypeMoq.Mock.ofType(
            ObjectExplorerService,
            TypeMoq.MockBehavior.Loose,
            vscodeWrapper.object,
            connectionManager.object,
        );
        //objectExplorerService.setup((s) => s.currentNode).returns(() => undefined);
        objectExplorerProvider.objectExplorerService = objectExplorerService.object;

        testObjectExplorerService = new ObjectExplorerService(
            vscodeWrapper.object,
            connectionManager.object,
            () => {},
        );
    });

    // TODO: @aasimkhan30 Fix this test
    // // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    // test.skip("Test Create Session", () => {
    //     expect(
    //         objectExplorerService.object.currentNode,
    //         "Current Node should be undefined",
    //     ).is.equal(undefined);
    //     expect(
    //         objectExplorerProvider.objectExplorerExists,
    //         "Object Explorer should not exist until started",
    //     ).is.equal(undefined);
    //     const promise = new Deferred<TreeNodeInfo>();
    //     objectExplorerService
    //         .setup((s) => s.createSession(promise, undefined))
    //         .returns(() => {
    //             return new Promise((resolve, reject) => {
    //                 objectExplorerService
    //                     .setup((s) => s.currentNode)
    //                     .returns(() => TypeMoq.It.isAny());
    //                 objectExplorerProvider.objectExplorerExists = true;
    //                 promise.resolve(
    //                     new TreeNodeInfo(
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                         undefined,
    //                     ),
    //                 );
    //             });
    //         });
    //     void objectExplorerProvider.createSession(promise, undefined).then(async () => {
    //         expect(
    //             objectExplorerService.object.currentNode,
    //             "Current Node should not be undefined",
    //         ).is.not.equal(undefined);
    //         expect(
    //             objectExplorerProvider.objectExplorerExists,
    //             "Object Explorer session should exist",
    //         ).is.equal(true);
    //         let node = await promise;
    //         expect(node, "Created session node not be undefined").is.not.equal(undefined);
    //     });
    // });

    test("Test remove Object Explorer node", async () => {
        let isNodeDeleted = false;
        objectExplorerService
            .setup((s) => s.removeNode(TypeMoq.It.isAny()))
            .returns(() => {
                isNodeDeleted = true;
                return Promise.resolve(undefined);
            });
        await objectExplorerProvider.removeNode(TypeMoq.It.isAny());
        expect(isNodeDeleted, "Node should be deleted").is.equal(true);
    });

    test("Test Get Children from Object Explorer Provider", (done) => {
        const parentTreeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        const childTreeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        objectExplorerService
            .setup((s) => s.getChildren(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([childTreeNode.object]));
        void objectExplorerProvider.getChildren(parentTreeNode.object).then((children) => {
            children.forEach((child) =>
                expect(child, "Children nodes should not be undefined").is.not.equal(undefined),
            );
        });
        done();
    });

    test("Test Get Children from Object Explorer Provider with no children", async () => {
        const parentTreeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);

        const expandNodeSpy = TypeMoq.Mock.ofInstance((element, sessionId) =>
            testObjectExplorerService.expandNode(element, sessionId),
        );

        expandNodeSpy
            .setup((e) => e(TypeMoq.It.isAny(), TypeMoq.It.isAnyString()))
            .returns(() => Promise.resolve([]));

        testObjectExplorerService.expandNode = expandNodeSpy.object;

        parentTreeNode.setup((s) => s.sessionId).returns(() => "test_session");

        let children = await testObjectExplorerService.getChildren(parentTreeNode.object);
        expect(children.length, "loading node should be returned").is.equal(1);
        expect(children[0].label, "Should return loading node").is.equal(
            LocalizedConstants.ObjectExplorer.LoadingNodeLabel,
        );

        await new Promise((resolve) => setTimeout(resolve, 100));

        children = await testObjectExplorerService.getChildren(parentTreeNode.object);
        expect(children.length, "No items nodes should be returned").is.equal(1);
        expect(children[0].label, "should return No items node").is.equal(
            LocalizedConstants.ObjectExplorer.NoItems,
        );
    });

    test("Test server nodes sorting mechanism", () => {
        const connectionNode1 = new ConnectionNode({
            id: "test_id",
            profileName: "test_profile",
        } as ConnectionProfile);
        const connectionNode2 = new ConnectionNode({
            id: "test_id_2",
            profileName: "test_profile_2",
        } as ConnectionProfile);
        const connectionNode3 = new ConnectionNode({
            id: "test_id_3",
            profileName: "test_profile_3",
        } as ConnectionProfile);

        const sortedNodes = testObjectExplorerService.sortByServerName([
            connectionNode3,
            connectionNode1,
            connectionNode2,
        ]);

        expect(sortedNodes[0].label, "First node should be the one with the lowest name").is.equal(
            connectionNode1.label,
        );
        expect(
            sortedNodes[1].label,
            "Second node should be the one with the second lowest name",
        ).is.equal(connectionNode2.label);
        expect(sortedNodes[2].label, "Third node should be the one with the highest name").is.equal(
            connectionNode3.label,
        );
    });

    test("Test addConnectionNode", () => {
        const rootNode = new ConnectionGroupNode({
            id: "root-group-id",
            name: ConnectionConfig.RootGroupName,
        });
        const connectionNode1 = new ConnectionNode(
            {
                id: "test_id",
                profileName: "test_profile",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );
        const connectionNode2 = new ConnectionNode(
            {
                id: "test_id_2",
                profileName: "test_profile_2",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );
        const connectionNode3 = new ConnectionNode(
            {
                id: "test_id_3",
                profileName: "test_profile_3",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );

        rootNode.addChild(connectionNode1);
        rootNode.addChild(connectionNode2);
        rootNode.addChild(connectionNode3);

        (testObjectExplorerService as any)._connectionGroupNodes = new Map<
            string,
            ConnectionGroupNode
        >([[rootNode.connectionGroup.id, rootNode]]);

        (testObjectExplorerService as any)._connectionNodes = new Map<string, ConnectionNode>([
            [connectionNode1.connectionProfile.id, connectionNode1],
            [connectionNode2.connectionProfile.id, connectionNode2],
            [connectionNode3.connectionProfile.id, connectionNode3],
        ]);

        const newConnectionNode = new ConnectionNode(
            {
                id: "test_id_4",
                profileName: "test_profile_4",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );
        (testObjectExplorerService as any).addConnectionNode(newConnectionNode);
        const rootTreeNodeArray = (testObjectExplorerService as any)._rootTreeNodeArray;
        // RootTreeNode should have a length of 4
        expect(rootTreeNodeArray.length, "RootTreeNode should have a length of 4").is.equal(4);
        expect(
            rootTreeNodeArray[3].label,
            "New connection node should be added at the end of the array",
        ).is.equal(newConnectionNode.label);

        const newConnectionNode2 = new ConnectionNode(
            {
                id: "test_id_2",
                profileName: "test_profile_2_renamed",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );

        (testObjectExplorerService as any).addConnectionNode(newConnectionNode2);
        const rootTreeNodeArray2 = (testObjectExplorerService as any)._rootTreeNodeArray;
        // RootTreeNode should have a length of 4
        expect(rootTreeNodeArray2.length, "RootTreeNode should have a length of 4").is.equal(4);
        expect(
            rootTreeNodeArray2[1].label,
            "New connection node should be added at the end of the array",
        ).is.equal(newConnectionNode2.label);
    });

    test("Test expandNode function", () => {
        objectExplorerService.setup((s) =>
            s.expandNode(TypeMoq.It.isAny(), TypeMoq.It.isAnyString()),
        );
        let node: any = {
            connectionCredentials: undefined,
        };
        void objectExplorerProvider.expandNode(node, "test_session");
        objectExplorerService.verify(
            (s) => s.expandNode(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
        let treeItem = objectExplorerProvider.getTreeItem(node);
        assert.equal(treeItem, node);
    });

    // TODO: Readd these test
    // const mockParentTreeNode = new TreeNodeInfo(
    //     "Parent Node",
    //     undefined,
    //     undefined,
    //     "parentNodePath",
    //     undefined,
    //     undefined,
    //     undefined,
    //     undefined,
    //     undefined,
    //     undefined,
    // );

    // test("Test handleExpandSessionNotification returns child nodes upon success", async function () {
    //     const childNodeInfo: NodeInfo = {
    //         nodePath: `${mockParentTreeNode.nodePath}/childNodePath`,
    //         nodeStatus: undefined,
    //         nodeSubType: undefined,
    //         nodeType: undefined,
    //         label: "Child Node",
    //         isLeaf: true,
    //         errorMessage: undefined,
    //         metadata: undefined,
    //     };

    //     const mockExpandResponse: ExpandResponse = {
    //         sessionId: "test_session",
    //         nodePath: mockParentTreeNode.nodePath,
    //         nodes: [childNodeInfo],
    //         errorMessage: undefined,
    //     };

    //     const testOeService = new ObjectExplorerService(
    //         vscodeWrapper.object,
    //         connectionManager.object,
    //         objectExplorerProvider,
    //     );

    //     let notificationObject = testOeService.handleExpandSessionNotification();

    //     const expandParams: ExpandParams = {
    //         sessionId: mockExpandResponse.sessionId,
    //         nodePath: mockExpandResponse.nodePath,
    //     };

    //     testOeService["_expandParamsToTreeNodeInfoMap"].set(expandParams, mockParentTreeNode);

    //     testOeService["_sessionIdToConnectionProfileMap"].set(
    //         mockExpandResponse.sessionId,
    //         undefined,
    //     );

    //     const outputPromise = new Deferred<TreeNodeInfo[]>();

    //     testOeService["_expandParamsToPromiseMap"].set(expandParams, outputPromise);

    //     notificationObject.call(testOeService, mockExpandResponse);

    //     const childNodes = await outputPromise;
    //     assert.equal(childNodes.length, 1, "Child nodes length");
    //     assert.equal(childNodes[0].label, childNodeInfo.label, "Child node label");
    //     assert.equal(childNodes[0].nodePath, childNodeInfo.nodePath, "Child node path");
    // });

    // test("Test handleExpandSessionNotification returns message node upon failure", async function () {
    //     this.timeout(0);

    //     const mockExpandResponse: ExpandResponse = {
    //         sessionId: "test_session",
    //         nodePath: mockParentTreeNode.nodePath,
    //         nodes: [],
    //         errorMessage: "Error occurred when expanding node",
    //     };

    //     const testOeService = new ObjectExplorerService(
    //         vscodeWrapper.object,
    //         connectionManager.object,
    //         objectExplorerProvider,
    //     );

    //     let notificationObject = testOeService.handleExpandSessionNotification();

    //     const expandParams: ExpandParams = {
    //         sessionId: mockExpandResponse.sessionId,
    //         nodePath: mockExpandResponse.nodePath,
    //     };

    //     testOeService["_expandParamsToTreeNodeInfoMap"].set(expandParams, mockParentTreeNode);

    //     testOeService["_sessionIdToConnectionProfileMap"].set(
    //         mockExpandResponse.sessionId,
    //         undefined,
    //     );

    //     const outputPromise = new Deferred<TreeNodeInfo[]>();

    //     testOeService["_expandParamsToPromiseMap"].set(expandParams, outputPromise);

    //     notificationObject.call(testOeService, mockExpandResponse);

    //     const childNodes = await outputPromise;

    //     vscodeWrapper.verify(
    //         (x) => x.showErrorMessage(mockExpandResponse.errorMessage),
    //         TypeMoq.Times.once(),
    //     );

    //     assert.equal(childNodes.length, 1, "Child nodes length");
    //     assert.equal(
    //         childNodes[0].label,
    //         "Error loading; refresh to try again",
    //         "Error node label",
    //     );
    //     assert.equal(childNodes[0].tooltip, mockExpandResponse.errorMessage, "Error node tooltip");
    // });

    // test("Test signInNode function", () => {
    //     objectExplorerService.setup((s) => s.signInNodeServer(TypeMoq.It.isAny()));
    //     let node: any = {
    //         connectionCredentials: undefined,
    //     };
    //     objectExplorerProvider.signInNodeServer(node);
    //     objectExplorerService.verify(
    //         (s) => s.signInNodeServer(TypeMoq.It.isAny()),
    //         TypeMoq.Times.once(),
    //     );
    // });

    // test("Test updateNode function", () => {
    //     objectExplorerService.setup((s) => s.updateNode(TypeMoq.It.isAny()));
    //     let node: any = {
    //         connectionCredentials: undefined,
    //     };
    //     objectExplorerProvider.updateNode(node);
    //     objectExplorerService.verify((s) => s.updateNode(node), TypeMoq.Times.once());
    // });

    test("Test removeConnectionNodes function", () => {
        objectExplorerService.setup((s) => s.removeConnectionNodes(TypeMoq.It.isAny()));
        let connections: any[] = [{ server: "test_server" }];
        void objectExplorerProvider.removeConnectionNodes(connections);
        objectExplorerService.verify(
            (s) => s.removeConnectionNodes(connections),
            TypeMoq.Times.once(),
        );
    });

    test("Test addDisconnectedNode function", () => {
        objectExplorerService.setup((s) => s.addDisconnectedNode(TypeMoq.It.isAny()));
        let connectionCredentials: any = { server: "test_server" };
        objectExplorerProvider.addDisconnectedNode(connectionCredentials);
        objectExplorerService.verify(
            (s) => s.addDisconnectedNode(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("Test rootNodeConnections getter", () => {
        let testConnections = [new ConnectionProfile()];
        objectExplorerService.setup((s) => s.connections).returns(() => testConnections);
        let rootConnections = objectExplorerProvider.connections;
        objectExplorerService.verify((s) => s.connections, TypeMoq.Times.once());
        assert.equal(rootConnections, testConnections);
    });
});

suite("Object Explorer Node Types Test", () => {
    test("Test Add Connection Tree Node", () => {
        const addConnectionTreeNode = new AddConnectionTreeNode();
        expect(addConnectionTreeNode.label, "Label should be the same as constant").is.equal(
            LocalizedConstants.msgAddConnection,
        );
        expect(
            addConnectionTreeNode.command,
            "Add Connection Tree Node has a dedicated command",
        ).is.not.equal(undefined);
        expect(addConnectionTreeNode.iconPath, "Add Connection Tree Node has an icon").is.not.equal(
            undefined,
        );
        expect(
            addConnectionTreeNode.collapsibleState,
            "Add Connection Tree Node should have no collapsible state",
        ).is.equal(vscode.TreeItemCollapsibleState.None);
    });

    test("Test Account Sign In Tree Node", () => {
        const parentTreeNode = new TreeNodeInfo(
            "parent",
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
        const accountSignInNode = new AccountSignInTreeNode(parentTreeNode);
        expect(accountSignInNode.label, "Label should be the same as constant").is.equal(
            LocalizedConstants.msgConnect,
        );
        expect(
            accountSignInNode.command,
            "Account Sign In Node has a dedicated command",
        ).is.not.equal(undefined);
        expect(
            accountSignInNode.parentNode,
            "Account Sign In Node should have a parent",
        ).is.not.equal(undefined);
        expect(
            accountSignInNode.collapsibleState,
            "Account Sign In Node should have no collapsible state",
        ).is.equal(vscode.TreeItemCollapsibleState.None);
    });

    test("Test Connect Tree Node", () => {
        const parentTreeNode = new TreeNodeInfo(
            "parent",
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
        const connectNode = new ConnectTreeNode(parentTreeNode);
        expect(connectNode.label, "Label should be the same as constant").is.equal(
            LocalizedConstants.msgConnect,
        );
        expect(connectNode.command, "Connect Node has a dedicated command").is.not.equal(undefined);
        expect(connectNode.parentNode, "Connect Node should have a parent").is.not.equal(undefined);
        expect(
            connectNode.collapsibleState,
            "Connect Node should have no collapsible state",
        ).is.equal(vscode.TreeItemCollapsibleState.None);
    });

    test("Test getters and setters for Tree Node", () => {
        const treeNode = new TreeNodeInfo(
            "test",
            {
                type: "test_value",
                filterable: false,
                hasFilters: false,
                subType: "",
            },
            vscode.TreeItemCollapsibleState.Collapsed,
            "test_path",
            "test_status",
            "Server",
            "test_session",
            undefined,
            undefined,
            undefined,
            undefined,
        );
        treeNode.nodePath = treeNode.nodePath;
        expect(treeNode.nodePath, "Node path should be equal to expected value").is.equal(
            "test_path",
        );
        treeNode.nodeStatus = treeNode.nodeStatus;
        expect(treeNode.nodeStatus, "Node status should be equal to expected value").is.equal(
            "test_status",
        );
        treeNode.nodeType = treeNode.nodeType;
        expect(treeNode.nodeType, "Node type should be equal to expected value").is.equal("Server");
        treeNode.sessionId = treeNode.sessionId;
        expect(treeNode.sessionId, "Session ID should be equal to expected value").is.equal(
            "test_session",
        );
        treeNode.nodeSubType = treeNode.nodeSubType;
        expect(treeNode.nodeSubType, "Node Sub type should be equal to expected value").is.equal(
            undefined,
        );
        treeNode.isLeaf = false;
        expect(treeNode.isLeaf, "Node should not be a leaf").is.equal(false);
        treeNode.parentNode = treeNode.parentNode;
        expect(treeNode.parentNode, "Parent node should be equal to expected value").is.equal(
            undefined,
        );
        treeNode.updateConnectionProfile(treeNode.connectionProfile);
        expect(
            treeNode.connectionProfile,
            "Connection credentials should be equal to expected value",
        ).is.equal(undefined);
    });

    test("Test fromNodeInfo function", () => {
        const nodeInfo: NodeInfo = {
            nodePath: "test_path",
            nodeStatus: undefined,
            nodeSubType: undefined,
            nodeType: undefined,
            label: "test_node",
            isLeaf: false,
            errorMessage: undefined,
            metadata: undefined,
        };
        const treeNodeInfo = TreeNodeInfo.fromNodeInfo(
            nodeInfo,
            "test_session",
            undefined,
            undefined,
            undefined,
        );
        treeNodeInfo.errorMessage = "test_error";
        expect(treeNodeInfo.nodePath, "Node path should be equal to expected value").is.equal(
            nodeInfo.nodePath,
        );
        expect(treeNodeInfo.nodeStatus, "Node status should be equal to expected value").is.equal(
            nodeInfo.nodeStatus,
        );
        expect(treeNodeInfo.nodeType, "Node type should be equal to expected value").is.equal(
            nodeInfo.nodeType,
        );
        expect(treeNodeInfo.sessionId, "Session ID should be equal to expected value").is.equal(
            "test_session",
        );
        expect(
            treeNodeInfo.nodeSubType,
            "Node Sub type should be equal to expected value",
        ).is.equal(nodeInfo.nodeSubType);
        treeNodeInfo.isLeaf = nodeInfo.isLeaf;
        expect(treeNodeInfo.isLeaf, "Node should not be a leaf").is.equal(nodeInfo.isLeaf);
        expect(treeNodeInfo.parentNode, "Parent node should be equal to expected value").is.equal(
            undefined,
        );
        expect(
            treeNodeInfo.connectionProfile,
            "Connection credentials should be equal to expected value",
        ).is.equal(undefined);
        expect(
            treeNodeInfo.errorMessage,
            "Error message should be equal to expected value",
        ).is.equal("test_error");
        expect(
            treeNodeInfo.metadata,
            "Node metadata should be the same as nodeInfo metadata",
        ).is.equal(nodeInfo.metadata);
    });

    test("Connection Info is not accidentally modified", () => {
        const testConnnectionInfo = {
            server: "test_server",
            database: "test_db",
        } as IConnectionInfo;

        const nodeInfo: NodeInfo = {
            nodePath: "test_path",
            nodeStatus: undefined,
            nodeSubType: undefined,
            nodeType: undefined,
            label: "test_node",
            isLeaf: false,
            errorMessage: undefined,
            metadata: undefined,
        };

        const treeNodeInfo = TreeNodeInfo.fromNodeInfo(
            nodeInfo,
            "test_session",
            undefined,
            testConnnectionInfo as IConnectionProfile,
            undefined,
        );

        const connectionInfo = treeNodeInfo.connectionProfile;
        expect(
            connectionInfo,
            "Connection credentials should be equal to expected value",
        ).to.deep.equal(testConnnectionInfo);

        connectionInfo.server = "modified_server";

        expect(
            treeNodeInfo.connectionProfile.server,
            "Connection credentials should not be modified",
        ).is.equal("test_server");

        treeNodeInfo.updateConnectionProfile(connectionInfo);

        expect(treeNodeInfo.connectionProfile.server, "connectionInfo should be updated").is.equal(
            "modified_server",
        );
    });
});
