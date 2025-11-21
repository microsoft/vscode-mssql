/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import {
    ChangeDatabaseTool,
    ChangeDatabaseToolParams,
} from "../../src/copilot/tools/changeDatabaseTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("ChangeDatabaseTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let changeDatabaseTool: ChangeDatabaseTool;

    const sampleConnectionId = "connection-789";
    const sampleDatabase = "NewDatabase";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock credentials
        mockCredentials = {
            server: "localhost",
            database: "OldDatabase",
        } as IConnectionProfile;

        // Mock ConnectionInfo
        mockConnectionInfo = {
            credentials: mockCredentials,
            connectionId: sampleConnectionId,
        } as unknown as ConnectionInfo;

        // Mock ConnectionManager
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);
        mockConnectionManager.isConnected.returns(true);
        mockConnectionManager.disconnect.resolves();
        mockConnectionManager.connect.resolves(true);

        // Mock CancellationToken
        mockToken = {} as vscode.CancellationToken;

        // Create the tool instance
        changeDatabaseTool = new ChangeDatabaseTool(
            mockConnectionManager as unknown as ConnectionManager,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("call", () => {
        test("should return success when database change succeeds", async () => {
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    database: sampleDatabase,
                },
            } as vscode.LanguageModelToolInvocationOptions<ChangeDatabaseToolParams>;

            const result = await changeDatabaseTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.include(sampleDatabase);
        });

        test("should return error when connection is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new ChangeDatabaseTool(
                noConnectionMock as unknown as ConnectionManager,
            );

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    database: sampleDatabase,
                },
            } as vscode.LanguageModelToolInvocationOptions<ChangeDatabaseToolParams>;

            const result = await toolWithNoConnection.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.include(sampleConnectionId);
        });

        test("should return error when database change fails", async () => {
            mockConnectionManager.connect.resolves(false);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    database: sampleDatabase,
                },
            } as vscode.LanguageModelToolInvocationOptions<ChangeDatabaseToolParams>;

            const result = await changeDatabaseTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.include(sampleDatabase);
        });
    });

    suite("prepareInvocation", () => {
        test("should return confirmation messages and invocation message", async () => {
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    database: sampleDatabase,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ChangeDatabaseToolParams>;

            const result = await changeDatabaseTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("Change Database");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
            expect(result.invocationMessage).to.include(sampleDatabase);
        });

        test("should include both display name and connection ID in messages", async () => {
            const mockCredentialsWithDetails = {
                server: "sqlserver.example.com",
                database: "CurrentDB",
                authenticationType: "SqlLogin",
                user: "dbadmin",
            } as IConnectionProfile;

            const mockConnectionInfoWithDetails = {
                credentials: mockCredentialsWithDetails,
                connectionId: sampleConnectionId,
            } as unknown as ConnectionInfo;

            mockConnectionManager.getConnectionInfo.returns(mockConnectionInfoWithDetails);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    database: sampleDatabase,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ChangeDatabaseToolParams>;

            const result = await changeDatabaseTool.prepareInvocation(options, mockToken);

            // Verify display name components are present
            expect(result.invocationMessage).to.include("sqlserver.example.com");
            expect(result.invocationMessage).to.include("CurrentDB");
            // Verify connection ID is present for debugging
            expect(result.invocationMessage).to.include(sampleConnectionId);
            // Verify target database is present
            expect(result.invocationMessage).to.include(sampleDatabase);
            // Verify both are in confirmation message
            expect(result.confirmationMessages.message.value).to.include("sqlserver.example.com");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleDatabase);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new ChangeDatabaseTool(
                noConnectionMock as unknown as ConnectionManager,
            );

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    database: sampleDatabase,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ChangeDatabaseToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            // Verify connection ID is used as fallback for display name
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });
    });
});
