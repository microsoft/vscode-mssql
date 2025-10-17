/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import { expect } from "chai";
import { createSqlAgentRequestHandler } from "../../src/copilot/chatAgentRequestHandler";
import { CopilotService } from "../../src/services/copilotService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as Utils from "../../src/models/utils";
import * as sinon from "sinon";
import * as telemetry from "../../src/telemetry/telemetry";
import {
    GetNextMessageResponse,
    MessageType,
    MessageRole,
} from "../../src/models/contracts/copilot";
import { ActivityObject, ActivityStatus } from "../../src/sharedInterfaces/telemetry";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";

suite("Chat Agent Request Handler Tests", () => {
    let mockCopilotService: TypeMoq.IMock<CopilotService>;
    let mockMainController: TypeMoq.IMock<MainController>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockConnectionInfo: TypeMoq.IMock<ConnectionInfo>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockLmChat: TypeMoq.IMock<vscode.LanguageModelChat>;
    let mockChatStream: TypeMoq.IMock<vscode.ChatResponseStream>;
    let mockChatRequest: TypeMoq.IMock<vscode.ChatRequest>;
    let mockChatContext: TypeMoq.IMock<vscode.ChatContext>;
    let mockToken: TypeMoq.IMock<vscode.CancellationToken>;
    let mockTextDocument: TypeMoq.IMock<vscode.TextDocument>;
    let mockConfiguration: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
    let mockLanguageModelChatResponse: TypeMoq.IMock<vscode.LanguageModelChatResponse>;
    let mockActivityObject: TypeMoq.IMock<ActivityObject>;
    let startActivityStub: sinon.SinonStub;
    let sandbox: sinon.SinonSandbox;

    // Sample data for tests
    const sampleConnectionUri = "file:///path/to/sample.sql";
    const sampleConversationUri = "conversationUri1";
    const samplePrompt = "Tell me about my database schema";
    const sampleCorrelationId = "12345678-1234-1234-1234-123456789012";
    const sampleReplyText = "Here is information about your database schema";

    setup(() => {
        sandbox = sinon.createSandbox();
        // Create the mock activity object for startActivity to return
        mockActivityObject = TypeMoq.Mock.ofType<ActivityObject>();
        mockActivityObject
            .setup((x) => x.end(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => undefined);
        mockActivityObject
            .setup((x) =>
                x.endFailed(
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => undefined);

        // Stub telemetry functions
        startActivityStub = sandbox
            .stub(telemetry, "startActivity")
            .returns(mockActivityObject.object);
        sandbox.stub(telemetry, "sendActionEvent");

        // Stub the generateGuid function using sinon
        sandbox.stub(Utils, "generateGuid").returns(sampleCorrelationId);

        // Create a mock LanguageModelChat
        mockLmChat = TypeMoq.Mock.ofType<vscode.LanguageModelChat>();

        // Mock CopilotService
        mockCopilotService = TypeMoq.Mock.ofType<CopilotService>();

        // Mock connectionManager
        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();

        // Mock ConnectionInfo
        mockConnectionInfo = TypeMoq.Mock.ofType<ConnectionInfo>();
        mockConnectionInfo.setup((x) => x.credentials.server).returns(() => "server");
        mockConnectionInfo.setup((x) => x.credentials.database).returns(() => "database");

        // Mock MainController
        mockMainController = TypeMoq.Mock.ofType<MainController>();
        mockMainController
            .setup((x) => x.connectionManager)
            .returns(() => mockConnectionManager.object);

        // Mock VscodeWrapper
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockVscodeWrapper.setup((x) => x.activeTextEditorUri).returns(() => sampleConnectionUri);

        // Mock configuration
        mockConfiguration = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        mockConfiguration
            .setup((x) => x.get(TypeMoq.It.isAnyString(), TypeMoq.It.isAny()))
            .returns(() => false);
        mockVscodeWrapper
            .setup((x) => x.getConfiguration())
            .returns(() => mockConfiguration.object);

        // Mock ExtensionContext
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext
            .setup((x) => x.languageModelAccessInformation)
            .returns(
                () =>
                    ({
                        canSendRequest: () => "allowed",
                    }) as any,
            );

        // Mock ChatResponseStream
        mockChatStream = TypeMoq.Mock.ofType<vscode.ChatResponseStream>();
        mockChatStream.setup((x) => x.progress(TypeMoq.It.isAnyString())).returns(() => undefined);
        mockChatStream.setup((x) => x.markdown(TypeMoq.It.isAnyString())).returns(() => undefined);

        // Mock Chat Request
        mockChatRequest = TypeMoq.Mock.ofType<vscode.ChatRequest>();
        mockChatRequest.setup((x) => x.prompt).returns(() => samplePrompt);
        mockChatRequest.setup((x) => x.references).returns(() => []);
        mockChatRequest.setup((x) => x.model).returns(() => mockLmChat.object);

        // Mock Chat Context
        mockChatContext = TypeMoq.Mock.ofType<vscode.ChatContext>();
        mockChatContext.setup((x) => x.history).returns(() => []);

        // Mock CancellationToken
        mockToken = TypeMoq.Mock.ofType<vscode.CancellationToken>();

        // Mock LanguageModelChatResponse
        mockLanguageModelChatResponse = TypeMoq.Mock.ofType<vscode.LanguageModelChatResponse>();
        mockLanguageModelChatResponse
            .setup((x) => x.stream)
            .returns(() =>
                (async function* () {
                    yield new vscode.LanguageModelTextPart(sampleReplyText);
                })(),
            );

        // Had to create a real object instead of using TypeMoq for the response object
        const mockResponseObject = {
            stream: (async function* () {
                yield new vscode.LanguageModelTextPart(sampleReplyText);
            })(),
            text: (async function* () {
                yield sampleReplyText;
            })(),
        };

        mockLmChat
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResponseObject));

        // Mock TextDocument for reference handling
        mockTextDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();
        mockTextDocument
            .setup((x) => x.getText(TypeMoq.It.isAny()))
            .returns(() => "SELECT * FROM users");
        mockTextDocument.setup((x) => x.languageId).returns(() => "sql");

        // Stub the workspace.openTextDocument method instead of replacing the entire workspace object
        sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockTextDocument.object);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Creates a valid chat request handler", () => {
        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
            mockMainController.object,
        );

        expect(typeof handler).to.equal("function");
    });

    test("Returns early with a default response when no models are found", async () => {
        // Create a fresh mock request for this test to avoid conflicts
        const testMockChatRequest = TypeMoq.Mock.ofType<vscode.ChatRequest>();
        testMockChatRequest.setup((x) => x.prompt).returns(() => samplePrompt);
        testMockChatRequest.setup((x) => x.references).returns(() => []);
        testMockChatRequest.setup((x) => x.model).returns(() => undefined);

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
            mockMainController.object,
        );

        const result = await handler(
            testMockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        mockChatStream.verify((x) => x.markdown("No model found."), TypeMoq.Times.once());
        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles successful conversation flow with complete message type", async () => {
        // Setup mocks for startConversation
        mockCopilotService
            .setup((x) =>
                x.startConversation(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => Promise.resolve(true));

        // Mock the getConnectionInfo method to return a valid connection
        mockConnectionManager
            .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
            .returns(() => mockConnectionInfo.object);

        // Mock the getNextMessage to return a Complete message type
        const completeResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.Complete,
            responseText: "Conversation completed",
            tools: [],
            requestMessages: [],
        };

        mockCopilotService
            .setup((x) =>
                x.getNextMessage(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => Promise.resolve(completeResponse));

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
            mockMainController.object,
        );

        const result = await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        mockCopilotService.verify(
            (x) => x.startConversation(TypeMoq.It.isAnyString(), sampleConnectionUri, samplePrompt),
            TypeMoq.Times.once(),
        );

        mockCopilotService.verify(
            (x) =>
                x.getNextMessage(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            TypeMoq.Times.once(),
        );

        // Verify startActivity was called
        sinon.assert.called(startActivityStub);

        // Verify end was called on the activity object
        mockActivityObject.verify(
            (x) => x.end(ActivityStatus.Succeeded, TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        mockChatStream.verify(
            (x) => x.markdown(TypeMoq.It.is((msg) => msg.toString().startsWith("> 🟢"))),
            TypeMoq.Times.once(),
        );

        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles conversation with disconnected editor", async () => {
        // Mock the getConnectionInfo method to return an invalid connection
        mockConnectionManager
            .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
            .returns(() => {
                return undefined;
            });

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
            mockMainController.object,
        );

        const result = await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        mockChatStream.verify(
            (x) => x.markdown(TypeMoq.It.is((msg) => msg.toString().startsWith("> ⚠️"))),
            TypeMoq.Times.once(),
        );

        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles conversation with Fragment message type", async () => {
        // Setup mocks for startConversation
        mockCopilotService
            .setup((x) =>
                x.startConversation(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => Promise.resolve(true));

        // Mock the getConnectionInfo method to return a valid connection
        mockConnectionManager
            .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
            .returns(() => mockConnectionInfo.object);

        // First return a Fragment message type
        const fragmentResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.Fragment,
            responseText: "Fragment message",
            tools: [],
            requestMessages: [],
        };

        // Then return a Complete message type
        const completeResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.Complete,
            responseText: "Conversation completed",
            tools: [],
            requestMessages: [],
        };

        let callCount = 0;
        const responses = [fragmentResponse, completeResponse];

        mockCopilotService
            .setup((x) =>
                x.getNextMessage(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => {
                return Promise.resolve(responses[callCount++]);
            });

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
            mockMainController.object,
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        mockCopilotService.verify(
            (x) =>
                x.getNextMessage(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            TypeMoq.Times.exactly(2),
        );
    });

    test("Handles errors during conversation gracefully", async () => {
        // Setup mocks for startConversation to throw
        mockCopilotService
            .setup((x) =>
                x.startConversation(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .throws(new Error("Connection failed"));

        // Mock the getConnectionInfo method to return a valid connection
        mockConnectionManager
            .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
            .returns(() => mockConnectionInfo.object);

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
            mockMainController.object,
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        // Should show error message
        mockChatStream.verify(
            (x) => x.markdown(TypeMoq.It.is((msg) => msg.toString().includes("An error occurred"))),
            TypeMoq.Times.once(),
        );
    });

    suite("Tool Mapping Tests", () => {
        test("Handles tools with valid JSON parameters in RequestLLM message", async () => {
            // Setup mocks for startConversation
            mockCopilotService
                .setup((x) =>
                    x.startConversation(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                    ),
                )
                .returns(() => Promise.resolve(true));

            // Mock the getConnectionInfo method to return a valid connection
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
                .returns(() => mockConnectionInfo.object);

            // Mock the getNextMessage to return RequestLLM with valid tools
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_list_tables",
                        functionDescription: "Lists all tables in the database",
                        functionParameters:
                            '{"type":"object","properties":{"connectionId":{"type":"string"}}}',
                    },
                ],
                requestMessages: [
                    {
                        text: "List the tables",
                        role: MessageRole.User,
                    },
                ],
            };

            const completeResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.Complete,
                responseText: "Request complete",
                tools: [],
                requestMessages: [],
            };

            let callCount = 0;
            const responses = [requestLLMResponse, completeResponse];

            mockCopilotService
                .setup((x) =>
                    x.getNextMessage(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => Promise.resolve(responses[callCount++]));

            const handler = createSqlAgentRequestHandler(
                mockCopilotService.object,
                mockVscodeWrapper.object,
                mockContext.object,
                mockMainController.object,
            );

            const result = await handler(
                mockChatRequest.object,
                mockChatContext.object,
                mockChatStream.object,
                mockToken.object,
            );

            // Verify that the handler completed successfully
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });

            // Verify sendRequest was called with tools
            mockLmChat.verify(
                (x) =>
                    x.sendRequest(
                        TypeMoq.It.is((messages) => Array.isArray(messages)),
                        TypeMoq.It.is(
                            (options) => Array.isArray(options.tools) && options.tools.length > 0,
                        ),
                        TypeMoq.It.isAny(),
                    ),
                TypeMoq.Times.once(),
            );
        });

        test("Handles tools with invalid JSON parameters by falling back to empty schema", async () => {
            // Setup mocks for startConversation
            mockCopilotService
                .setup((x) =>
                    x.startConversation(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                    ),
                )
                .returns(() => Promise.resolve(true));

            // Mock the getConnectionInfo method to return a valid connection
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
                .returns(() => mockConnectionInfo.object);

            // Mock the getNextMessage to return RequestLLM with invalid JSON in tool parameters
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_run_query",
                        functionDescription: "Runs a SQL query",
                        functionParameters: "{invalid json syntax here}", // Invalid JSON
                    },
                ],
                requestMessages: [
                    {
                        text: "Run query",
                        role: MessageRole.User,
                    },
                ],
            };

            const completeResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.Complete,
                responseText: "Request complete",
                tools: [],
                requestMessages: [],
            };

            let callCount = 0;
            const responses = [requestLLMResponse, completeResponse];

            mockCopilotService
                .setup((x) =>
                    x.getNextMessage(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => Promise.resolve(responses[callCount++]));

            const handler = createSqlAgentRequestHandler(
                mockCopilotService.object,
                mockVscodeWrapper.object,
                mockContext.object,
                mockMainController.object,
            );

            // Should not throw, but handle gracefully with fallback schema
            const result = await handler(
                mockChatRequest.object,
                mockChatContext.object,
                mockChatStream.object,
                mockToken.object,
            );

            // Verify that the handler completed successfully despite invalid JSON
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });

            // Verify sendRequest was still called (with fallback empty schema)
            mockLmChat.verify(
                (x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });

        test("Handles tools with null or undefined description", async () => {
            // Setup mocks for startConversation
            mockCopilotService
                .setup((x) =>
                    x.startConversation(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                    ),
                )
                .returns(() => Promise.resolve(true));

            // Mock the getConnectionInfo method to return a valid connection
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
                .returns(() => mockConnectionInfo.object);

            // Mock the getNextMessage to return RequestLLM with null description
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_connect",
                        functionDescription: undefined as unknown as string, // Undefined description
                        functionParameters: '{"type":"object"}',
                    },
                ],
                requestMessages: [
                    {
                        text: "Connect to database",
                        role: MessageRole.User,
                    },
                ],
            };

            const completeResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.Complete,
                responseText: "Request complete",
                tools: [],
                requestMessages: [],
            };

            let callCount = 0;
            const responses = [requestLLMResponse, completeResponse];

            mockCopilotService
                .setup((x) =>
                    x.getNextMessage(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => Promise.resolve(responses[callCount++]));

            const handler = createSqlAgentRequestHandler(
                mockCopilotService.object,
                mockVscodeWrapper.object,
                mockContext.object,
                mockMainController.object,
            );

            const result = await handler(
                mockChatRequest.object,
                mockChatContext.object,
                mockChatStream.object,
                mockToken.object,
            );

            // Verify that the handler completed successfully
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });
        });

        test("Handles tools with empty or whitespace-only parameters", async () => {
            // Setup mocks for startConversation
            mockCopilotService
                .setup((x) =>
                    x.startConversation(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                    ),
                )
                .returns(() => Promise.resolve(true));

            // Mock the getConnectionInfo method to return a valid connection
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
                .returns(() => mockConnectionInfo.object);

            // Mock the getNextMessage to return RequestLLM with empty parameters
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_disconnect",
                        functionDescription: "Disconnects from database",
                        functionParameters: "   ", // Whitespace-only
                    },
                ],
                requestMessages: [
                    {
                        text: "Disconnect",
                        role: MessageRole.User,
                    },
                ],
            };

            const completeResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.Complete,
                responseText: "Request complete",
                tools: [],
                requestMessages: [],
            };

            let callCount = 0;
            const responses = [requestLLMResponse, completeResponse];

            mockCopilotService
                .setup((x) =>
                    x.getNextMessage(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => Promise.resolve(responses[callCount++]));

            const handler = createSqlAgentRequestHandler(
                mockCopilotService.object,
                mockVscodeWrapper.object,
                mockContext.object,
                mockMainController.object,
            );

            const result = await handler(
                mockChatRequest.object,
                mockChatContext.object,
                mockChatStream.object,
                mockToken.object,
            );

            // Verify that the handler completed successfully with fallback empty schema
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });
        });

        test("Throws error when tool has invalid or missing functionName", async () => {
            // Setup mocks for startConversation
            mockCopilotService
                .setup((x) =>
                    x.startConversation(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                    ),
                )
                .returns(() => Promise.resolve(true));

            // Mock the getConnectionInfo method to return a valid connection
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAnyString()))
                .returns(() => mockConnectionInfo.object);

            // Mock the getNextMessage to return RequestLLM with missing functionName
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: undefined as unknown as string, // Missing function name
                        functionDescription: "A tool without a name",
                        functionParameters: '{"type":"object"}',
                    },
                ],
                requestMessages: [
                    {
                        text: "Test request",
                        role: MessageRole.User,
                    },
                ],
            };

            mockCopilotService
                .setup((x) =>
                    x.getNextMessage(
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAnyString(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => Promise.resolve(requestLLMResponse));

            const handler = createSqlAgentRequestHandler(
                mockCopilotService.object,
                mockVscodeWrapper.object,
                mockContext.object,
                mockMainController.object,
            );

            // Should handle the error and show error message
            await handler(
                mockChatRequest.object,
                mockChatContext.object,
                mockChatStream.object,
                mockToken.object,
            );

            // Verify error message is shown
            mockChatStream.verify(
                (x) =>
                    x.markdown(
                        TypeMoq.It.is((msg) => msg.toString().includes("An error occurred")),
                    ),
                TypeMoq.Times.once(),
            );
        });
    });
});
