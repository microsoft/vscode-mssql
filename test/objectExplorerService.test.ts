/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import { ObjectExplorerProvider } from '../src/objectExplorer/objectExplorerProvider';
import { ObjectExplorerService } from '../src/objectExplorer/objectExplorerService';
import ConnectionManager from '../src/controllers/connectionManager';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import { expect } from 'chai';
import { TreeNodeInfo } from '../src/objectExplorer/treeNodeInfo';
import { ConnectionCredentials } from '../src/models/connectionCredentials';

suite('Object Explorer Tests', () => {

    let objectExplorerService: TypeMoq.IMock<ObjectExplorerService>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let objectExplorerProvider: ObjectExplorerProvider;

    setup(() => {
        connectionManager = TypeMoq.Mock.ofType(ConnectionManager, TypeMoq.MockBehavior.Loose);
        connectionManager.setup(c => c.client).returns(() => client.object);
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        client.setup(c => c.onNotification(TypeMoq.It.isAny(), TypeMoq.It.isAny()));
        connectionManager.object.client = client.object;
        objectExplorerProvider = new ObjectExplorerProvider(connectionManager.object);
        expect(objectExplorerProvider, 'Object Explorer Provider is initialzied properly').is.not.equal(undefined);
        objectExplorerService = TypeMoq.Mock.ofType(ObjectExplorerService, TypeMoq.MockBehavior.Loose, connectionManager.object);
        objectExplorerService.setup(s => s.currentNode).returns(() => undefined);
        objectExplorerProvider.objectExplorerService = objectExplorerService.object;
    });

    test('Test Create Session', () => {
        expect(objectExplorerService.object.currentNode, 'Current Node should be undefined').is.equal(undefined);
        expect(objectExplorerProvider.objectExplorerExists, 'Object Explorer should not exist until started').is.equal(undefined);
        objectExplorerService.setup(s => s.createSession(TypeMoq.It.isAny(), undefined)).returns(() => {
            objectExplorerService.setup(s => s.currentNode).returns(() => TypeMoq.It.isAny());
            objectExplorerProvider.objectExplorerExists = true;
            return Promise.resolve(TypeMoq.It.isAny());
        });
        objectExplorerProvider.createSession(TypeMoq.It.isAny(), undefined).then(sessionId => {
            expect(sessionId, 'Session Id should not be undefined').is.not.equal(undefined);
            expect(objectExplorerService.object.currentNode, 'Current Node should not be undefined').is.not.equal(undefined);
            expect(objectExplorerProvider.objectExplorerExists, 'Object Explorer session should exist').is.equal(true);
        });
    });

    test('Test Refresh Node', () => {
        let treeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        objectExplorerService.setup(s => s.refreshNode(TypeMoq.It.isAny())).returns(() => Promise.resolve(TypeMoq.It.isAny()));
        objectExplorerProvider.refreshNode(treeNode.object).then((node) => {
            expect(node, 'Refreshed node should not be undefined').is.not.equal(undefined);
        });
    });

    test('Test Connection Credentials', () => {
        let connectionCredentials = TypeMoq.Mock.ofType(ConnectionCredentials, TypeMoq.MockBehavior.Loose);
        objectExplorerService.setup(s => s.getConnectionCredentials(TypeMoq.It.isAnyString())).returns(() => connectionCredentials.object);
        let credentials = objectExplorerProvider.getConnectionCredentials('test_session_id');
        expect(credentials, 'Connection Credentials should not be null').is.not.equal(undefined);
    });

    test('Test remove Object Explorer node', async () => {
        let isNodeDeleted = false;
        objectExplorerService.setup(s => s.removeObjectExplorerNode(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => {
            isNodeDeleted = true;
            return Promise.resolve(undefined);
        });
        objectExplorerProvider.removeObjectExplorerNode(TypeMoq.It.isAny(), TypeMoq.It.isAny());
        expect(isNodeDeleted, 'Node should be deleted').is.equal(true);
    });

    test('Test Get Children from Object Explorer Provider', () => {
        const parentTreeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        const childTreeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        objectExplorerService.setup(s => s.getChildren(TypeMoq.It.isAny())).returns(() => Promise.resolve([childTreeNode.object]));
        objectExplorerProvider.getChildren(parentTreeNode.object).then((children) => {
            children.forEach((child) => expect(child, 'Children nodes should not be undefined').is.not.equal(undefined));
        });
    });

    test('Test server nodes sorting mechanism', (done) => {
        const testNode = new TreeNodeInfo('testNode', undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined);
        const serverTestNode = new TreeNodeInfo('serverTestNode', undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined);
        const testNode2 = new TreeNodeInfo('TESTNODE', undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined);
        const testNode3 = new TreeNodeInfo('', undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined);
        const testNode4 = new TreeNodeInfo('1234', undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined);
        objectExplorerService.setup(s => s.rootTreeNodeArray).returns(() => [testNode, serverTestNode, testNode2, testNode3, testNode4]);
        objectExplorerService.setup(s => s.sortByServerName(objectExplorerService.object.rootTreeNodeArray)).returns(() => {
            const sortedNodeArray = objectExplorerService.object.rootTreeNodeArray.sort((a, b) => {
                return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
            });
            return sortedNodeArray;
        });
        const expectedSortedNodes = [testNode3, testNode4, serverTestNode, testNode, testNode2];
        let sortedNodes = objectExplorerService.object.sortByServerName(objectExplorerService.object.rootTreeNodeArray);
        for (let i = 0; i < sortedNodes.length; i++) {
            expect(sortedNodes[i], 'Sorted nodes should be the same as expected sorted nodes').is.equal(expectedSortedNodes[i]);
        }
        done();
    });
});
