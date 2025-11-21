/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ListSchemasTool, ListSchemasToolParams } from "../../src/copilot/tools/listSchemasTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("ListSchemasTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockServiceClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let listSchemasTool: ListSchemasTool;

    const sampleConnectionId = "connection-schemas-123";

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

        listSchemasTool = new ListSchemasTool(mockConnectionManager, mockServiceClient);
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListSchemasToolParams>;

            const result = await listSchemasTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("List Schemas");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });

        test("should include both display name and connection ID in messages", async () => {
            const mockCredentialsWithDetails = {
                server: "schemaserver.database.windows.net",
                database: "AppDatabase",
                authenticationType: "SqlLogin",
                user: "schemauser",
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListSchemasToolParams>;

            const result = await listSchemasTool.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include("schemaserver.database.windows.net");
            expect(result.invocationMessage).to.include("AppDatabase");
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(
                "schemaserver.database.windows.net",
            );
            expect(result.confirmationMessages.message.value).to.include("AppDatabase");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new ListSchemasTool(noConnectionMock, mockServiceClient);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<ListSchemasToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });
    });
});
