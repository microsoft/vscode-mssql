/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import ConnectionManager from '../src/controllers/connectionManager';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import { ScriptingService } from '../src/scripting/scriptingService';
import { ScriptingRequest } from '../src/models/contracts/scripting/scriptingRequest';
import { Script } from 'vm';
import { TreeNodeInfo } from '../src/objectExplorer/treeNodeInfo';
import { ServerInfo } from '../src/models/contracts/connection';

suite('Scripting Service Tests', () => {

    let scriptingService: ScriptingService;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;

    setup(() => {
        connectionManager = TypeMoq.Mock.ofType(ConnectionManager, TypeMoq.MockBehavior.Loose);
        connectionManager.setup(c => c.client).returns(() => client.object);
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        client.setup(c => c.sendRequest(ScriptingRequest.type, TypeMoq.It.isAny())).returns(() => TypeMoq.It.isAny());
        connectionManager.object.client = client.object;
        connectionManager.setup(c => c.getServerInfo(TypeMoq.It.isAny())).returns(() => {
            let serverInfo = new ServerInfo();
            serverInfo.engineEditionId = 2;
            serverInfo.serverMajorVersion = 1;
            serverInfo.isCloud = true;
            return serverInfo;
        });

    });

    test('Test Script Select', () => {
        let testNode = new TreeNodeInfo('master.dbo.test_table', undefined, undefined,
            undefined, undefined, 'Table', undefined, undefined, undefined);
        scriptingService = new ScriptingService(connectionManager.object);
        scriptingService.scriptSelect(testNode, 'test_uri');
    });
});
