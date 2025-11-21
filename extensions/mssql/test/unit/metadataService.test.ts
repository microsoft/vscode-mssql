/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { MetadataService } from "../../src/metadata/metadataService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
  MetadataQueryRequest,
  MetadataQueryResult,
} from "../../src/models/contracts/metadata/metadataRequest";

suite("Metadata Service Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
  let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
  let metadataService: MetadataService;

  setup(() => {
    sandbox = sinon.createSandbox();
    connectionManager = sandbox.createStubInstance(ConnectionManager);
    client = sandbox.createStubInstance(SqlToolsServiceClient);

    const mockMetadata: MetadataQueryResult = {
      metadata: [],
    };

    client.sendRequest.resolves(mockMetadata);
    connectionManager.client = client;

    metadataService = new MetadataService(connectionManager);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Test getMetadata function", async () => {
    const metadata = await metadataService.getMetadata("test_uri");

    expect(metadata).to.deep.equal([]);
    sinon.assert.calledOnceWithExactly(
      client.sendRequest,
      MetadataQueryRequest.type,
      {
        ownerUri: "test_uri",
      },
    );
  });
});
