/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect, assert } from "chai";

import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";
import { ObjectExplorerService } from "../../src/objectExplorer/objectExplorerService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
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
import { initializeIconUtils, stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("Object Explorer Provider Tests", function () {
    let sandbox: sinon.SinonSandbox;
    let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionManager: ConnectionManager;
    let clientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let objectExplorerProvider: ObjectExplorerProvider;
    let objectExplorerServiceStub: sinon.SinonStubbedInstance<ObjectExplorerService>;
    let testObjectExplorerService: ObjectExplorerService;
    let connectionStore: ConnectionStore;

    const rootGroupId = "root-group-id";

    function createTreeNodeInfo(options?: {
        label?: string;
        nodePath?: string;
        nodeType?: string;
        sessionId?: string;
        nodeStatus?: string;
        parentNode?: TreeNodeInfo;
        connectionProfile?: IConnectionProfile;
        collapsibleState?: vscode.TreeItemCollapsibleState;
    }): TreeNodeInfo {
        const {
            label = "test_node",
            nodePath = "test_path",
            nodeType = "Server",
            sessionId = "test_session",
            nodeStatus = "NeverExpanded",
            parentNode,
            connectionProfile,
            collapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
        } = options || {};

        return new TreeNodeInfo(
            label,
            {
                type: nodeType,
                subType: undefined,
                filterable: false,
                hasFilters: false,
            },
            collapsibleState,
            nodePath,
            nodeStatus,
            nodeType,
            sessionId,
            connectionProfile,
            parentNode,
            [],
            undefined,
        );
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();

        clientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        clientStub.onNotification.returnsThis();

        vscodeWrapperStub = stubVscodeWrapper(sandbox);

        const rootGroup = {
            id: rootGroupId,
            name: ConnectionConfig.RootGroupName,
            parentId: undefined,
            color: undefined,
            description: undefined,
            collapsed: false,
            includeInMRU: true,
            isLocal: true,
        };

        let savedConnections: IConnectionProfile[] = [];

        connectionStore = {
            rootGroupId,
            readAllConnectionGroups: sandbox.stub().resolves([rootGroup]),
            readAllConnections: sandbox.stub().callsFake(async () => savedConnections),
            saveProfile: sandbox.stub().callsFake(async (profile: IConnectionProfile) => {
                savedConnections = [
                    ...savedConnections.filter((c) => c.id !== profile.id),
                    profile,
                ];
                return profile;
            }),
            removeProfile: sandbox.stub().resolves(true),
            incrementSavedProfiles: sandbox.stub(),
            decrementSavedProfiles: sandbox.stub(),
        } as unknown as ConnectionStore;

        connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
        (connectionManagerStub as unknown as { client: SqlToolsServiceClient }).client =
            clientStub as unknown as SqlToolsServiceClient;
        (connectionManagerStub as unknown as { connectionStore: ConnectionStore }).connectionStore =
            connectionStore;
        (connectionManagerStub as unknown as { vscodeWrapper: VscodeWrapper }).vscodeWrapper =
            vscodeWrapperStub as unknown as VscodeWrapper;

        connectionManagerStub.disconnect.resolves();
        connectionManagerStub.connect.resolves(true);
        connectionManagerStub.handlePasswordStorageOnConnect.resolves();
        connectionManagerStub.handleConnectionErrors.resolves(undefined);
        connectionManagerStub.getServerInfo.resolves(undefined);
        connectionManagerStub.isConnected.returns(false);
        connectionManagerStub.isConnecting.returns(false);

        connectionManager = connectionManagerStub as unknown as ConnectionManager;

        objectExplorerProvider = new ObjectExplorerProvider(
            vscodeWrapperStub as unknown as VscodeWrapper,
            connectionManager,
        );
        expect(objectExplorerProvider, "Object Explorer Provider is initialized properly").to.exist;

        objectExplorerServiceStub = sandbox.createStubInstance(ObjectExplorerService);
        objectExplorerProvider.objectExplorerService =
            objectExplorerServiceStub as unknown as ObjectExplorerService;

        testObjectExplorerService = new ObjectExplorerService(
            vscodeWrapperStub as unknown as VscodeWrapper,
            connectionManager,
            () => {
                /* no-op */
            },
        );
        testObjectExplorerService.initialized.resolve();
    });

    teardown(() => {
        sandbox.restore();
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
        objectExplorerServiceStub.removeNode.resolves();
        await objectExplorerProvider.removeNode({} as ConnectionNode);
        expect(objectExplorerServiceStub.removeNode).to.have.been.calledOnce;
    });

    test("Test Get Children from Object Explorer Provider", async () => {
        const parentNode = createTreeNodeInfo();
        const childNode = createTreeNodeInfo({ label: "child" });
        objectExplorerServiceStub.getChildren.resolves([childNode]);

        const children = await objectExplorerProvider.getChildren(parentNode);
        expect(children).to.deep.equal([childNode]);
    });

    test("Test Get Children from Object Explorer Provider with no children", async () => {
        const parentTreeNode = createTreeNodeInfo({
            nodeStatus: "NeverExpanded",
        });

        const expandStub = sandbox.stub(testObjectExplorerService, "expandNode").resolves([]);

        const children = await testObjectExplorerService.getChildren(parentTreeNode);
        expect(children.length, "loading node should be returned").to.equal(1);
        expect(children[0].label, "Should return loading node").to.equal(
            LocalizedConstants.ObjectExplorer.LoadingNodeLabel,
        );

        expect(expandStub).to.have.been.calledOnceWithExactly(
            parentTreeNode,
            parentTreeNode.sessionId,
        );

        await new Promise((resolve) => setTimeout(resolve, 50));

        const noItemsChildren = await testObjectExplorerService.getChildren(parentTreeNode);
        expect(noItemsChildren.length, "No items nodes should be returned").to.equal(1);
        expect(noItemsChildren[0].label, "should return No items node").to.equal(
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

        expect(sortedNodes[0].label, "First node should be the one with the lowest name").to.equal(
            connectionNode1.label,
        );
        expect(
            sortedNodes[1].label,
            "Second node should be the one with the second lowest name",
        ).to.equal(connectionNode2.label);
        expect(sortedNodes[2].label, "Third node should be the one with the highest name").to.equal(
            connectionNode3.label,
        );
    });

    test("Test addConnectionNode", () => {
        const rootNode = new ConnectionGroupNode({
            id: rootGroupId,
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

        (
            testObjectExplorerService as unknown as {
                _connectionGroupNodes: Map<string, ConnectionGroupNode>;
            }
        )._connectionGroupNodes = new Map<string, ConnectionGroupNode>([
            [rootNode.connectionGroup.id, rootNode],
        ]);

        (
            testObjectExplorerService as unknown as {
                _connectionNodes: Map<string, ConnectionNode>;
            }
        )._connectionNodes = new Map<string, ConnectionNode>([
            [connectionNode1.connectionProfile.id, connectionNode1],
            [connectionNode2.connectionProfile.id, connectionNode2],
            [connectionNode3.connectionProfile.id, connectionNode3],
        ]);

        const newConnectionNode = new ConnectionNode(
            {
                id: "test_id_new",
                profileName: "test_profile_new",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );
        (
            testObjectExplorerService as unknown as {
                addConnectionNode: (node: ConnectionNode) => void;
            }
        ).addConnectionNode(newConnectionNode);

        const rootTreeNodeArray = (
            testObjectExplorerService as unknown as {
                _rootTreeNodeArray: TreeNodeInfo[];
            }
        )._rootTreeNodeArray;
        expect(rootTreeNodeArray.length, "RootTreeNode should have a length of 4").to.equal(4);
        expect(
            rootTreeNodeArray[3].label,
            "New connection node should be added at the end of the array",
        ).to.equal(newConnectionNode.label);

        const newConnectionNode2 = new ConnectionNode(
            {
                id: "test_id_2",
                profileName: "test_profile_2_renamed",
                groupId: rootNode.id,
            } as ConnectionProfile,
            rootNode,
        );

        (
            testObjectExplorerService as unknown as {
                addConnectionNode: (node: ConnectionNode) => void;
            }
        ).addConnectionNode(newConnectionNode2);
        const rootTreeNodeArray2 = (
            testObjectExplorerService as unknown as {
                _rootTreeNodeArray: TreeNodeInfo[];
            }
        )._rootTreeNodeArray;
        expect(rootTreeNodeArray2.length, "RootTreeNode should have a length of 4").to.equal(4);
        expect(
            rootTreeNodeArray2[1].label,
            "New connection node should be added at the end of the array",
        ).to.equal(newConnectionNode2.label);
    });

    test("Test expandNode function", async () => {
        objectExplorerServiceStub.expandNode.resolves([]);

        const node = { connectionCredentials: undefined } as unknown as TreeNodeInfo;
        await objectExplorerProvider.expandNode(node, "test_session");

        expect(objectExplorerServiceStub.expandNode).to.have.been.calledOnceWithExactly(
            node,
            "test_session",
        );
        const treeItem = objectExplorerProvider.getTreeItem(node);
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

    test("Test removeConnectionNodes function", async () => {
        objectExplorerServiceStub.removeConnectionNodes.resolves();
        const connections = [{ server: "test_server" } as IConnectionInfo];
        await objectExplorerProvider.removeConnectionNodes(connections);
        expect(objectExplorerServiceStub.removeConnectionNodes).to.have.been.calledOnceWithExactly(
            connections,
        );
    });

    test("Test addDisconnectedNode function", () => {
        const profile = { server: "test_server" } as IConnectionProfile;
        objectExplorerProvider.addDisconnectedNode(profile);
        expect(objectExplorerServiceStub.addDisconnectedNode).to.have.been.calledOnceWithExactly(
            profile,
        );
    });

    test("Test rootNodeConnections getter", () => {
        const expectedConnections: IConnectionProfile[] = [
            createConnectionProfile("id1", "profile1"),
            createConnectionProfile("id2", "profile2"),
        ];
        const connectionsGetter = sandbox.stub().returns(expectedConnections);
        Object.defineProperty(objectExplorerServiceStub, "connections", {
            get: connectionsGetter,
        });

        const rootConnections = objectExplorerProvider.connections;

        expect(connectionsGetter).to.have.been.calledOnce;
        expect(rootConnections).to.equal(expectedConnections);
    });

    suite("Object Explorer Node Types Test", () => {
        test("Test Add Connection Tree Node", () => {
            const addConnectionTreeNode = new AddConnectionTreeNode();
            expect(addConnectionTreeNode.label, "Label should be the same as constant").to.equal(
                LocalizedConstants.msgAddConnection,
            );
            expect(
                addConnectionTreeNode.command,
                "Add Connection Tree Node has a dedicated command",
            ).to.not.equal(undefined);
            expect(
                addConnectionTreeNode.iconPath,
                "Add Connection Tree Node has an icon",
            ).to.not.equal(undefined);
            expect(
                addConnectionTreeNode.collapsibleState,
                "Add Connection Tree Node should have no collapsible state",
            ).to.equal(vscode.TreeItemCollapsibleState.None);
        });

        test("Test Account Sign In Tree Node", () => {
            const parentTreeNode = createTreeNodeInfo({ label: "parent" });
            const accountSignInNode = new AccountSignInTreeNode(parentTreeNode);

            expect(accountSignInNode.label, "Label should be the same as constant").to.equal(
                LocalizedConstants.msgConnect,
            );
            expect(
                accountSignInNode.command,
                "Account Sign In Node has a dedicated command",
            ).to.not.equal(undefined);
            expect(
                accountSignInNode.parentNode,
                "Account Sign In Node should have a parent",
            ).to.equal(parentTreeNode);
            expect(
                accountSignInNode.collapsibleState,
                "Account Sign In Node should have no collapsible state",
            ).to.equal(vscode.TreeItemCollapsibleState.None);
        });

        test("Test Connect Tree Node", () => {
            const parentTreeNode = createTreeNodeInfo({ label: "parent" });
            const connectNode = new ConnectTreeNode(parentTreeNode);

            expect(connectNode.label, "Label should be the same as constant").to.equal(
                LocalizedConstants.msgConnect,
            );
            expect(connectNode.command, "Connect Node has a dedicated command").to.not.equal(
                undefined,
            );
            expect(connectNode.parentNode, "Connect Node should have a parent").to.equal(
                parentTreeNode,
            );
            expect(
                connectNode.collapsibleState,
                "Connect Node should have no collapsible state",
            ).to.equal(vscode.TreeItemCollapsibleState.None);
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
            expect(treeNode.nodePath, "Node path should be equal to expected value").to.equal(
                "test_path",
            );
            treeNode.nodeStatus = treeNode.nodeStatus;
            expect(treeNode.nodeStatus, "Node status should be equal to expected value").to.equal(
                "test_status",
            );
            treeNode.nodeType = treeNode.nodeType;
            expect(treeNode.nodeType, "Node type should be equal to expected value").to.equal(
                "Server",
            );
            treeNode.sessionId = treeNode.sessionId;
            expect(treeNode.sessionId, "Session ID should be equal to expected value").to.equal(
                "test_session",
            );
            treeNode.nodeSubType = treeNode.nodeSubType;
            expect(
                treeNode.nodeSubType,
                "Node Sub type should be equal to expected value",
            ).to.equal(undefined);
            treeNode.isLeaf = false;
            expect(treeNode.isLeaf, "Node should not be a leaf").to.equal(false);
            treeNode.parentNode = treeNode.parentNode;
            expect(treeNode.parentNode, "Parent node should be equal to expected value").to.equal(
                undefined,
            );
            treeNode.updateConnectionProfile(treeNode.connectionProfile);
            expect(
                treeNode.connectionProfile,
                "Connection credentials should be equal to expected value",
            ).to.equal(undefined);
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
            expect(treeNodeInfo.nodePath, "Node path should be equal to expected value").to.equal(
                nodeInfo.nodePath,
            );
            expect(
                treeNodeInfo.nodeStatus,
                "Node status should be equal to expected value",
            ).to.equal(nodeInfo.nodeStatus);
            expect(treeNodeInfo.nodeType, "Node type should be equal to expected value").to.equal(
                nodeInfo.nodeType,
            );
            expect(treeNodeInfo.sessionId, "Session ID should be equal to expected value").to.equal(
                "test_session",
            );
            expect(
                treeNodeInfo.nodeSubType,
                "Node Sub type should be equal to expected value",
            ).to.equal(nodeInfo.nodeSubType);
            treeNodeInfo.isLeaf = nodeInfo.isLeaf;
            expect(treeNodeInfo.isLeaf, "Node should not be a leaf").to.equal(nodeInfo.isLeaf);
            expect(
                treeNodeInfo.parentNode,
                "Parent node should be equal to expected value",
            ).to.equal(undefined);
            expect(
                treeNodeInfo.connectionProfile,
                "Connection credentials should be equal to expected value",
            ).to.equal(undefined);
            expect(
                treeNodeInfo.errorMessage,
                "Error message should be equal to expected value",
            ).to.equal("test_error");
            expect(
                treeNodeInfo.metadata,
                "Node metadata should be the same as nodeInfo metadata",
            ).to.equal(nodeInfo.metadata);
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
            ).to.equal("test_server");

            treeNodeInfo.updateConnectionProfile(connectionInfo);

            expect(
                treeNodeInfo.connectionProfile.server,
                "connectionInfo should be updated",
            ).to.equal("modified_server");
        });
    });
});

function createConnectionProfile(id: string, profileName: string): ConnectionProfile {
    return new ConnectionProfile({
        id,
        profileName,
    } as unknown as IConnectionProfile);
}
