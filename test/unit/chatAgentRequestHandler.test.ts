/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as TypeMoq from "typemoq";
import {
    createSqlAgentRequestHandler,
    provideFollowups,
    ISqlChatResult,
} from "../../src/copilot/chatAgentRequestHandler";
import { CopilotService } from "../../src/services/copilotService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as Utils from "../../src/models/utils";
import * as telemetry from "../../src/telemetry/telemetry";
import {
    GetNextMessageResponse,
    MessageType,
    MessageRole,
} from "../../src/models/contracts/copilot";
import { ActivityObject, ActivityStatus } from "../../src/sharedInterfaces/telemetry";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { connectedLabelPrefix, disconnectedLabelPrefix } from "../../src/copilot/chatConstants";
import { IConnectionInfo } from "vscode-mssql";

chai.use(sinonChai);
const expect = chai.expect;

suite("Chat Agent Request Handler Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let copilotService: sinon.SinonStubbedInstance<CopilotService>;
    let mainController: sinon.SinonStubbedInstance<MainController>;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let activityObject: ActivityObject & {
        end: sinon.SinonStub;
        endFailed: sinon.SinonStub;
        update: sinon.SinonStub;
    };
    let connectionInfo: ConnectionInfo;
    let extensionContext: vscode.ExtensionContext;
    let languageModelChat: vscode.LanguageModelChat;
    let languageModelChatSendRequest: sinon.SinonStub;
    let chatStream: vscode.ChatResponseStream;
    let chatStreamMarkdown: sinon.SinonStub;
    let chatStreamProgress: sinon.SinonStub;
    let chatRequest: vscode.ChatRequest;
    let chatContext: vscode.ChatContext;
    let cancellationToken: vscode.CancellationToken;
    let textDocument: vscode.TextDocument;
    let configuration: vscode.WorkspaceConfiguration;
    let configurationGet: sinon.SinonStub;
    let startActivityStub: sinon.SinonStub;

    // Sample data for tests
    const sampleConnectionUri = "file:///path/to/sample.sql";
    const sampleConversationUri = "conversationUri1";
    const samplePrompt = "Tell me about my database schema";
    const sampleCorrelationId = "12345678-1234-1234-1234-123456789012";
    const sampleReplyText = "Here is information about your database schema";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create the mock activity object for startActivity to return
        activityObject = {
            end: sandbox.stub(),
            endFailed: sandbox.stub(),
            update: sandbox.stub(),
        } as unknown as ActivityObject & {
            end: sinon.SinonStub;
            endFailed: sinon.SinonStub;
            update: sinon.SinonStub;
        };

        // Stub telemetry functions
        startActivityStub = sandbox.stub(telemetry, "startActivity").returns(activityObject);
        sandbox.stub(telemetry, "sendActionEvent");
        // Stub the generateGuid function using sinon
        sandbox.stub(Utils, "generateGuid").returns(sampleCorrelationId);

        // Mock CopilotService
        copilotService = sandbox.createStubInstance(CopilotService);
        // Mock MainController
        mainController = sandbox.createStubInstance(MainController);
        // Mock connectionManager
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        sandbox.stub(mainController, "connectionManager").get(() => connectionManager);

        // Mock ConnectionInfo
        connectionInfo = new ConnectionInfo();
        connectionInfo.credentials = {
            server: "server",
            database: "database",
        } as IConnectionInfo;

        // Mock VscodeWrapper
        vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => sampleConnectionUri);

        // Mock configuration
        configurationGet = sandbox.stub().returns(false);
        configuration = {
            get: configurationGet,
        } as unknown as vscode.WorkspaceConfiguration;
        vscodeWrapper.getConfiguration.returns(configuration);

        // Mock ExtensionContext
        const canSendRequestStub = sandbox.stub().returns("allowed");
        extensionContext = {
            languageModelAccessInformation: {
                canSendRequest: canSendRequestStub,
            },
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        // CODEX: mockChatStream became chatStream
        // Mock ChatResponseStream
        mockChatStream = TypeMoq.Mock.ofType<vscode.ChatResponseStream>();
        mockChatStream.setup((x) => x.progress(TypeMoq.It.isAnyString())).returns(() => undefined);
        mockChatStream.setup((x) => x.markdown(TypeMoq.It.isAnyString())).returns(() => undefined);

        // CODEX: mockChatRequest became chatRequest
        // Mock Chat Request
        mockChatRequest = TypeMoq.Mock.ofType<vscode.ChatRequest>();
        mockChatRequest.setup((x) => x.prompt).returns(() => samplePrompt);
        mockChatRequest.setup((x) => x.references).returns(() => []);
        mockChatRequest.setup((x) => x.model).returns(() => mockLmChat.object);

        // Mock Chat Context
        mockChatContext = TypeMoq.Mock.ofType<vscode.ChatContext>();
        mockChatContext.setup((x) => x.history).returns(() => []);

        // CODEX: mockToken became cancellationToken
        // Mock CancellationToken
        mockToken = TypeMoq.Mock.ofType<vscode.CancellationToken>();

        // CODEX: mockLanguageModelChatResponse is new, and has not yet been converted
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
        const defaultResponse = {
            stream: (async function* () {
                yield new vscode.LanguageModelTextPart(sampleReplyText);
            })(),
            text: (async function* () {
                yield sampleReplyText;
            })(),
        };

        // Create a mock LanguageModelChat
        languageModelChatSendRequest = sandbox.stub().resolves(defaultResponse);
        languageModelChat = {
            sendRequest: languageModelChatSendRequest,
        } as unknown as vscode.LanguageModelChat;

        // Mock ChatResponseStream
        chatStreamMarkdown = sandbox.stub().returns(undefined);
        chatStreamProgress = sandbox.stub().returns(undefined);
        chatStream = {
            markdown: chatStreamMarkdown,
            progress: chatStreamProgress,
        } as unknown as vscode.ChatResponseStream;

        // Mock Chat Request
        chatRequest = {
            prompt: samplePrompt,
            references: [],
            model: languageModelChat,
        } as unknown as vscode.ChatRequest;

        // Mock Chat Context
        chatContext = {
            history: [],
        } as vscode.ChatContext;

        // Mock CancellationToken
        const disposeStub = sandbox.stub();
        cancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub().returns({ dispose: disposeStub }),
        } as vscode.CancellationToken;

        // Mock TextDocument for reference handling
        textDocument = {
            getText: sandbox.stub().returns("SELECT * FROM users"),
            languageId: "sql",
        } as unknown as vscode.TextDocument;

        // Stub the workspace.openTextDocument method instead of replacing the entire workspace object
        sandbox.stub(vscode.workspace, "openTextDocument").resolves(textDocument);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createHandler(): ReturnType<typeof createSqlAgentRequestHandler> {
        return createSqlAgentRequestHandler(
            copilotService,
            vscodeWrapper,
            extensionContext,
            mainController,
        );
    }

    function getMarkdownMessages(): string[] {
        return chatStreamMarkdown.getCalls().map((call) => {
            const [message] = call.args;
            return message === undefined || message === null ? "" : message.toString();
        });
    }

    function markdownMatchCount(predicate: (message: string) => boolean): number {
        return getMarkdownMessages().filter((value) => predicate(value)).length;
    }

    test("Creates a valid chat request handler", () => {
        const handler = createHandler();

        expect(handler).to.be.a("function");
    });

    test("Returns early with a default response when no models are found", async () => {
        // Create a fresh request for this test to avoid conflicts
        const requestWithoutModel = {
            prompt: samplePrompt,
            references: [],
            model: undefined,
        } as unknown as vscode.ChatRequest;

        const handler = createHandler();

        const result = await handler(
            requestWithoutModel,
            chatContext,
            chatStream,
            cancellationToken,
        );

        expect(markdownMatchCount((msg) => msg === "No model found.")).to.equal(1);
        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles successful conversation flow with complete message type", async () => {
        // Setup mocks for startConversation
        copilotService.startConversation.resolves(true);
        // Mock the getConnectionInfo method to return a valid connection
        connectionManager.getConnectionInfo.callsFake(() => connectionInfo);

        const completeResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.Complete,
            responseText: "Conversation completed",
            tools: [],
            requestMessages: [],
        };

        // Mock the getNextMessage to return a Complete message type
        copilotService.getNextMessage.resolves(completeResponse);

        const handler = createHandler();

        const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

        // Verify startActivity was called
        expect(copilotService.startConversation).to.have.been.calledOnceWith(
            sinon.match.string,
            sampleConnectionUri,
            samplePrompt,
        );
        expect(copilotService.getNextMessage).to.have.been.calledOnce;
        expect(startActivityStub).to.have.been.called;
        // Verify end was called on the activity object
        expect(activityObject.end).to.have.been.calledOnceWith(
            ActivityStatus.Succeeded,
            sinon.match.any,
        );
        const markdownMessages = getMarkdownMessages();
        const matches = markdownMessages.filter((msg) => msg.startsWith(connectedLabelPrefix));
        expect(matches.length, `markdown outputs: ${markdownMessages.join(" || ")}`).to.equal(1);
        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles conversation with disconnected editor", async () => {
        // Mock the getConnectionInfo method to return an invalid connection
        connectionManager.getConnectionInfo.callsFake(() => undefined);

        const handler = createHandler();

        const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

        const markdownMessages = getMarkdownMessages();
        const matches = markdownMessages.filter((msg) => msg.startsWith(disconnectedLabelPrefix));
        expect(matches.length, `markdown outputs: ${markdownMessages.join(" || ")}`).to.equal(1);
        expect(result).to.deep.equal({
            metadata: { command: "", correlationId: sampleCorrelationId },
        });
    });

    test("Handles conversation with Fragment message type", async () => {
        // Setup mocks for startConversation
        copilotService.startConversation.resolves(true);
        // Mock the getConnectionInfo method to return a valid connection
        connectionManager.getConnectionInfo.callsFake(() => connectionInfo);

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

        copilotService.getNextMessage.callsFake(async () => responses[callCount++]);

        const handler = createHandler();

        await handler(chatRequest, chatContext, chatStream, cancellationToken);

        expect(copilotService.getNextMessage).to.have.been.calledTwice;
    });

    test("Handles errors during conversation gracefully", async () => {
        // Setup mocks for startConversation to throw
        copilotService.startConversation.throws(new Error("Connection failed"));
        // Mock the getConnectionInfo method to return a valid connection
        connectionManager.getConnectionInfo.callsFake(() => connectionInfo);

        const handler = createHandler();

        await handler(chatRequest, chatContext, chatStream, cancellationToken);

        // Should show error message
        const markdownMessages = getMarkdownMessages();
        const matches = markdownMessages.filter((msg) => msg.includes("An error occurred"));
        expect(matches.length, `markdown outputs: ${markdownMessages.join(" || ")}`).to.equal(1);
    });

    suite("Tool Mapping Tests", () => {
        function setUpSuccessfulConversation(): void {
            copilotService.startConversation.resolves(true);
            connectionManager.getConnectionInfo.callsFake(() => connectionInfo);
        }

        test("Handles tools with valid JSON parameters in RequestLLM message", async () => {
            setUpSuccessfulConversation();

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

            copilotService.getNextMessage.callsFake(async () => responses[callCount++]);

            const handler = createHandler();

            const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

            // Verify that the handler completed successfully
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });

            // Verify sendRequest was called with tools
            expect(languageModelChatSendRequest).to.have.been.calledOnce;
            const [, options] = languageModelChatSendRequest.firstCall.args;
            expect(options.tools).to.be.an("array").that.is.not.empty;
        });

        test("Handles tools with invalid JSON parameters by falling back to empty schema", async () => {
            setUpSuccessfulConversation();

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

            copilotService.getNextMessage.callsFake(async () => responses[callCount++]);

            const handler = createHandler();

            const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

            // Should not throw, but handle gracefully with fallback schema
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });

            // Verify sendRequest was still called (with fallback empty schema)
            expect(languageModelChatSendRequest).to.have.been.calledOnce;
        });

        test("Handles tools with null or undefined description", async () => {
            setUpSuccessfulConversation();

            // Mock the getNextMessage to return RequestLLM with null description
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_connect",
                        functionDescription: undefined,
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

            copilotService.getNextMessage.callsFake(async () => responses[callCount++]);

            const handler = createHandler();

            const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

            // Verify that the handler completed successfully
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });
        });

        test("Handles tools with empty or whitespace-only parameters", async () => {
            setUpSuccessfulConversation();

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

            copilotService.getNextMessage.callsFake(async () => responses[callCount++]);

            const handler = createHandler();

            const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

            // Verify that the handler completed successfully with fallback empty schema
            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });
        });

        test("Throws error when tool has invalid or missing functionName", async () => {
            setUpSuccessfulConversation();

            // Mock the getNextMessage to return RequestLLM with missing functionName
            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: undefined,
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

            copilotService.getNextMessage.resolves(requestLLMResponse);

            const handler = createHandler();

            await handler(chatRequest, chatContext, chatStream, cancellationToken);

            // Should handle the error and show error message
            const markdownMessages = getMarkdownMessages();
            const matches = markdownMessages.filter((msg) => msg.includes("An error occurred"));
            // Verify error message is shown
            expect(matches.length, `markdown outputs: ${markdownMessages.join(" || ")}`).to.equal(
                1,
            );
        });
    });

    suite("provideFollowups Tests", () => {
        let mockMainController: TypeMoq.IMock<MainController>;
        let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
        let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
        let mockResult: ISqlChatResult;
        let mockConnection: ConnectionInfo;

        setup(() => {
            mockMainController = TypeMoq.Mock.ofType<MainController>();
            mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
            mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();

            mockMainController
                .setup((x) => x.connectionManager)
                .returns(() => mockConnectionManager.object);

            mockConnection = TypeMoq.Mock.ofType<ConnectionInfo>().object;

            mockResult = {
                metadata: {
                    command: "",
                },
            } as ISqlChatResult;
        });

        test("should return empty array for non-help commands", async () => {
            mockResult.metadata.command = "query";

            const followups = await provideFollowups(
                mockResult,
                {} as vscode.ChatContext,
                {} as vscode.CancellationToken,
                mockMainController.object,
                mockVscodeWrapper.object,
            );

            expect(followups).to.be.an("array").that.is.empty;
        });

        test("should return connect follow-up when disconnected", async () => {
            mockResult.metadata.command = "help";
            mockVscodeWrapper.setup((x) => x.activeTextEditorUri).returns(() => undefined);

            const followups = await provideFollowups(
                mockResult,
                {} as vscode.ChatContext,
                {} as vscode.CancellationToken,
                mockMainController.object,
                mockVscodeWrapper.object,
            );

            expect(followups).to.have.lengthOf(1);
            expect(followups[0]).to.have.property("prompt");
            expect(followups[0]).to.have.property("command", "connect");
        });

        test("should return database exploration follow-ups when connected", async () => {
            mockResult.metadata.command = "help";
            const mockUriString = "file:///test.sql";
            mockVscodeWrapper.setup((x) => x.activeTextEditorUri).returns(() => mockUriString);
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(mockUriString))
                .returns(() => mockConnection);

            const followups = await provideFollowups(
                mockResult,
                {} as vscode.ChatContext,
                {} as vscode.CancellationToken,
                mockMainController.object,
                mockVscodeWrapper.object,
            );

            expect(followups).to.have.lengthOf(3);
            expect(followups[0]).to.have.property("prompt");
            expect(followups[1]).to.have.property("prompt");
            expect(followups[2]).to.have.property("prompt");
        });
    });
});
