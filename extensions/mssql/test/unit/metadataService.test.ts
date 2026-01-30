/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { MetadataService } from "../../src/services/metadataService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
    GetServerContextualizationRequest,
    ListDatabasesRequest,
    MetadataListRequest,
    TableMetadataRequest,
    ViewMetadataRequest,
} from "../../src/models/contracts/metadata";
import {
    ColumnMetadata,
    DatabaseInfo,
    GetServerContextualizationResult,
    ListDatabasesResult,
    MetadataListResult,
    MetadataType,
    ObjectMetadata,
    TableMetadataResult,
    ViewMetadataResult,
} from "../../src/sharedInterfaces/metadata";
import { Logger } from "../../src/models/logger";

chai.use(sinonChai);

suite("Metadata Service Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let metadataService: MetadataService;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
        mockLogger = sandbox.createStubInstance(Logger);

        sandbox.stub(mockClient, "logger").get(() => mockLogger);

        metadataService = new MetadataService(mockClient);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("constructor and properties", () => {
        test("should initialize with SqlToolsServiceClient", () => {
            expect(metadataService).to.not.be.undefined;
            expect(metadataService.sqlToolsClient).to.equal(mockClient);
        });

        test("sqlToolsClient getter should return the client instance", () => {
            const client = metadataService.sqlToolsClient;
            expect(client).to.equal(mockClient);
        });
    });

    suite("getMetadata", () => {
        const ownerUri = "test-owner-uri";

        test("should successfully retrieve metadata for all database objects", async () => {
            const mockMetadata: ObjectMetadata[] = [
                {
                    metadataType: MetadataType.Table,
                    metadataTypeName: "Table",
                    schema: "dbo",
                    name: "Users",
                    urn: "Server[@Name='localhost']/Database[@Name='TestDB']/Table[@Name='Users' and @Schema='dbo']",
                },
                {
                    metadataType: MetadataType.View,
                    metadataTypeName: "View",
                    schema: "dbo",
                    name: "ActiveUsers",
                },
                {
                    metadataType: MetadataType.SProc,
                    metadataTypeName: "StoredProcedure",
                    schema: "dbo",
                    name: "GetUserById",
                },
            ];

            const mockResult: MetadataListResult = {
                metadata: mockMetadata,
            };

            mockClient.sendRequest
                .withArgs(MetadataListRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getMetadata(ownerUri);

            expect(result).to.deep.equal(mockMetadata);
            expect(mockClient.sendRequest).to.have.been.calledOnce;

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect(callArgs[0]).to.equal(MetadataListRequest.type);
            expect(callArgs[1]).to.deep.equal({
                ownerUri: ownerUri,
            });
        });

        test("should return empty array when no metadata exists", async () => {
            const mockResult: MetadataListResult = {
                metadata: [],
            };

            mockClient.sendRequest
                .withArgs(MetadataListRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getMetadata(ownerUri);

            expect(result).to.deep.equal([]);
        });

        test("should handle getMetadata error and log it", async () => {
            const error = new Error("Failed to retrieve metadata");
            mockClient.sendRequest
                .withArgs(MetadataListRequest.type, sinon.match.any)
                .rejects(error);

            try {
                await metadataService.getMetadata(ownerUri);
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(err).to.equal(error);
                expect(mockLogger.error).to.have.been.calledOnce;
                expect(mockLogger.error).to.have.been.calledWith("Failed to retrieve metadata");
            }
        });
    });

    suite("getTableInfo", () => {
        const ownerUri = "test-owner-uri";
        const schema = "dbo";
        const objectName = "Users";

        test("should successfully retrieve column metadata for a table", async () => {
            const mockColumns: ColumnMetadata[] = [
                {
                    escapedName: "[Id]",
                    ordinal: 0,
                    isIdentity: true,
                    isComputed: false,
                    isDeterministic: false,
                    defaultValue: undefined,
                    hasExtendedProperties: true,
                    isKey: true,
                    isCalculated: true,
                    isTrustworthyForUniqueness: true,
                },
                {
                    escapedName: "[Username]",
                    ordinal: 1,
                    isIdentity: false,
                    isComputed: false,
                    isDeterministic: false,
                    defaultValue: undefined,
                    hasExtendedProperties: true,
                    isKey: false,
                    isCalculated: false,
                    isTrustworthyForUniqueness: true,
                },
                {
                    escapedName: "[CreatedAt]",
                    ordinal: 2,
                    isIdentity: false,
                    isComputed: false,
                    isDeterministic: false,
                    defaultValue: "GETDATE()",
                    hasExtendedProperties: true,
                    isKey: false,
                    isCalculated: false,
                    isTrustworthyForUniqueness: false,
                },
            ];

            const mockResult: TableMetadataResult = {
                columns: mockColumns,
            };

            mockClient.sendRequest
                .withArgs(TableMetadataRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getTableInfo(ownerUri, schema, objectName);

            expect(result).to.deep.equal(mockColumns);
            expect(mockClient.sendRequest).to.have.been.calledOnce;

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect(callArgs[0]).to.equal(TableMetadataRequest.type);
            expect(callArgs[1]).to.deep.equal({
                ownerUri: ownerUri,
                schema: schema,
                objectName: objectName,
            });
        });

        test("should handle different schema names", async () => {
            const mockResult: TableMetadataResult = {
                columns: [],
            };

            mockClient.sendRequest
                .withArgs(TableMetadataRequest.type, sinon.match.any)
                .resolves(mockResult);

            await metadataService.getTableInfo(ownerUri, "custom_schema", "MyTable");

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect((callArgs[1] as any).schema).to.equal("custom_schema");
            expect((callArgs[1] as any).objectName).to.equal("MyTable");
        });

        test("should return empty array when table has no columns", async () => {
            const mockResult: TableMetadataResult = {
                columns: [],
            };

            mockClient.sendRequest
                .withArgs(TableMetadataRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getTableInfo(ownerUri, schema, objectName);

            expect(result).to.deep.equal([]);
        });

        test("should handle getTableInfo error and log it", async () => {
            const error = new Error("Table not found");
            mockClient.sendRequest
                .withArgs(TableMetadataRequest.type, sinon.match.any)
                .rejects(error);

            try {
                await metadataService.getTableInfo(ownerUri, schema, objectName);
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(err).to.equal(error);
                expect(mockLogger.error).to.have.been.calledOnce;
                expect(mockLogger.error).to.have.been.calledWith("Table not found");
            }
        });
    });

    suite("getViewInfo", () => {
        const ownerUri = "test-owner-uri";
        const schema = "dbo";
        const objectName = "ActiveUsers";

        test("should successfully retrieve column metadata for a view", async () => {
            const mockColumns: ColumnMetadata[] = [
                {
                    escapedName: "[UserId]",
                    ordinal: 0,
                    isIdentity: false,
                    isComputed: false,
                    isDeterministic: false,
                    hasExtendedProperties: true,
                    isKey: false,
                    isCalculated: false,
                },
                {
                    escapedName: "[DisplayName]",
                    ordinal: 1,
                    isIdentity: false,
                    isComputed: true,
                    isDeterministic: true,
                    hasExtendedProperties: false,
                    isKey: false,
                    isCalculated: true,
                },
            ];

            const mockResult: ViewMetadataResult = {
                columns: mockColumns,
            };

            mockClient.sendRequest
                .withArgs(ViewMetadataRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getViewInfo(ownerUri, schema, objectName);

            expect(result).to.deep.equal(mockColumns);
            expect(mockClient.sendRequest).to.have.been.calledOnce;

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect(callArgs[0]).to.equal(ViewMetadataRequest.type);
            expect(callArgs[1]).to.deep.equal({
                ownerUri: ownerUri,
                schema: schema,
                objectName: objectName,
            });
        });

        test("should handle getViewInfo error and log it", async () => {
            const error = new Error("View not found");
            mockClient.sendRequest
                .withArgs(ViewMetadataRequest.type, sinon.match.any)
                .rejects(error);

            try {
                await metadataService.getViewInfo(ownerUri, schema, objectName);
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(err).to.equal(error);
                expect(mockLogger.error).to.have.been.calledOnce;
                expect(mockLogger.error).to.have.been.calledWith("View not found");
            }
        });
    });

    suite("getDatabases", () => {
        const ownerUri = "test-owner-uri";

        test("should successfully retrieve database names without details", async () => {
            const mockDatabaseNames = ["master", "tempdb", "model", "msdb", "MyDatabase"];

            const mockResult: ListDatabasesResult = {
                databaseNames: mockDatabaseNames,
            };

            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getDatabases(ownerUri);

            expect(result).to.deep.equal(mockDatabaseNames);
            expect(mockClient.sendRequest).to.have.been.calledOnce;

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect(callArgs[0]).to.equal(ListDatabasesRequest.type);
            expect(callArgs[1]).to.deep.equal({
                ownerUri: ownerUri,
                includeDetails: false,
            });
        });

        test("should successfully retrieve database info with details", async () => {
            const mockDatabases: DatabaseInfo[] = [
                {
                    options: {
                        name: "MyDatabase",
                        sizeInMB: 100,
                        state: "ONLINE",
                    },
                },
                {
                    options: {
                        name: "AnotherDB",
                        sizeInMB: 250,
                        state: "ONLINE",
                    },
                },
            ];

            const mockResult: ListDatabasesResult = {
                databases: mockDatabases,
            };

            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getDatabases(ownerUri, true);

            expect(result).to.deep.equal(mockDatabases);
            expect(mockClient.sendRequest).to.have.been.calledOnce;

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect(callArgs[1]).to.deep.equal({
                ownerUri: ownerUri,
                includeDetails: true,
            });
        });

        test("should return empty array when no databases exist", async () => {
            const mockResult: ListDatabasesResult = {
                databaseNames: [],
            };

            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getDatabases(ownerUri);

            expect(result).to.deep.equal([]);
        });

        test("should return empty array when databaseNames is undefined", async () => {
            const mockResult: ListDatabasesResult = {};

            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getDatabases(ownerUri);

            expect(result).to.deep.equal([]);
        });

        test("should default includeDetails to false", async () => {
            const mockResult: ListDatabasesResult = {
                databaseNames: ["TestDB"],
            };

            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockResult);

            await metadataService.getDatabases(ownerUri);

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect((callArgs[1] as any).includeDetails).to.equal(false);
        });

        test("should handle getDatabases error and log it", async () => {
            const error = new Error("Failed to list databases");
            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .rejects(error);

            try {
                await metadataService.getDatabases(ownerUri);
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(err).to.equal(error);
                expect(mockLogger.error).to.have.been.calledOnce;
                expect(mockLogger.error).to.have.been.calledWith("Failed to list databases");
            }
        });
    });

    suite("getServerContext", () => {
        const ownerUri = "test-owner-uri";
        const databaseName = "MyDatabase";

        test("should successfully retrieve server context", async () => {
            const mockContext =
                "CREATE TABLE [dbo].[Users] (\n    [Id] INT IDENTITY(1,1) PRIMARY KEY,\n    [Username] NVARCHAR(255) NOT NULL\n);\n\nCREATE TABLE [dbo].[Orders] (\n    [Id] INT IDENTITY(1,1) PRIMARY KEY\n);";

            const mockResult: GetServerContextualizationResult = {
                context: mockContext,
            };

            mockClient.sendRequest
                .withArgs(GetServerContextualizationRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getServerContext(ownerUri, databaseName);

            expect(result).to.equal(mockContext);
            expect(mockClient.sendRequest).to.have.been.calledOnce;

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect(callArgs[0]).to.equal(GetServerContextualizationRequest.type);
            expect(callArgs[1]).to.deep.equal({
                ownerUri: ownerUri,
                databaseName: databaseName,
            });
        });

        test("should return empty string when no context available", async () => {
            const mockResult: GetServerContextualizationResult = {
                context: "",
            };

            mockClient.sendRequest
                .withArgs(GetServerContextualizationRequest.type, sinon.match.any)
                .resolves(mockResult);

            const result = await metadataService.getServerContext(ownerUri, databaseName);

            expect(result).to.equal("");
        });

        test("should handle different database names", async () => {
            const mockResult: GetServerContextualizationResult = {
                context: "-- Context for TestDB",
            };

            mockClient.sendRequest
                .withArgs(GetServerContextualizationRequest.type, sinon.match.any)
                .resolves(mockResult);

            await metadataService.getServerContext(ownerUri, "TestDB");

            const callArgs = mockClient.sendRequest.firstCall.args;
            expect((callArgs[1] as any).databaseName).to.equal("TestDB");
        });

        test("should handle getServerContext error and log it", async () => {
            const error = new Error("Failed to generate context");
            mockClient.sendRequest
                .withArgs(GetServerContextualizationRequest.type, sinon.match.any)
                .rejects(error);

            try {
                await metadataService.getServerContext(ownerUri, databaseName);
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(err).to.equal(error);
                expect(mockLogger.error).to.have.been.calledOnce;
                expect(mockLogger.error).to.have.been.calledWith("Failed to generate context");
            }
        });
    });

    suite("error handling", () => {
        test("should log error with proper message format", async () => {
            const errorMessage = "Connection timeout";
            const error = new Error(errorMessage);
            mockClient.sendRequest.rejects(error);

            try {
                await metadataService.getMetadata("uri");
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(mockLogger.error).to.have.been.calledOnce;
                expect(mockLogger.error.firstCall.args[0]).to.contain(errorMessage);
            }
        });

        test("should handle non-Error objects thrown", async () => {
            const errorString = "String error";
            mockClient.sendRequest.rejects(errorString);

            try {
                await metadataService.getDatabases("uri");
                expect.fail("Should have thrown an error");
            } catch (err) {
                expect(mockLogger.error).to.have.been.calledOnce;
            }
        });
    });

    suite("integration scenarios", () => {
        test("should handle complete metadata exploration workflow", async () => {
            const ownerUri = "session-uri";

            // List databases
            const listDbResult: ListDatabasesResult = {
                databaseNames: ["TestDB"],
            };
            mockClient.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(listDbResult);
            await metadataService.getDatabases(ownerUri);

            // Get metadata for database
            const metadataResult: MetadataListResult = {
                metadata: [
                    {
                        metadataType: MetadataType.Table,
                        metadataTypeName: "Table",
                        schema: "dbo",
                        name: "Users",
                    },
                ],
            };
            mockClient.sendRequest
                .withArgs(MetadataListRequest.type, sinon.match.any)
                .resolves(metadataResult);
            await metadataService.getMetadata(ownerUri);

            // Get table info
            const tableResult: TableMetadataResult = {
                columns: [
                    {
                        escapedName: "[Id]",
                        ordinal: 0,
                        isIdentity: true,
                        isComputed: false,
                        isDeterministic: false,
                        hasExtendedProperties: true,
                    },
                ],
            };
            mockClient.sendRequest
                .withArgs(TableMetadataRequest.type, sinon.match.any)
                .resolves(tableResult);
            await metadataService.getTableInfo(ownerUri, "dbo", "Users");

            // Get server context for AI
            const contextResult: GetServerContextualizationResult = {
                context: "CREATE TABLE [dbo].[Users] ...;",
            };
            mockClient.sendRequest
                .withArgs(GetServerContextualizationRequest.type, sinon.match.any)
                .resolves(contextResult);
            await metadataService.getServerContext(ownerUri, "TestDB");

            expect(mockClient.sendRequest.callCount).to.equal(4);
        });

        test("should handle multiple table and view info requests", async () => {
            const ownerUri = "multi-request-uri";

            // Get table info for multiple tables
            const tableResult: TableMetadataResult = {
                columns: [],
            };
            mockClient.sendRequest
                .withArgs(TableMetadataRequest.type, sinon.match.any)
                .resolves(tableResult);

            await metadataService.getTableInfo(ownerUri, "dbo", "Users");
            await metadataService.getTableInfo(ownerUri, "dbo", "Orders");
            await metadataService.getTableInfo(ownerUri, "sales", "Products");

            // Get view info
            const viewResult: ViewMetadataResult = {
                columns: [],
            };
            mockClient.sendRequest
                .withArgs(ViewMetadataRequest.type, sinon.match.any)
                .resolves(viewResult);

            await metadataService.getViewInfo(ownerUri, "dbo", "ActiveUsers");

            expect(mockClient.sendRequest.callCount).to.equal(4);
        });
    });
});
