/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import { expect } from "chai";
import {
    createSqlAgentRequestHandler,
    // ISqlChatResult,
} from "../../src/chat/chatAgentRequestHandler";
import { CopilotService } from "../../src/services/copilotService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as Utils from "../../src/models/utils";
import * as sinon from "sinon";
import * as telemetry from "../../src/telemetry/telemetry";
import {
    GetNextMessageResponse,
    LanguageModelChatTool,
    // LanguageModelRequestMessage,
    MessageRole,
    MessageType,
} from "../../src/models/contracts/copilot";
import { ActivityObject, ActivityStatus } from "../../src/sharedInterfaces/telemetry";

suite("Chat Agent Request Handler Tests", () => {
    let mockCopilotService: TypeMoq.IMock<CopilotService>;
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
    let generateGuidStub: sinon.SinonStub;
    let selectChatModelsStub: sinon.SinonStub;
    let startActivityStub: sinon.SinonStub;
    let sendActionEventStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;

    // Sample data for tests
    const sampleConnectionUri = "file:///path/to/sample.sql";
    const sampleConversationUri = "conversationUri1";
    const samplePrompt = "Tell me about my database schema";
    const sampleCorrelationId = "12345678-1234-1234-1234-123456789012";
    const sampleReplyText = "Here is information about your database schema";

    setup(() => {
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
        startActivityStub = sinon
            .stub(telemetry, "startActivity")
            .returns(mockActivityObject.object);
        sendActionEventStub = sinon.stub(telemetry, "sendActionEvent");

        // Stub the generateGuid function using sinon
        generateGuidStub = sinon.stub(Utils, "generateGuid").returns(sampleCorrelationId);

        // Create a mock LanguageModelChat
        mockLmChat = TypeMoq.Mock.ofType<vscode.LanguageModelChat>();

        // Stub the vscode.lm.selectChatModels function
        // First, ensure the lm object exists
        if (!vscode.lm) {
            // Create the object if it doesn't exist for testing
            (vscode as any).lm = { selectChatModels: () => Promise.resolve([]) };
        }

        // Now stub the function
        selectChatModelsStub = sinon
            .stub(vscode.lm, "selectChatModels")
            .resolves([mockLmChat.object]);

        // Mock CopilotService
        mockCopilotService = TypeMoq.Mock.ofType<CopilotService>();

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

        // Mock Language Model API
        mockLmChat
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockLanguageModelChatResponse.object));

        // Mock TextDocument for reference handling
        mockTextDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();
        mockTextDocument
            .setup((x) => x.getText(TypeMoq.It.isAny()))
            .returns(() => "SELECT * FROM users");
        mockTextDocument.setup((x) => x.languageId).returns(() => "sql");

        // Stub the workspace.openTextDocument method instead of replacing the entire workspace object
        openTextDocumentStub = sinon
            .stub(vscode.workspace, "openTextDocument")
            .resolves(mockTextDocument.object);
    });

    teardown(() => {
        // Restore all stubbed functions
        generateGuidStub.restore();

        if (selectChatModelsStub) {
            selectChatModelsStub.restore();
        }

        if (startActivityStub) {
            startActivityStub.restore();
        }

        if (sendActionEventStub) {
            sendActionEventStub.restore();
        }

        if (openTextDocumentStub) {
            openTextDocumentStub.restore();
        }

        // Clean up any remaining stubs
        sinon.restore();
    });

    test("Creates a valid chat request handler", () => {
        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
        );

        expect(handler).to.be.a("function");
    });

    test("Returns early with a default response when no models are found", async () => {
        // Setup stub to return empty array for this specific test
        selectChatModelsStub.resolves([]);

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
        );

        const result = await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        mockChatStream.verify((x) => x.markdown("No model found."), TypeMoq.Times.once());
        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Sends request to default language model when no connection URI is available", async () => {
        // Setup mock to return undefined for active editor URI
        mockVscodeWrapper.setup((x) => x.activeTextEditorUri).returns(() => undefined);

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        mockChatStream.verify((x) => x.progress(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        mockLmChat.verify(
            (x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
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

        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles conversation with RequestLLM message type", async () => {
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

        // First return a RequestLLM message type
        const requestLLMResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.RequestLLM,
            responseText: "",
            tools: [
                {
                    functionName: "testTool",
                    functionDescription: "Test tool for unit tests",
                    functionParameters: '{"type":"object","properties":{},"required":[]}',
                },
            ],
            requestMessages: [
                {
                    text: "System message",
                    role: MessageRole.System,
                },
                {
                    text: samplePrompt,
                    role: MessageRole.User,
                },
            ],
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
            .returns(() => {
                return Promise.resolve(responses[callCount++]);
            });
        // .returns(() => Promise.resolve(completeResponse));

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
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
            TypeMoq.Times.atLeast(2),
        );

        mockLmChat.verify(
            (x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        // Verify startActivity was called
        sinon.assert.called(startActivityStub);

        // Verify end was called on the activity object
        mockActivityObject.verify(
            (x) => x.end(ActivityStatus.Succeeded, TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
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

    test("Handles conversation failures", async () => {
        // Setup mocks for startConversation to fail
        mockCopilotService
            .setup((x) =>
                x.startConversation(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => Promise.resolve(false));

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        // Verify endFailed was called on the activity object
        mockActivityObject.verify(
            (x) =>
                x.endFailed(
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            TypeMoq.Times.once(),
        );

        // Should fall back to default language model
        mockLmChat.verify(
            (x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("Processes chat references correctly", async () => {
        // Create mock location and uri for references
        const mockLocation = TypeMoq.Mock.ofType<vscode.Location>();
        const mockUri = TypeMoq.Mock.ofType<vscode.Uri>();
        const mockRange = new vscode.Range(0, 0, 10, 10);

        mockLocation.setup((x) => x.uri).returns(() => mockUri.object);
        mockLocation.setup((x) => x.range).returns(() => mockRange);

        // Set up workspace to return document
        const mockWorkspace = TypeMoq.Mock.ofInstance(vscode.workspace);
        mockWorkspace
            .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockTextDocument.object));
        sinon.stub(vscode.workspace, "openTextDocument").resolves(mockTextDocument.object);
        // vscode.workspace = mockWorkspace.object as any;

        // Mock the chat references
        const mockReferences = [
            { value: mockLocation.object, modelDescription: "SQL Query" },
            { value: "SELECT COUNT(*) FROM customers", modelDescription: "Example Query" },
        ];

        mockChatRequest.setup((x) => x.references).returns(() => mockReferences as any);

        // Setup for successful conversation
        mockCopilotService
            .setup((x) =>
                x.startConversation(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => Promise.resolve(true));

        // Return a Complete message type
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
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        // Verify workspace.openTextDocument was called to process references
        mockWorkspace.verify((x) => x.openTextDocument(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test("Handles tool calls correctly during LLM response", async () => {
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

        // Return a RequestLLM message type
        const requestLLMResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.RequestLLM,
            responseText: "",
            tools: [
                {
                    functionName: "queryDatabase",
                    functionDescription: "Run a query against the database",
                    functionParameters: JSON.stringify({
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The SQL query to run",
                            },
                        },
                        required: ["query"],
                    }),
                },
            ],
            requestMessages: [
                {
                    text: "System message",
                    role: MessageRole.System,
                },
                {
                    text: samplePrompt,
                    role: MessageRole.User,
                },
            ],
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
            .returns(() => {
                return Promise.resolve(responses[callCount++]);
            });

        // Mock the language model response to include a tool call
        const toolCallPart = TypeMoq.Mock.ofType<vscode.LanguageModelToolCallPart>();
        toolCallPart.setup((x) => x.name).returns(() => "queryDatabase");
        toolCallPart.setup((x) => x.input).returns(() => ({ query: "SELECT * FROM users" }));

        // Setup a generator function that yields text and tool call parts
        mockLanguageModelChatResponse
            .setup((x) => x.stream)
            .returns(() =>
                (async function* () {
                    yield new vscode.LanguageModelTextPart("I will run a query for you");
                    yield toolCallPart.object;
                })(),
            );

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        // Verify the tool was called with the right parameters
        mockCopilotService.verify(
            (x) =>
                x.getNextMessage(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.is<LanguageModelChatTool>(
                        (tool) => tool.functionName === "queryDatabase",
                    ),
                    TypeMoq.It.isAnyString(),
                ),
            TypeMoq.Times.once(),
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

        const handler = createSqlAgentRequestHandler(
            mockCopilotService.object,
            mockVscodeWrapper.object,
            mockContext.object,
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

    test("Handles LanguageModelError errors", async () => {
        // Setup mocks for startConversation to succeed
        mockCopilotService
            .setup((x) =>
                x.startConversation(
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => Promise.resolve(true));

        // But make the LLM call throw an error
        const languageModelError = new vscode.LanguageModelError(
            "Model error",
            // "quote_limit_exceeded",
        );
        mockLmChat
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .throws(languageModelError);

        // Return a RequestLLM message type
        const requestLLMResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.RequestLLM,
            responseText: "",
            tools: [],
            requestMessages: [
                {
                    text: "System message",
                    role: MessageRole.System,
                },
                {
                    text: samplePrompt,
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
        );

        await handler(
            mockChatRequest.object,
            mockChatContext.object,
            mockChatStream.object,
            mockToken.object,
        );

        // Should show specific error message for the error code
        mockChatStream.verify(
            (x) => x.markdown(TypeMoq.It.is((msg) => msg.toString().includes("Model error"))),
            TypeMoq.Times.once(),
        );
    });

    // test("Handles RequestDirectLLM message type", async () => {
    //     // Setup mocks for startConversation
    //     mockCopilotService
    //         .setup((x) =>
    //             x.startConversation(
    //                 TypeMoq.It.isAnyString(),
    //                 TypeMoq.It.isAnyString(),
    //                 TypeMoq.It.isAnyString(),
    //             ),
    //         )
    //         .returns(() => Promise.resolve(true));

    //     // Return a RequestDirectLLM message type
    //     const requestDirectLLMResponse: GetNextMessageResponse = {
    //         conversationUri: sampleConversationUri,
    //         messageType: MessageType.RequestDirectLLM,
    //         responseText: "",
    //         tools: [],
    //         requestMessages: [
    //             {
    //                 text: "System message",
    //                 role: MessageRole.System,
    //             },
    //             {
    //                 text: samplePrompt,
    //                 role: MessageRole.User,
    //             },
    //         ],
    //     };

    //     // Then return a Complete message type
    //     const completeResponse: GetNextMessageResponse = {
    //         conversationUri: sampleConversationUri,
    //         messageType: MessageType.Complete,
    //         responseText: "Conversation completed",
    //         tools: [],
    //         requestMessages: [],
    //     };

    //     let callCount = 0;
    //     const responses = [requestDirectLLMResponse, completeResponse];

    //     mockCopilotService
    //         .setup((x) =>
    //             x.getNextMessage(
    //                 TypeMoq.It.isAnyString(),
    //                 TypeMoq.It.isAnyString(),
    //                 TypeMoq.It.isAny(),
    //                 TypeMoq.It.isAny(),
    //             ),
    //         )
    //         .returns(() => {
    //             return Promise.resolve(responses[callCount++]);
    //         });

    //     const handler = createSqlAgentRequestHandler(
    //         mockCopilotService.object,
    //         mockVscodeWrapper.object,
    //         mockContext.object,
    //     );

    //     await handler(
    //         mockChatRequest.object,
    //         mockChatContext.object,
    //         mockChatStream.object,
    //         mockToken.object,
    //     );

    //     // Verify the language model was called with the right parameters
    //     mockLmChat.verify(
    //         (x) =>
    //             x.sendRequest(
    //                 TypeMoq.It.isAny(),
    //                 TypeMoq.It.is((msgs) => msgs.some((msg) => msg.text === "System message")),
    //                 TypeMoq.It.is((options) => options.tools.length === 0),
    //             ),
    //         TypeMoq.Times.once(),
    //     );

    //     // For RequestDirectLLM, we shouldn't print the textout
    //     mockChatStream.verify((x) => x.markdown(sampleReplyText), TypeMoq.Times.never());
    // });
});
