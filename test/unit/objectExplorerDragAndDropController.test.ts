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
import * as telemetry from "../../src/telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";

suite("ObjectExplorerDragAndDropController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let controller: ObjectExplorerDragAndDropController;
    let sendActionEventStub: sinon.SinonStub;
    let sendErrorEventStub: sinon.SinonStub;
    let getQualifiedNameStub: sinon.SinonStub;

    const TEST_ROOT_GROUP_ID = "test-root-group-id";

    setup(() => {
        sandbox = sinon.createSandbox();
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
        mockLogger = sandbox.createStubInstance(Logger);

        // Mock Logger.create static method
        sandbox.stub(Logger, "create").returns(mockLogger);

        // Mock telemetry
        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");
        sendErrorEventStub = sandbox.stub(telemetry, "sendErrorEvent");

        // Mock ObjectExplorerUtils.getQualifiedName
        getQualifiedNameStub = sandbox.stub(ObjectExplorerUtils, "getQualifiedName");

        // Mock connection store root group ID
        sandbox.stub(mockConnectionStore, "rootGroupId").get(() => TEST_ROOT_GROUP_ID);

        controller = new ObjectExplorerDragAndDropController(
            mockVscodeWrapper,
            mockConnectionStore,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("handleDrag", () => {
        test("should handle drag for ConnectionNode with OE_MIME_TYPE and TEXT_MIME_TYPE", () => {
            // Create mock connection profile
            const mockProfile: IConnectionProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: TEST_ROOT_GROUP_ID,
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

            // Verify ObjectExplorerUtils.getQualifiedName was called
            expect(getQualifiedNameStub.calledOnce, "getQualifiedName should be called once").to.be
                .true;
            expect(
                getQualifiedNameStub.args[0][0],
                "getQualifiedName should be called with connection node",
            ).to.equal(mockConnectionNode);
        });

        test("should handle drag for ConnectionGroupNode with OE_MIME_TYPE and TEXT_MIME_TYPE", () => {
            // Create mock connection group
            const mockGroup: IConnectionGroup = {
                id: "group1",
                name: "Test Group",
                parentId: TEST_ROOT_GROUP_ID,
                description: "Test group description",
            };

            // Create mock connection group node
            const mockGroupNode = new ConnectionGroupNode(mockGroup);

            // Create mock data transfer
            const mockDataTransfer = new vscode.DataTransfer();

            // Mock ObjectExplorerUtils.getQualifiedName
            const mockQualifiedName = "Test Group";
            getQualifiedNameStub.returns(mockQualifiedName);

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

            // Verify TEXT_MIME_TYPE data was set
            const textData = mockDataTransfer.get("text/plain");
            expect(textData, "TEXT_MIME_TYPE data should exist").to.exist;
            expect(textData.value, "Text data should match qualified name").to.equal(
                mockQualifiedName,
            );

            // Verify ObjectExplorerUtils.getQualifiedName was called
            expect(getQualifiedNameStub.calledOnce, "getQualifiedName should be called once").to.be
                .true;
            expect(
                getQualifiedNameStub.args[0][0],
                "getQualifiedName should be called with group node",
            ).to.equal(mockGroupNode);
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

            // Verify ObjectExplorerUtils.getQualifiedName was called
            expect(getQualifiedNameStub.calledOnce, "getQualifiedName should be called once").to.be
                .true;
            expect(
                getQualifiedNameStub.args[0][0],
                "getQualifiedName should be called with tree node",
            ).to.equal(mockTreeNode);
        });

        test("should handle drag for multiple items but only process first item", () => {
            // Create mock connection profile
            const mockProfile: IConnectionProfile = {
                id: "conn1",
                server: "server1",
                database: "db1",
                authenticationType: "Integrated",
                user: "",
                password: "",
                savePassword: false,
                groupId: TEST_ROOT_GROUP_ID,
            } as IConnectionProfile;

            // Create mock connection node
            const mockConnectionNode = new ConnectionNode(mockProfile);

            // Create mock tree node info (second item that should be ignored)
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
            const mockQualifiedName = "server1.db1";
            getQualifiedNameStub.returns(mockQualifiedName);

            // Call handleDrag with multiple items
            controller.handleDrag(
                [mockConnectionNode, mockTreeNode],
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify only the first item (connection node) was processed
            const oeData = mockDataTransfer.get("application/vnd.code.tree.objectExplorer");
            expect(oeData, "OE_MIME_TYPE data should exist").to.exist;
            expect(oeData.value.type, "OE data type should be connection").to.equal("connection");
            expect(oeData.value.id, "OE data id should match connection profile id").to.equal(
                mockProfile.id,
            );

            // Verify ObjectExplorerUtils.getQualifiedName was called only once (for first item)
            expect(getQualifiedNameStub.calledOnce, "getQualifiedName should be called once").to.be
                .true;
            expect(
                getQualifiedNameStub.args[0][0],
                "getQualifiedName should be called with connection node",
            ).to.equal(mockConnectionNode);
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
                parentId: TEST_ROOT_GROUP_ID,
                description: "Target group description",
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

            // Verify connection was retrieved and updated
            expect(
                (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub)
                    .calledOnce,
                "getConnectionById should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub)
                    .args[0][0],
                "getConnectionById should be called with connection id",
            ).to.equal(mockProfile.id);

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

            // Verify telemetry was sent
            expect(sendActionEventStub.calledOnce, "sendActionEvent should be called once").to.be
                .true;
            expect(
                sendActionEventStub.args[0][0],
                "Telemetry view should be ObjectExplorer",
            ).to.equal(TelemetryViews.ObjectExplorer);
            expect(
                sendActionEventStub.args[0][1],
                "Telemetry action should be DragAndDrop",
            ).to.equal(TelemetryActions.DragAndDrop);
            expect(
                sendActionEventStub.args[0][2].dragType,
                "Drag type should be connection",
            ).to.equal("connection");
            expect(
                sendActionEventStub.args[0][2].dropTarget,
                "Drop target should be connectionGroup",
            ).to.equal("connectionGroup");

            // Verify logging
            expect(mockLogger.verbose.calledOnce, "Logger verbose should be called once").to.be
                .true;
            expect(
                mockLogger.verbose.args[0][0],
                "Log message should include drag and drop details",
            ).to.include("Dragged connection");
            expect(
                mockLogger.verbose.args[0][0],
                "Log message should include target group",
            ).to.include("Target Group");
        });

        test("should handle drop of connection group onto another connection group successfully", async () => {
            // Create mock connection group to be moved
            const mockSourceGroup: IConnectionGroup = {
                id: "source-group-id",
                name: "Source Group",
                parentId: "old-parent-id",
                description: "Source group description",
            };

            // Create mock target connection group
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: TEST_ROOT_GROUP_ID,
                description: "Target group description",
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
                (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).calledOnce,
                "getGroupById should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).args[0][0],
                "getGroupById should be called with group id",
            ).to.equal(mockSourceGroup.id);

            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).calledOnce,
                "updateGroup should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).args[0][0]
                    .parentId,
                "Updated group parentId should match target group id",
            ).to.equal(mockTargetGroup.id);

            // Verify telemetry was sent
            expect(sendActionEventStub.calledOnce, "sendActionEvent should be called once").to.be
                .true;
            expect(
                sendActionEventStub.args[0][2].dragType,
                "Drag type should be connectionGroup",
            ).to.equal("connectionGroup");
            expect(
                sendActionEventStub.args[0][2].dropTarget,
                "Drop target should be connectionGroup",
            ).to.equal("connectionGroup");

            // Verify logging
            expect(mockLogger.verbose.calledOnce, "Logger verbose should be called once").to.be
                .true;
            expect(
                mockLogger.verbose.args[0][0],
                "Log message should include drag and drop details",
            ).to.include("Dragged connectionGroup");
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
            ).to.equal(TEST_ROOT_GROUP_ID);

            // Verify telemetry was sent with ROOT target
            expect(sendActionEventStub.calledOnce, "sendActionEvent should be called once").to.be
                .true;
            expect(
                sendActionEventStub.args[0][2].dropTarget,
                "Drop target should be ROOT",
            ).to.equal("ROOT");

            // Verify logging
            expect(mockLogger.verbose.calledOnce, "Logger verbose should be called once").to.be
                .true;
            expect(
                mockLogger.verbose.args[0][0],
                "Log message should include ROOT target",
            ).to.include("ROOT");
        });

        test("should prevent dropping group into itself", async () => {
            // Create mock connection group
            const mockGroup: IConnectionGroup = {
                id: "group1",
                name: "Test Group",
                parentId: "old-parent-id",
                description: "Test group description",
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

            // Verify group was retrieved but NOT updated
            expect(
                (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).calledOnce,
                "getGroupById should be called once",
            ).to.be.true;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;

            // Verify telemetry was NOT sent
            expect(sendActionEventStub.called, "sendActionEvent should not be called").to.be.false;

            // Verify logging
            expect(mockLogger.verbose.calledOnce, "Logger verbose should be called once").to.be
                .true;
            expect(
                mockLogger.verbose.args[0][0],
                "Log message should indicate cannot move group into itself",
            ).to.include("Cannot move group into itself");
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
                parentId: TEST_ROOT_GROUP_ID,
                description: "Target group description",
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
                (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub).called,
                "getConnectionById should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).called,
                "getGroupById should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).called,
                "updateConnection should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
            expect(sendActionEventStub.called, "sendActionEvent should not be called").to.be.false;
        });

        test("should handle drop with missing drag data gracefully", async () => {
            // Create mock data transfer with no OE_MIME_TYPE data
            const mockDataTransfer = new vscode.DataTransfer();

            // Create mock target group node
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: TEST_ROOT_GROUP_ID,
                description: "Target group description",
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
                (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub).called,
                "getConnectionById should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).called,
                "getGroupById should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).called,
                "updateConnection should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
            expect(sendActionEventStub.called, "sendActionEvent should not be called").to.be.false;
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

            // Verify no processing occurred
            expect(
                (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub).called,
                "getConnectionById should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).called,
                "getGroupById should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).called,
                "updateConnection should not be called",
            ).to.be.false;
            expect(
                (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).called,
                "updateGroup should not be called",
            ).to.be.false;
            expect(sendActionEventStub.called, "sendActionEvent should not be called").to.be.false;
        });

        test("should handle errors during connection update and send error telemetry", async () => {
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

            // Create mock target group
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: TEST_ROOT_GROUP_ID,
                description: "Target group description",
            };
            const mockTargetGroupNode = new ConnectionGroupNode(mockTargetGroup);

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

            // Mock connection store methods to throw error
            const testError = new Error("Database connection failed");
            (mockConnectionStore.connectionConfig.getConnectionById as sinon.SinonStub).resolves(
                mockProfile,
            );
            (mockConnectionStore.connectionConfig.updateConnection as sinon.SinonStub).rejects(
                testError,
            );

            // Call handleDrop
            await controller.handleDrop(
                mockTargetGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify error was logged
            expect(mockLogger.error.calledOnce, "Logger error should be called once").to.be.true;
            expect(
                mockLogger.error.args[0][0],
                "Error message should include drag metadata parsing",
            ).to.include("Failed to parse drag metadata");

            // Verify error telemetry was sent
            expect(sendErrorEventStub.calledOnce, "sendErrorEvent should be called once").to.be
                .true;
            expect(
                sendErrorEventStub.args[0][0],
                "Telemetry view should be ObjectExplorer",
            ).to.equal(TelemetryViews.ObjectExplorer);
            expect(
                sendErrorEventStub.args[0][1],
                "Telemetry action should be DragAndDrop",
            ).to.equal(TelemetryActions.DragAndDrop);
            expect(sendErrorEventStub.args[0][2], "Error should match test error").to.equal(
                testError,
            );
            expect(sendErrorEventStub.args[0][3], "includeErrorMessage should be true").to.be.true;
            expect(
                sendErrorEventStub.args[0][6].dragType,
                "Error telemetry should include drag type",
            ).to.equal("connection");
            expect(
                sendErrorEventStub.args[0][6].dropTarget,
                "Error telemetry should include drop target",
            ).to.equal("connectionGroup");

            // Verify success telemetry was NOT sent
            expect(sendActionEventStub.called, "sendActionEvent should not be called").to.be.false;
        });

        test("should handle errors during group update and send error telemetry", async () => {
            // Create mock connection group
            const mockSourceGroup: IConnectionGroup = {
                id: "source-group-id",
                name: "Source Group",
                parentId: "old-parent-id",
                description: "Source group description",
            };

            // Create mock target group
            const mockTargetGroup: IConnectionGroup = {
                id: "target-group-id",
                name: "Target Group",
                parentId: TEST_ROOT_GROUP_ID,
                description: "Target group description",
            };
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

            // Mock connection store methods to throw error
            const testError = new Error("Group update failed");
            (mockConnectionStore.connectionConfig.getGroupById as sinon.SinonStub).returns(
                mockSourceGroup,
            );
            (mockConnectionStore.connectionConfig.updateGroup as sinon.SinonStub).rejects(
                testError,
            );

            // Call handleDrop
            await controller.handleDrop(
                mockTargetGroupNode,
                mockDataTransfer,
                {} as vscode.CancellationToken,
            );

            // Verify error was logged
            expect(mockLogger.error.calledOnce, "Logger error should be called once").to.be.true;
            expect(
                mockLogger.error.args[0][0],
                "Error message should include drag metadata parsing",
            ).to.include("Failed to parse drag metadata");

            // Verify error telemetry was sent
            expect(sendErrorEventStub.calledOnce, "sendErrorEvent should be called once").to.be
                .true;
            expect(
                sendErrorEventStub.args[0][6].dragType,
                "Error telemetry should include drag type",
            ).to.equal("connectionGroup");
            expect(
                sendErrorEventStub.args[0][6].dropTarget,
                "Error telemetry should include drop target",
            ).to.equal("connectionGroup");

            // Verify success telemetry was NOT sent
            expect(sendActionEventStub.called, "sendActionEvent should not be called").to.be.false;
        });
    });

    suite("Constructor and Properties", () => {
        test("should have correct drag and drop MIME types", () => {
            expect(
                controller.dragMimeTypes,
                "dragMimeTypes should include OE and TEXT MIME types",
            ).to.deep.equal(["application/vnd.code.tree.objectExplorer", "text/plain"]);
            expect(
                controller.dropMimeTypes,
                "dropMimeTypes should include only OE MIME type",
            ).to.deep.equal(["application/vnd.code.tree.objectExplorer"]);
        });

        test("should create logger with correct channel name", () => {
            expect(
                (Logger.create as sinon.SinonStub).calledOnce,
                "Logger.create should be called once",
            ).to.be.true;
            expect(
                (Logger.create as sinon.SinonStub).args[0][0],
                "Logger should be created with vscodeWrapper output channel",
            ).to.equal(mockVscodeWrapper.outputChannel);
            expect(
                (Logger.create as sinon.SinonStub).args[0][1],
                "Logger should be created with DragAndDrop channel name",
            ).to.equal("DragAndDrop");
        });
    });
});
