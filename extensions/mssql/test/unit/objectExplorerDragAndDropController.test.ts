/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import { ObjectExplorerDragAndDropController } from "../../src/objectExplorer/objectExplorerDragAndDropController";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { ConnectionGroupNode } from "../../src/objectExplorer/nodes/connectionGroupNode";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ConnectionStore } from "../../src/models/connectionStore";
import { Logger } from "../../src/models/logger";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";
import { IConnectionProfile, IConnectionGroup } from "../../src/models/interfaces";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { initializeIconUtils } from "./utils";

suite("ObjectExplorerDragAndDropController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let controller: ObjectExplorerDragAndDropController;
    let getQualifiedNameStub: sinon.SinonStub;
    let mockConnectionConfig: sinon.SinonStubbedInstance<ConnectionConfig>;

    setup(() => {
        initializeIconUtils();
        sandbox = sinon.createSandbox();
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
        mockLogger = sandbox.createStubInstance(Logger);
        mockConnectionConfig = sandbox.createStubInstance(ConnectionConfig);

        sandbox.stub(Logger, "create").returns(mockLogger);

        getQualifiedNameStub = sandbox.stub(ObjectExplorerUtils, "getQualifiedName");

        sandbox.stub(mockConnectionStore, "connectionConfig").get(() => mockConnectionConfig);

        controller = new ObjectExplorerDragAndDropController(
            mockVscodeWrapper,
            mockConnectionStore,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("handleDrag", () => {
        test("should handle drag for ConnectionNode", () => {
            // Create mock connection profile
            const mockProfile: IConnectionProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            } as IConnectionProfile;

            // Create mock connection node
            const mockConnectionNode = new ConnectionNode(mockProfile);

            // Create mock data transfer
            const mockDataTransfer = new vscode.DataTransfer();

            // Mock ObjectExplorerUtils.getQualifiedName
            const mockQualifiedName = "server1.db1";
            getQualifiedNameStub.returns(mockQualifiedName);

            // Call handleDrag
            controller.handleDrag(
                [mockConnectionNode],
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify OE_MIME_TYPE data was set
            const oeData = mockDataTransfer.get("application/vnd.code.tree.objectExplorer");
            expect(oeData, "OE_MIME_TYPE data should exist").to.exist;
            expect(oeData.value, "OE data should match expected structure").to.deep.equal({
                name: mockConnectionNode.label.toString(),
                type: "connection",
                id: mockProfile.id,
                isConnectionOrGroup: true,
            });

            // Verify TEXT_MIME_TYPE data was set
            const textData = mockDataTransfer.get("text/plain");
            expect(textData, "TEXT_MIME_TYPE data should exist").to.exist;
            expect(textData.value, "Text data should match qualified name").to.equal(
                mockQualifiedName,
            );
        });

        test("should handle drag for ConnectionGroupNode", () => {
            // Create mock connection group
            const mockGroup: IConnectionGroup = {
                id: "group1",
                name: "Test Group",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                description: "Test group description",
                configSource: vscode.ConfigurationTarget.Global,
            };

            // Create mock connection group node
            const mockGroupNode = new ConnectionGroupNode(mockGroup);

            // Create mock data transfer
            const mockDataTransfer = new vscode.DataTransfer();

            // Call handleDrag
            controller.handleDrag(
                [mockGroupNode],
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify OE_MIME_TYPE data was set
            const oeData = mockDataTransfer.get("application/vnd.code.tree.objectExplorer");
            expect(oeData, "OE_MIME_TYPE data should exist").to.exist;
            expect(oeData.value, "OE data should match expected structure").to.deep.equal({
                name: mockGroupNode.label.toString(),
                type: "connectionGroup",
                id: mockGroup.id,
                isConnectionOrGroup: true,
            });

            // Should NOT call getQualifiedName for ConnectionGroupNode
            expect(getQualifiedNameStub.notCalled, "getQualifiedName should not be called").to.be
                .true;
        });

        test("should handle drag for regular TreeNodeInfo with only TEXT_MIME_TYPE", () => {
            // Create mock tree node info
            const mockTreeNode = new TreeNodeInfo(
                "testNode",
                {
                    type: "table",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.None,
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

            // Create mock data transfer
            const mockDataTransfer = new vscode.DataTransfer();

            // Mock ObjectExplorerUtils.getQualifiedName
            const mockQualifiedName = "server1.db1.table1";
            getQualifiedNameStub.returns(mockQualifiedName);

            // Call handleDrag
            controller.handleDrag([mockTreeNode], mockDataTransfer, {} as vscode.CancellationToken);

            // Verify OE_MIME_TYPE data was NOT set
            const oeData = mockDataTransfer.get("application/vnd.code.tree.objectExplorer");
            expect(oeData, "OE_MIME_TYPE data should not exist").to.be.undefined;

            // Verify TEXT_MIME_TYPE data was set
            const textData = mockDataTransfer.get("text/plain");
            expect(textData, "TEXT_MIME_TYPE data should exist").to.exist;
            expect(textData.value, "Text data should match qualified name").to.equal(
                mockQualifiedName,
            );
        });
    });

    suite("handleDrop", () => {
        test("should handle drop of connection onto connection group successfully", async () => {
            // Create mock connection profile
            const mockProfile: IConnectionProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "old-group-id",
            } as IConnectionProfile;

            // Create mock connection group
            const mockGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                description: "Target group description",
                configSource: vscode.ConfigurationTarget.Global,
            };

            // Create mock target group node
            const mockTargetGroupNode = new ConnectionGroupNode(mockGroup);

            // Create mock data transfer with connection drag data
            const mockDataTransfer = new vscode.DataTransfer();
            const dragData = {
                name: "Test Connection",
                type: "connection" as const,
                id: mockProfile.id,
                isConnectionOrGroup: true,
            };
            mockDataTransfer.set(
                "application/vnd.code.tree.objectExplorer",
                new vscode.DataTransferItem(dragData),
            );

            // Mock connection store methods
            (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub).resolves(
                mockProfile,
            );
            (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).resolves();

            // Call handleDrop
            await controller.handleDrop(
                mockTargetGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub)
                    .calledOnce,
                "updateConnection should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub)
                    .args[0][0].groupId,
                "Updated connection groupId should match target group id",
            ).to.equal(mockGroup.id);
        });

        test("should handle drop of connection group onto another connection group successfully", async () => {
            // Create mock connection group to be moved
            const mockSourceGroup: IConnectionGroup = {
                id: "source-group-id",
                name: "Source Group",
                parentId: "old-parent-id",
                description: "Source group description",
                configSource: vscode.ConfigurationTarget.Global,
            };

            // Create mock target connection group
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                description: "Target group description",
                configSource: vscode.ConfigurationTarget.Global,
            };

            // Create mock target group node
            const mockTargetGroupNode = new ConnectionGroupNode(mockTargetGroup);

            // Create mock data transfer with group drag data
            const mockDataTransfer = new vscode.DataTransfer();
            const dragData = {
                name: "Source Group",
                type: "connectionGroup" as const,
                id: mockSourceGroup.id,
                isConnectionOrGroup: true,
            };
            mockDataTransfer.set(
                "application/vnd.code.tree.objectExplorer",
                new vscode.DataTransferItem(dragData),
            );

            // Mock connection store methods
            (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).returns(
                mockSourceGroup,
            );
            (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).resolves();

            // Call handleDrop
            await controller.handleDrop(
                mockTargetGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify group was retrieved and updated
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).calledOnce,
                "updateGroup should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).args[0][0]
                    .parentId,
                "Updated group parentId should match target group id",
            ).to.equal(mockTargetGroup.id);
        });

        test("should handle drop onto root (undefined target) successfully", async () => {
            // Create mock connection profile
            const mockProfile: IConnectionProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "old-group-id",
            } as IConnectionProfile;

            // Create mock data transfer with connection drag data
            const mockDataTransfer = new vscode.DataTransfer();
            const dragData = {
                name: "Test Connection",
                type: "connection" as const,
                id: mockProfile.id,
                isConnectionOrGroup: true,
            };
            mockDataTransfer.set(
                "application/vnd.code.tree.objectExplorer",
                new vscode.DataTransferItem(dragData),
            );

            // Mock connection store methods
            (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub).resolves(
                mockProfile,
            );
            (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).resolves();

            // Call handleDrop with undefined target (root)
            await controller.handleDrop(
                undefined,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify connection was updated to root group
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub)
                    .calledOnce,
                "updateConnection should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub)
                    .args[0][0].groupId,
                "Updated connection groupId should match root group id",
            ).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });

        test("should prevent dropping group into itself", async () => {
            // Create mock connection group
            const mockGroup: IConnectionGroup = {
                id: "group1",
                name: "Test Group",
                parentId: "old-parent-id",
                description: "Test group description",
                configSource: vscode.ConfigurationTarget.Global,
            };

            // Create mock group node (same group as source and target)
            const mockGroupNode = new ConnectionGroupNode(mockGroup);

            // Create mock data transfer with group drag data
            const mockDataTransfer = new vscode.DataTransfer();
            const dragData = {
                name: "Test Group",
                type: "connectionGroup" as const,
                id: mockGroup.id,
                isConnectionOrGroup: true,
            };
            mockDataTransfer.set(
                "application/vnd.code.tree.objectExplorer",
                new vscode.DataTransferItem(dragData),
            );

            // Mock connection store methods
            (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).returns(
                mockGroup,
            );

            // Call handleDrop
            await controller.handleDrop(
                mockGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
        });

        test("should handle drop with invalid drag data gracefully", async () => {
            // Create mock data transfer with invalid drag data
            const mockDataTransfer = new vscode.DataTransfer();
            const invalidDragData = {
                name: "Test Item",
                isConnectionOrGroup: false, // Invalid: should be true for processing
            };
            mockDataTransfer.set(
                "application/vnd.code.tree.objectExplorer",
                new vscode.DataTransferItem(invalidDragData),
            );

            // Create mock target group node
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                description: "Target group description",
                configSource: vscode.ConfigurationTarget.Global,
            };
            const mockTargetGroupNode = new ConnectionGroupNode(mockTargetGroup);

            // Call handleDrop
            await controller.handleDrop(
                mockTargetGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify no processing occurred
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).called,
                "updateConnection should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
        });

        test("should handle drop with missing drag data gracefully", async () => {
            // Create mock data transfer with no OE_MIME_TYPE data
            const mockDataTransfer = new vscode.DataTransfer();

            // Create mock target group node
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                description: "Target group description",
                configSource: vscode.ConfigurationTarget.Global,
            };
            const mockTargetGroupNode = new ConnectionGroupNode(mockTargetGroup);

            // Call handleDrop
            await controller.handleDrop(
                mockTargetGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify no processing occurred
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).called,
                "updateConnection should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
        });

        test("should handle drop with non-connection/group target gracefully", async () => {
            // Create mock connection profile
            const mockProfile: IConnectionProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: "old-group-id",
            } as IConnectionProfile;

            // Create mock data transfer with connection drag data
            const mockDataTransfer = new vscode.DataTransfer();
            const dragData = {
                name: "Test Connection",
                type: "connection" as const,
                id: mockProfile.id,
                isConnectionOrGroup: true,
            };
            mockDataTransfer.set(
                "application/vnd.code.tree.objectExplorer",
                new vscode.DataTransferItem(dragData),
            );

            // Create mock regular tree node as target (not a connection or group)
            const mockTargetNode = new TreeNodeInfo(
                "targetNode",
                {
                    type: "table",
                    filterable: false,
                    hasFilters: false,
                    subType: "",
                },
                vscode.TreeItemCollapsibleState.None,
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

            // Call handleDrop
            await controller.handleDrop(
                mockTargetNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify nothing was moved
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).called,
                "updateConnection should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
        });
    });
});
