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
import { RunQueryTool, RunQueryToolParams } from "../../src/copilot/tools/runQueryTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import * as telemetry from "../../src/telemetry/telemetry";
import { SimpleExecuteResult } from "vscode-mssql";
import { IConnectionProfile } from "../../src/models/interfaces";
import { UserSurvey } from "../../src/nps/userSurvey";

chai.use(sinonChai);

suite("RunQueryTool Tests", () => {
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockServiceClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionInfo: ConnectionInfo;
    let mockCredentials: IConnectionProfile;
    let mockToken: vscode.CancellationToken;
    let sendActionEventStub: sinon.SinonStub;
    let sandbox: sinon.SinonSandbox;
    let runQueryTool: RunQueryTool;

    const sampleConnectionId = "connection-123";
    const sampleQuery = "SELECT * FROM Users";
    const sampleQueryTypes = ["SELECT", "JOIN"];
    const sampleQueryIntent = "data_exploration";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub telemetry
        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");

        // Stub UserSurvey
        const mockUserSurvey = {
            promptUserForNPSFeedback: sinon.stub(),
        };
        sandbox.stub(UserSurvey, "getInstance").returns(mockUserSurvey as any);

        // Mock credentials
        mockCredentials = {} as IConnectionProfile;

        // Mock ConnectionInfo - use partial mock with unknown cast
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
        runQueryTool = new RunQueryTool(
            mockConnectionManager as unknown as ConnectionManager,
            mockServiceClient as unknown as SqlToolsServiceClient,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("call", () => {
        test("should send telemetry with queryTypes and queryIntent on execute", async () => {
            const mockResult: SimpleExecuteResult = {
                rowCount: 5,
                columnInfo: [{ columnName: "id" }, { columnName: "name" }] as any,
                rows: [
                    [1, "Alice"],
                    [2, "Bob"],
                ] as any,
            };

            mockServiceClient.sendRequest.resolves(mockResult);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: sampleQueryTypes,
                    queryIntent: sampleQueryIntent,
                },
            } as vscode.LanguageModelToolInvocationOptions<RunQueryToolParams>;

            await runQueryTool.call(options, mockToken);

            // Verify telemetry was sent with correct parameters
            expect(sendActionEventStub.calledOnce).to.be.true;
            const telemetryCall = sendActionEventStub.getCall(0);
            expect(telemetryCall.args[2]).to.deep.include({
                phase: "execute",
                queryTypes: "SELECT,JOIN",
                queryIntent: "data_exploration",
            });
        });

        test("should return success result when query executes successfully", async () => {
            const mockResult: SimpleExecuteResult = {
                rowCount: 3,
                columnInfo: [{ columnName: "count" }] as any,
                rows: [[3]] as any,
            };

            mockServiceClient.sendRequest.resolves(mockResult);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: sampleQueryTypes,
                    queryIntent: sampleQueryIntent,
                },
            } as vscode.LanguageModelToolInvocationOptions<RunQueryToolParams>;

            const result = await runQueryTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.rowCount).to.equal(3);
            expect(parsedResult.columnInfo).to.have.lengthOf(1);
        });

        test("should return error when connection is not found", async () => {
            // Create a new mock that returns undefined for this specific test
            const noConnectionMock = sandbox.createStubInstance(ConnectionManager);
            noConnectionMock.getConnectionInfo.returns(undefined as any);

            const toolWithNoConnection = new RunQueryTool(
                noConnectionMock as unknown as ConnectionManager,
                mockServiceClient as unknown as SqlToolsServiceClient,
            );

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: sampleQueryTypes,
                    queryIntent: sampleQueryIntent,
                },
            } as vscode.LanguageModelToolInvocationOptions<RunQueryToolParams>;

            const result = await toolWithNoConnection.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.include(sampleConnectionId);
        });

        test("should return error when query execution fails", async () => {
            const errorMessage = "Syntax error near SELECT";
            mockServiceClient.sendRequest.rejects(new Error(errorMessage));

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: sampleQueryTypes,
                    queryIntent: sampleQueryIntent,
                },
            } as vscode.LanguageModelToolInvocationOptions<RunQueryToolParams>;

            const result = await runQueryTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(errorMessage);
        });

        test("should handle unknown queryTypes and queryIntent gracefully", async () => {
            const mockResult: SimpleExecuteResult = {
                rowCount: 0,
                columnInfo: [] as any,
                rows: [] as any,
            };

            mockServiceClient.sendRequest.resolves(mockResult);

            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: undefined as any,
                    queryIntent: undefined as any,
                },
            } as vscode.LanguageModelToolInvocationOptions<RunQueryToolParams>;

            await runQueryTool.call(options, mockToken);

            // Verify telemetry defaults to "unknown"
            const telemetryCall = sendActionEventStub.getCall(0);
            expect(telemetryCall.args[2]).to.deep.include({
                phase: "execute",
                queryTypes: "unknown",
                queryIntent: "unknown",
            });
        });
    });

    suite("prepareInvocation", () => {
        test("should send telemetry with queryTypes and queryIntent on prepare", async () => {
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: ["DROP", "DELETE"],
                    queryIntent: "data_maintenance",
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<RunQueryToolParams>;

            await runQueryTool.prepareInvocation(options, mockToken);

            // Verify telemetry was sent with prepare phase
            expect(sendActionEventStub.calledOnce).to.be.true;
            const telemetryCall = sendActionEventStub.getCall(0);
            expect(telemetryCall.args[2]).to.deep.include({
                phase: "prepare",
                queryTypes: "DROP,DELETE",
                queryIntent: "data_maintenance",
            });
        });

        test("should return confirmation messages and invocation message", async () => {
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: sampleQuery,
                    queryTypes: sampleQueryTypes,
                    queryIntent: sampleQueryIntent,
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<RunQueryToolParams>;

            const result = await runQueryTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("Run Query");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
            expect(result.invocationMessage).to.include(sampleConnectionId);
        });

        test("should track destructive operations in prepare phase", async () => {
            const destructiveQueryTypes = ["DROP", "DELETE", "TRUNCATE"];
            const options = {
                input: {
                    connectionId: sampleConnectionId,
                    query: "DROP TABLE Users",
                    queryTypes: destructiveQueryTypes,
                    queryIntent: "schema_modification",
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<RunQueryToolParams>;

            await runQueryTool.prepareInvocation(options, mockToken);

            // Verify destructive operations are tracked
            const telemetryCall = sendActionEventStub.getCall(0);
            expect(telemetryCall.args[2].queryTypes).to.equal("DROP,DELETE,TRUNCATE");
            expect(telemetryCall.args[2].queryIntent).to.equal("schema_modification");
        });
    });
});
