/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { SimpleExecuteResult } from "vscode-mssql";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SqlInlineCompletionSchemaContextService } from "../../src/copilot/sqlInlineCompletionSchemaContextService";
import { createTestDocument, stubTelemetry } from "./utils";

chai.use(sinonChai);

suite("SqlInlineCompletionSchemaContextService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let serviceClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let service: SqlInlineCompletionSchemaContextService;
    let connectionsChangedEmitter: vscode.EventEmitter<void>;

    const ownerUri = "file:///test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        serviceClient = sandbox.createStubInstance(SqlToolsServiceClient);
        connectionsChangedEmitter = new vscode.EventEmitter<void>();
        (
            connectionManager as unknown as { onConnectionsChanged: vscode.Event<void> }
        ).onConnectionsChanged = connectionsChangedEmitter.event;

        service = new SqlInlineCompletionSchemaContextService(connectionManager, serviceClient);
    });

    teardown(() => {
        connectionsChangedEmitter.dispose();
        service.dispose();
        sandbox.restore();
    });

    test("returns undefined when the editor has no active connection", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const document = createTestDocument("SELECT ", ownerUri);

        const result = await service.getSchemaContext(document);

        expect(result).to.be.undefined;
        expect(serviceClient.sendRequest).to.not.have.been.called;
    });

    test("fetches and caches schema context per connection fingerprint", async () => {
        connectionManager.getConnectionInfo.returns(createConnectionInfo("Sales"));
        serviceClient.sendRequest.resolves(
            createSimpleExecuteResult({
                server: "localhost",
                database: "Sales",
                defaultSchema: "dbo",
                schemas: [{ name: "dbo" }, { name: "sales" }],
                tables: [
                    {
                        schema: "dbo",
                        name: "Customers",
                        columns: [{ name: "CustomerId" }, { name: "Name" }],
                    },
                ],
                views: [],
                masterSymbols: [{ schema: "sys", name: "databases" }],
            }),
        );

        const document = createTestDocument("SELECT ", ownerUri);
        const firstResult = await service.getSchemaContext(document);
        const secondResult = await service.getSchemaContext(document);

        expect(serviceClient.sendRequest).to.have.been.calledOnce;
        expect(connectionManager.refreshAzureAccountToken).to.have.been.calledOnceWithExactly(
            ownerUri,
        );
        expect(firstResult).to.deep.equal(secondResult);
        expect(firstResult?.tables[0].name).to.equal("dbo.Customers");
        expect(firstResult?.tables[0].columns).to.deep.equal(["CustomerId", "Name"]);
        expect(firstResult?.masterSymbols).to.deep.equal(["sys.databases"]);
    });

    test("uses prompt-aware relevance terms to rank cached metadata client-side", async () => {
        connectionManager.getConnectionInfo.returns(createConnectionInfo("Sales"));
        serviceClient.sendRequest.resolves(
            createSimpleExecuteResult({
                server: "localhost",
                database: "Sales",
                defaultSchema: "dbo",
                schemas: [{ name: "dbo" }, { name: "sales" }],
                tables: [
                    {
                        schema: "dbo",
                        name: "Customers",
                        columns: [{ name: "CustomerId" }, { name: "Name" }],
                    },
                    ...Array.from({ length: 12 }, (_, index) => ({
                        schema: "dbo",
                        name: `Filler_${index}`,
                        columns: [{ name: "Id" }],
                    })),
                    {
                        schema: "sales",
                        name: "Purchases",
                        columns: [{ name: "PurchaseId" }, { name: "CustomerId" }],
                    },
                ],
                views: [],
                masterSymbols: [],
            }),
        );

        const document = createTestDocument("-- what are all the purchases", ownerUri);

        const purchaseResult = await service.getSchemaContext(
            document,
            "-- what are all the purchases",
        );
        const customerResult = await service.getSchemaContext(document, "-- list all customers");

        expect(serviceClient.sendRequest).to.have.been.calledOnce;
        expect(purchaseResult?.tables[0].name).to.equal("sales.Purchases");
        expect(customerResult?.tables[0].name).to.equal("dbo.Customers");
        expect(purchaseResult?.tables.map((table) => table.name)).to.include("sales.Purchases");

        const queryString = (serviceClient.sendRequest.firstCall.args[1] as { queryString: string })
            .queryString;
        expect(queryString.trimStart()).to.match(/^SET NOCOUNT ON;/);
        expect(queryString).to.not.include("INSERT INTO @relevanceTerms");
        expect(queryString).to.not.include("@relevanceTerms");
    });

    test("clears cached entries when the connection manager raises a connections changed event", async () => {
        const liveConnection = createConnectionInfo("Sales");
        let activeConnections: { [fileUri: string]: ConnectionInfo } = {
            [ownerUri]: liveConnection,
        };
        sandbox.stub(connectionManager, "activeConnections").get(() => activeConnections);
        connectionManager.getConnectionInfo.returns(liveConnection);
        serviceClient.sendRequest.resolves(
            createSimpleExecuteResult({
                server: "localhost",
                database: "Sales",
                defaultSchema: "dbo",
                schemas: [{ name: "dbo" }],
                tables: [],
                views: [],
                masterSymbols: [],
            }),
        );

        const document = createTestDocument("SELECT ", ownerUri);
        await service.getSchemaContext(document);

        activeConnections = {};
        connectionsChangedEmitter.fire();

        await service.getSchemaContext(document);

        expect(serviceClient.sendRequest).to.have.been.calledTwice;
    });

    test("truncates oversized payloads to the supported object and column limits", async () => {
        connectionManager.getConnectionInfo.returns(createConnectionInfo("Sales"));
        serviceClient.sendRequest.resolves(
            createSimpleExecuteResult({
                server: "localhost",
                database: "Sales",
                defaultSchema: "dbo",
                totalTableCount: 120,
                totalViewCount: 72,
                schemas: Array.from({ length: 40 }, (_, index) => ({
                    name: `schema_${index}`,
                })),
                tables: Array.from({ length: 20 }, (_, objectIndex) => ({
                    schema: "dbo",
                    name: `Table_${objectIndex}`,
                    columns: Array.from({ length: 20 }, (_, columnIndex) => ({
                        name: `Column_${objectIndex}_${columnIndex}`,
                    })),
                })),
                views: Array.from({ length: 16 }, (_, objectIndex) => ({
                    schema: "dbo",
                    name: `View_${objectIndex}`,
                    columns: Array.from({ length: 20 }, (_, columnIndex) => ({
                        name: `ViewColumn_${objectIndex}_${columnIndex}`,
                    })),
                })),
                tableNameOnlyInventory: Array.from({ length: 90 }, (_, index) => ({
                    schema: `schema_${index % 5}`,
                    name: `NameOnlyTable_${index}`,
                })),
                viewNameOnlyInventory: Array.from({ length: 50 }, (_, index) => ({
                    schema: `schema_${index % 3}`,
                    name: `NameOnlyView_${index}`,
                })),
                masterSymbols: Array.from({ length: 20 }, (_, index) => ({
                    schema: "sys",
                    name: `symbol_${index}`,
                })),
            }),
        );

        const result = await service.getSchemaContext(createTestDocument("SELECT ", ownerUri));

        expect(result?.schemas).to.have.lengthOf(24);
        expect(result?.tables).to.have.lengthOf(12);
        expect(result?.tables[0].columns).to.have.lengthOf(12);
        expect(result?.views).to.have.lengthOf(8);
        expect(result?.views[0].columns).to.have.lengthOf(12);
        expect(result?.totalTableCount).to.equal(120);
        expect(result?.totalViewCount).to.equal(72);
        expect(result?.tableNameOnlyInventory).to.have.lengthOf(64);
        expect(result?.viewNameOnlyInventory).to.have.lengthOf(32);
        expect(result?.masterSymbols).to.have.lengthOf(12);
    });

    test("returns undefined when STS metadata fetch fails", async () => {
        connectionManager.getConnectionInfo.returns(createConnectionInfo("Sales"));
        serviceClient.sendRequest.rejects(new Error("metadata fetch failed"));

        const result = await service.getSchemaContext(createTestDocument("SELECT ", ownerUri));

        expect(result).to.be.undefined;
        expect(serviceClient.sendRequest).to.have.been.calledOnce;
    });

    test("includes master symbols alongside current database objects", async () => {
        connectionManager.getConnectionInfo.returns(createConnectionInfo("master"));
        serviceClient.sendRequest.resolves(
            createSimpleExecuteResult({
                server: "localhost",
                database: "master",
                defaultSchema: "dbo",
                schemas: [{ name: "dbo" }],
                tables: [],
                views: [],
                masterSymbols: [
                    { schema: "sys", name: "databases" },
                    { schema: "sys", name: "server_principals" },
                ],
            }),
        );

        const result = await service.getSchemaContext(createTestDocument("SELECT ", ownerUri));

        expect(result?.masterSymbols).to.deep.equal(["sys.databases", "sys.server_principals"]);
    });
});

function createConnectionInfo(database: string): ConnectionInfo {
    const connectionInfo = new ConnectionInfo();
    connectionInfo.connectionId = "connection-id";
    connectionInfo.credentials = {
        server: "localhost",
        database,
        user: "sa",
        authenticationType: "SqlLogin",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    connectionInfo.serverInfo = {
        serverVersion: "16.0.0",
        serverLevel: "",
        serverEdition: "",
        engineEditionId: 3,
        serverMajorVersion: 16,
        serverMinorVersion: 0,
        serverReleaseVersion: 0,
        isCloud: false,
        azureVersion: 0,
        osVersion: "",
    };
    return connectionInfo;
}

function createSimpleExecuteResult(payload: unknown): SimpleExecuteResult {
    return {
        rowCount: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows: [[{ displayValue: JSON.stringify(payload), isNull: false }]] as any,
    } as SimpleExecuteResult;
}
