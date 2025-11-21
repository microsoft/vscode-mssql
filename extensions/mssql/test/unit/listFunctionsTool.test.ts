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
    ListFunctionsTool,
    ListFunctionsToolParams,
} from "../../src/copilot/tools/listFunctionsTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("ListFunctionsTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockServiceClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let listFunctionsTool: ListFunctionsTool;

    const sampleConnectionId = "connection-functions-123";

    setup(() => {
        sandbox = sinon.createSandbox();

        mockCredentials = {} as IConnectionProfile;

        mockConnectionInfo = {
            credentials: mockCredentials,
            connectionId: sampleConnectionId,
        } as unknown as ConnectionInfo;

        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);

        mockServiceClient = sandbox.createStubInstance(SqlToolsServiceClient);

        mockToken = {} as vscode.CancellationToken;

        listFunctionsTool = new ListFunctionsTool(
            mockConnectionManager as unknown as ConnectionManager,
            mockServiceClient as unknown as SqlToolsServiceClient,
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListFunctionsToolParams>;

            const result = await listFunctionsTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("List Functions");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });

        test("should include both display name and connection ID in messages", async () => {
            const mockCredentialsWithDetails = {
                server: "funcserver.database.windows.net",
                database: "FunctionsDB",
                authenticationType: "SqlLogin",
                user: "funcuser",
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListFunctionsToolParams>;

            const result = await listFunctionsTool.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include("funcserver.database.windows.net");
            expect(result.invocationMessage).to.include("FunctionsDB");
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(
                "funcserver.database.windows.net",
            );
            expect(result.confirmationMessages.message.value).to.include("FunctionsDB");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new ListFunctionsTool(
                noConnectionMock as unknown as ConnectionManager,
                mockServiceClient as unknown as SqlToolsServiceClient,
            );

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListFunctionsToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });
    });
});
