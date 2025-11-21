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
    GetConnectionDetailsTool,
    GetConnectionDetailsToolParams,
} from "../../src/copilot/tools/getConnectionDetailsTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("GetConnectionDetailsTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sandbox: sinon.SinonSandbox;
    let getConnectionDetailsTool: GetConnectionDetailsTool;

    const sampleConnectionId = "connection-details-123";

    setup(() => {
        sandbox = sinon.createSandbox();

        mockCredentials = {
            server: "detailsserver.database.windows.net",
            database: "DetailsDB",
        } as IConnectionProfile;

        mockConnectionInfo = {
            credentials: mockCredentials,
            connectionId: sampleConnectionId,
        } as unknown as ConnectionInfo;

        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);

        mockToken = {} as vscode.CancellationToken;

        getConnectionDetailsTool = new GetConnectionDetailsTool(
            mockConnectionManager as unknown as ConnectionManager,
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<GetConnectionDetailsToolParams>;

            const result = await getConnectionDetailsTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("Get Connection Details");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });

        test("should include both display name and connection ID in messages", async () => {
            const mockCredentialsWithDetails = {
                server: "infoserver.database.windows.net",
                database: "InfoDB",
                authenticationType: "SqlLogin",
                user: "infouser",
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
            } as vscode.LanguageModelToolInvocationPrepareOptions<GetConnectionDetailsToolParams>;

            const result = await getConnectionDetailsTool.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include("infoserver.database.windows.net");
            expect(result.invocationMessage).to.include("InfoDB");
            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(
                "infoserver.database.windows.net",
            );
            expect(result.confirmationMessages.message.value).to.include("InfoDB");
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });

        test("should fall back to connection ID when connection info is not found", async () => {
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new GetConnectionDetailsTool(
                noConnectionMock as unknown as ConnectionManager,
            );

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<GetConnectionDetailsToolParams>;

            const result = await toolWithNoConnection.prepareInvocation(options, mockToken);

            expect(result.invocationMessage).to.include(sampleConnectionId);
            expect(result.confirmationMessages.message.value).to.include(sampleConnectionId);
        });
    });
});
