/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ListTablesTool, ListTablesToolParams } from "../../src/copilot/tools/listTablesTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SimpleExecuteResult } from "vscode-mssql";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("ListTablesTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockServiceClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let listTablesTool: ListTablesTool;

    const sampleConnectionId = "connection-456";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock credentials
        mockCredentials = {} as IConnectionProfile;

        // Mock ConnectionInfo with proper credentials property
        mockConnectionInfo = {
            credentials: mockCredentials,
            connectionId: sampleConnectionId,
        } as unknown as ConnectionInfo;

        // Mock ConnectionManager
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);

        // Mock ServiceClient
        mockServiceClient = sandbox.createStubInstance(SqlToolsServiceClient);

        // Mock CancellationToken
        mockToken = {} as vscode.CancellationToken;

        // Create the tool instance
        listTablesTool = new ListTablesTool(mockConnectionManager, mockServiceClient);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("call", () => {
        test("should return success result when query executes successfully", async () => {
            const mockResult: SimpleExecuteResult = {
                rowCount: 2,
                columnInfo: [{ columnName: "table_name" }] as any,
                rows: [
                    [{ displayValue: "dbo.Users", isNull: false }],
                    [{ displayValue: "dbo.Orders", isNull: false }],
                ] as any,
            };

            mockServiceClient.sendRequest.resolves(mockResult);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationOptions<ListTablesToolParams>;

            const result = await listTablesTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.tables).to.have.lengthOf(2);
            expect(parsedResult.tables).to.include("dbo.Users");
            expect(parsedResult.tables).to.include("dbo.Orders");
        });

        test("should return error when connection is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new ListTablesTool(noConnectionMock, mockServiceClient);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationOptions<ListTablesToolParams>;

            const result = await toolWithNoConnection.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.include(sampleConnectionId);
        });
    });

    suite("prepareInvocation", () => {
        test("should return confirmation messages and invocation message", async () => {
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListTablesToolParams>;

            const result = await listTablesTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("List Tables");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });

        test("should include both display name and connection ID in messages", async () => {
            const mockCredentialsWithDetails = {
                server: "localhost",
                database: "AdventureWorks",
                authenticationType: "Integrated",
            } as IConnectionProfile;

            const mockConnectionInfoWithDetails = {
                credentials: mockCredentialsWithDetails,
                connectionId: sampleConnectionId,
            } as unknown as ConnectionInfo;

            mockConnectionManager.getConnectionInfo.returns(mockConnectionInfoWithDetails);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListTablesToolParams>;

            const result = await listTablesTool.prepareInvocation(options, mockToken);

            // Verify display name components are present
            expect(result.invocationMessage).to.include("localhost");
            expect(result.invocationMessage).to.include("AdventureWorks");
            // Verify connection ID is present for debugging
            expect(result.invocationMessage).to.include(sampleConnectionId);
            // Verify both are in confirmation message
            expect(result.confirmationMessages.message.value).to.include("localhost");
            expect(result.confirmationMessages.message.value).to.include("AdventureWorks");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new ListTablesTool(noConnectionMock, mockServiceClient);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListTablesToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            // Verify connection ID is used as fallback for display name
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });
    });
});
