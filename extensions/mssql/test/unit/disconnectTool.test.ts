/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { DisconnectTool, DisconnectToolParams } from "../../src/copilot/tools/disconnectTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("DisconnectTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let disconnectTool: DisconnectTool;

    const sampleConnectionId = "connection-disconnect-123";

    setup(() => {
        sandbox = sinon.createSandbox();

        mockCredentials = {
            server: "testserver.database.windows.net",
            database: "TestDB",
        } as IConnectionProfile;

        mockConnectionInfo = {
            credentials: mockCredentials,
            connectionId: sampleConnectionId,
        } as unknown as ConnectionInfo;

        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);
        mockConnectionManager.disconnect.resolves();

        mockToken = {} as vscode.CancellationToken;

        disconnectTool = new DisconnectTool(mockConnectionManager);
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<DisconnectToolParams>;

            const result = await disconnectTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("Disconnect");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });

        test("should include both display name and connection ID in messages", async () => {
            const mockCredentialsWithDetails = {
                server: "prodserver.database.windows.net",
                database: "ProductionDB",
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<DisconnectToolParams>;

            const result = await disconnectTool.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include("prodserver.database.windows.net");
            expect(result.invocationMessage).to.include("ProductionDB");
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(
                "prodserver.database.windows.net",
            );
            expect(result.confirmationMessages.message.value).to.include("ProductionDB");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new DisconnectTool(noConnectionMock);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<DisconnectToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });
    });
});
