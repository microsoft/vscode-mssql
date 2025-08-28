/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from "chai";
import * as TypeMoq from "typemoq";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
    MetadataQueryRequest,
    MetadataQueryResult,
} from "../../src/models/contracts/metadata/metadataRequest";
import { DatabaseObjectSearchService } from "../../src/services/databaseObjectSearchService";
import { ObjectMetadata } from "vscode-mssql";

suite("DatabaseObjectSearchService Tests", () => {
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let searchService: DatabaseObjectSearchService;

    setup(() => {
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        searchService = new DatabaseObjectSearchService(client.object);
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
        client
            .setup((c) => c.sendRequest(MetadataQueryRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResult));

        const result = await searchService.searchObjects("test_uri", "cust");
        assert.isTrue(result.success);
        assert.equal(result.objects.length, 2, "Should match Customers and vTopCustomers");
        assert.deepEqual(
            result.objects.map((o) => o.name).sort(),
            ["Customers", "vTopCustomers"].sort(),
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
        const sendReq = client
            .setup((c) => c.sendRequest(MetadataQueryRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResult));

        await searchService.warmCache("uri1");
        await searchService.searchObjects("uri1", "thing");
        // Should have been called only once thanks to cache
        sendReq.verifiable(TypeMoq.Times.once());
        client.verifyAll();
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
        const sendReq = client
            .setup((c) => c.sendRequest(MetadataQueryRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResult));

        await searchService.warmCache("uri2");
        DatabaseObjectSearchService.clearCache("uri2");
        await searchService.searchObjects("uri2", "x");
        // Called twice because cache was cleared
        sendReq.verifiable(TypeMoq.Times.exactly(2));
        client.verifyAll();
    });

    test("returns error when search term is empty and does not call service", async () => {
        // No setup for sendRequest; verify it's not called
        const result = await searchService.searchObjects("test_uri", "   ");
        assert.isFalse(result.success);
        assert.equal(result.objects.length, 0);
        assert.match(result.error || "", /Search term cannot be empty/);
        client.verify(
            (c) => c.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
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
        client
            .setup((c) => c.sendRequest(MetadataQueryRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResult));

        const result = await searchService.searchObjects("uri3", "test");
        assert.isTrue(result.success);
        const typesByName = new Map(result.objects.map((o) => [o.name, o.type]));
        assert.equal(typesByName.get("test_proc"), "Stored Procedure");
        assert.equal(typesByName.get("test_svf"), "Scalar Function");
        assert.equal(typesByName.get("test_tvf"), "Table-valued Function");
        // Unknown types pass through unchanged
        assert.equal(typesByName.get("test_syn"), "Synonym");
    });
});
