/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import { ObjectExplorerProvider } from '../src/objectExplorer/objectExplorerProvider';
import { ObjectExplorerService } from '../src/objectExplorer/objectExplorerService';
import ConnectionManager from '../src/controllers/connectionManager';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';

suite('Object Explorer Service Tests', () => {

    let objectExplorerService: ObjectExplorerService;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let objectExplorerProvider: TypeMoq.IMock<ObjectExplorerProvider>;

    setup(() => {
        connectionManager = TypeMoq.Mock.ofType(ConnectionManager, TypeMoq.MockBehavior.Loose);
        objectExplorerProvider = TypeMoq.Mock.ofType(ObjectExplorerProvider, TypeMoq.MockBehavior.Loose);
        connectionManager.setup(c => c.client).returns(() => client.object);
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        client.setup(c => c.onNotification(TypeMoq.It.isAny(), TypeMoq.It.isAny()));
        connectionManager.object.client = client.object;
        objectExplorerService = new ObjectExplorerService(connectionManager.object, objectExplorerProvider.object);
    });
});
