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
import { ShowSchemaTool, ShowSchemaToolParams } from "../../src/copilot/tools/showSchemaTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("ShowSchemaTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let showSchemaTool: ShowSchemaTool;

    const sampleConnectionId = "connection-123";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock credentials
        mockCredentials = {} as IConnectionProfile;

        // Mock ConnectionInfo
        mockConnectionInfo = {
            credentials: mockCredentials,
            connectionId: sampleConnectionId,
        } as unknown as ConnectionInfo;

        // Mock ConnectionManager
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);

        // Mock CancellationToken
        mockToken = {} as vscode.CancellationToken;

        // Create the tool instance
        const mockShowSchemaFunction = sandbox.stub().resolves();
        showSchemaTool = new ShowSchemaTool(
            mockConnectionManager as unknown as ConnectionManager,
            mockShowSchemaFunction,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("prepareInvocation", () => {
        test("should return confirmation messages and invocation message", async () => {
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ShowSchemaToolParams>;

            const result = await showSchemaTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("Show Schema");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });

        test("should include both display name and connection ID in messages", async () => {
            // Mock credentials with server and database for display name
            const mockCredentialsWithDetails = {
                server: "testserver.database.windows.net",
                database: "SampleDB",
                authenticationType: "SqlLogin",
                user: "admin",
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<ShowSchemaToolParams>;

            const result = await showSchemaTool.prepareInvocation(options, mockToken);

            // Verify display name components are present
            expect(result.invocationMessage).to.include("testserver.database.windows.net");
            expect(result.invocationMessage).to.include("SampleDB");
            // Verify connection ID is present for debugging
            expect(result.invocationMessage).to.include(sampleConnectionId);
            // Verify both are in confirmation message
            expect(result.confirmationMessages.message.value).to.include(
                "testserver.database.windows.net",
            );
            expect(result.confirmationMessages.message.value).to.include("SampleDB");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            // Create a mock that returns undefined connection info
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const mockShowSchemaFunction = sandbox.stub().resolves();
            const toolWithNoConnection = new ShowSchemaTool(
                noConnectionMock as unknown as ConnectionManager,
                mockShowSchemaFunction,
            );

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ShowSchemaToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            // Verify it shows "Unknown Connection" placeholder with connection ID
            expect(result.invocationMessage).to.include("Unknown Connection");
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include("Unknown Connection");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should handle profile name as display name", async () => {
            // Mock credentials with profile name
            const mockCredentialsWithProfile = {
                profileName: "My Production Server",
                server: "prod.database.windows.net",
                database: "ProdDB",
                authenticationType: "Integrated",
            } as IConnectionProfile;

            const mockConnectionInfoWithProfile = {
                credentials: mockCredentialsWithProfile,
                connectionId: sampleConnectionId,
            } as unknown as ConnectionInfo;

            mockConnectionManager.getConnectionInfo.returns(mockConnectionInfoWithProfile);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ShowSchemaToolParams>;

            const result = await showSchemaTool.prepareInvocation(options, mockToken);

            // Verify profile name is used as display name
            expect(result.invocationMessage).to.include("My Production Server");
            // Verify connection ID is still present for debugging
            expect(result.invocationMessage).to.include(sampleConnectionId);
        });
    });
});
