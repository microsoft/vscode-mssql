/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
  MetadataQueryRequest,
  MetadataQueryResult,
} from "../../src/models/contracts/metadata/metadataRequest";
import { DatabaseObjectSearchService } from "../../src/services/databaseObjectSearchService";
import { ObjectMetadata } from "vscode-mssql";

suite("DatabaseObjectSearchService Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
  let searchService: DatabaseObjectSearchService;

  setup(() => {
    sandbox = sinon.createSandbox();
    client = sandbox.createStubInstance(SqlToolsServiceClient);
    searchService = new DatabaseObjectSearchService(client);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("searchObjects filters metadata by term", async () => {
    const md: ObjectMetadata[] = [
      {
        name: "Customers",
        schema: "dbo",
        metadataTypeName: "Table",
        metadataType: undefined,
        urn: undefined,
      },
      {
        name: "Orders",
        schema: "sales",
        metadataTypeName: "Table",
        metadataType: undefined,
        urn: undefined,
      },
      {
        name: "vTopCustomers",
        schema: "dbo",
        metadataTypeName: "View",
        metadataType: undefined,
        urn: undefined,
      },
    ];
    const mockResult: MetadataQueryResult = { metadata: md };
    client.sendRequest.resolves(mockResult);

    const result = await searchService.searchObjects("test_uri", "cust");

    expect(result.success).to.be.true;
    expect(result.objects).to.have.lengthOf(2);
    expect(result.objects.map((o) => o.name).sort()).to.deep.equal(
      ["Customers", "vTopCustomers"].sort(),
    );
    sinon.assert.calledOnceWithExactly(
      client.sendRequest,
      MetadataQueryRequest.type,
      {
        ownerUri: "test_uri",
      },
    );
  });

  test("warmCache caches results and subsequent calls do not re-fetch", async () => {
    const md: ObjectMetadata[] = [
      {
        name: "Thing",
        schema: "dbo",
        metadataTypeName: "Table",
        metadataType: undefined,
        urn: undefined,
      },
    ];
    const mockResult: MetadataQueryResult = { metadata: md };
    client.sendRequest.resolves(mockResult);

    await searchService.warmCache("uri1");
    await searchService.searchObjects("uri1", "thing");

    sinon.assert.calledOnceWithExactly(
      client.sendRequest,
      MetadataQueryRequest.type,
      {
        ownerUri: "uri1",
      },
    );
  });

  test("clearCache removes cached metadata", async () => {
    const md: ObjectMetadata[] = [
      {
        name: "X",
        schema: "dbo",
        metadataTypeName: "Table",
        metadataType: undefined,
        urn: undefined,
      },
    ];
    const mockResult: MetadataQueryResult = { metadata: md };
    client.sendRequest.resolves(mockResult);

    await searchService.warmCache("uri2");
    DatabaseObjectSearchService.clearCache("uri2");
    await searchService.searchObjects("uri2", "x");

    sinon.assert.calledTwice(client.sendRequest);
    expect(client.sendRequest.firstCall.args).to.deep.equal([
      MetadataQueryRequest.type,
      { ownerUri: "uri2" },
    ]);
    expect(client.sendRequest.secondCall.args).to.deep.equal([
      MetadataQueryRequest.type,
      { ownerUri: "uri2" },
    ]);
  });

  test("returns error when search term is empty and does not call service", async () => {
    const result = await searchService.searchObjects("test_uri", "   ");

    expect(result.success).to.be.false;
    expect(result.objects).to.have.lengthOf(0);
    expect(result.error || "").to.match(/Search term cannot be empty/);
    sinon.assert.notCalled(client.sendRequest);
  });

  test("maps metadata type names to friendly labels", async () => {
    const md: ObjectMetadata[] = [
      {
        name: "test_proc",
        schema: "dbo",
        metadataTypeName: "StoredProcedure",
        metadataType: undefined,
        urn: undefined,
      },
      {
        name: "test_svf",
        schema: "dbo",
        metadataTypeName: "ScalarValuedFunction",
        metadataType: undefined,
        urn: undefined,
      },
      {
        name: "test_tvf",
        schema: "dbo",
        metadataTypeName: "TableValuedFunction",
        metadataType: undefined,
        urn: undefined,
      },
      {
        name: "test_syn",
        schema: "dbo",
        metadataTypeName: "Synonym",
        metadataType: undefined,
        urn: undefined,
      },
    ];
    const mockResult: MetadataQueryResult = { metadata: md };
    client.sendRequest.resolves(mockResult);

    const result = await searchService.searchObjects("uri3", "test");

    expect(result.success).to.be.true;
    const typesByName = new Map(result.objects.map((o) => [o.name, o.type]));
    expect(typesByName.get("test_proc")).to.equal("Stored Procedure");
    expect(typesByName.get("test_svf")).to.equal("Scalar Function");
    expect(typesByName.get("test_tvf")).to.equal("Table-valued Function");
    // Unknown types pass through unchanged
    expect(typesByName.get("test_syn")).to.equal("Synonym");
  });
});
