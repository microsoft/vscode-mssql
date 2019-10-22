/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import ConnectionManager from '../src/controllers/connectionManager';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import { ScriptingService } from '../src/scripting/scriptingService';
import { ScriptingRequest, ScriptingObject, ScriptingResult } from '../src/models/contracts/scripting/scriptingRequest';
import { Script } from 'vm';
import { TreeNodeInfo } from '../src/objectExplorer/treeNodeInfo';
import { ServerInfo } from '../src/models/contracts/connection';
import { ObjectMetadata, MetadataType } from '../src/models/contracts/metadata/metadataRequest';
import { assert } from 'chai';

suite('Scripting Service Tests', () => {

    let scriptingService: ScriptingService;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;

    setup(() => {
        connectionManager = TypeMoq.Mock.ofType(ConnectionManager, TypeMoq.MockBehavior.Loose);
        connectionManager.setup(c => c.client).returns(() => client.object);
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        const mockScriptResult: ScriptingResult = {
            operationId: undefined,
            script: 'test_script'
        };
        client.setup(c => c.sendRequest(ScriptingRequest.type, TypeMoq.It.isAny())).returns(() => Promise.resolve(mockScriptResult));
        connectionManager.object.client = client.object;
        connectionManager.setup(c => c.getServerInfo(TypeMoq.It.isAny())).returns(() => {
            let serverInfo = new ServerInfo();
            serverInfo.engineEditionId = 2;
            serverInfo.serverMajorVersion = 1;
            serverInfo.isCloud = true;
            return serverInfo;
        });

    });

    test('Test Get Object From Node function', () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: 'Table',
            urn: undefined,
            schema: 'dbo',
            name: 'test_table'
        };
        const testNode = new TreeNodeInfo('test_table (System Versioned)', undefined, undefined,
            undefined, undefined, 'Table', undefined, undefined, undefined, testNodeMetadata);
        scriptingService = new ScriptingService(connectionManager.object);
        const expectedScriptingObject: ScriptingObject = {
            type: testNodeMetadata.metadataTypeName,
            schema: testNodeMetadata.schema,
            name: testNodeMetadata.name
        };
        const scriptingObject = scriptingService.getObjectFromNode(testNode);
        assert.equal(scriptingObject.name, expectedScriptingObject.name);
        assert.equal(scriptingObject.schema, expectedScriptingObject.schema);
        assert.equal(scriptingObject.type, expectedScriptingObject.type);
    });

    test('Test Scripting function', async () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: 'Table',
            urn: undefined,
            schema: 'dbo',
            name: 'test_table'
        };
        const testNode = new TreeNodeInfo('test_table (System Versioned)', undefined, undefined,
            undefined, undefined, 'Table', undefined, undefined, undefined, testNodeMetadata);
        scriptingService = new ScriptingService(connectionManager.object);
        const script = await scriptingService.scriptSelect(testNode, 'test_uri');
        assert.notEqual(script, undefined);
    });
});
