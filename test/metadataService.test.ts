/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import { MetadataService } from '../src/metadata/metadataService';
import ConnectionManager from '../src/controllers/connectionManager';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import { MetadataQueryRequest, MetadataQueryResult } from '../src/models/contracts/metadata/metadataRequest';
import { assert } from 'chai';


suite('Metadata Service Tests', () => {
	let metdataService: MetadataService;
	let connectionManager: TypeMoq.IMock<ConnectionManager>;
	let client: TypeMoq.IMock<SqlToolsServiceClient>;

	setup(() => {
		let mockContext: TypeMoq.IMock<vscode.ExtensionContext> = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
		connectionManager = TypeMoq.Mock.ofType(ConnectionManager, TypeMoq.MockBehavior.Loose, mockContext.object);
		connectionManager.setup(c => c.client).returns(() => client.object);
		client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
		const mockMetadata: MetadataQueryResult = {
			metadata: TypeMoq.It.isAny()
		};
		client.setup(c => c.sendRequest(MetadataQueryRequest.type, TypeMoq.It.isAny())).returns(() => Promise.resolve(mockMetadata));
		connectionManager.object.client = client.object;
		metdataService = new MetadataService(connectionManager.object);
	});

	test('Test getMetadata function', async () => {
		let metadata = await metdataService.getMetadata('test_uri');
		assert.notEqual(metadata, undefined);
	});
});

