/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { createSqlAgentRequestHandler } from "../../src/copilot/chatAgentRequestHandler";
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

    const sampleConnectionUri = "file:///path/to/sample.sql";
    const sampleConversationUri = "conversationUri1";
    const samplePrompt = "Tell me about my database schema";
    const sampleCorrelationId = "12345678-1234-1234-1234-123456789012";
    const sampleReplyText = "Here is information about your database schema";

    setup(() => {
        sandbox = sinon.createSandbox();

        activityObject = {
            end: sandbox.stub(),
            endFailed: sandbox.stub(),
            update: sandbox.stub(),
        } as unknown as ActivityObject & {
            end: sinon.SinonStub;
            endFailed: sinon.SinonStub;
            update: sinon.SinonStub;
        };

        startActivityStub = sandbox.stub(telemetry, "startActivity").returns(activityObject);
        sandbox.stub(telemetry, "sendActionEvent");
        sandbox.stub(Utils, "generateGuid").returns(sampleCorrelationId);

        copilotService = sandbox.createStubInstance(CopilotService);
        mainController = sandbox.createStubInstance(MainController);
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        sandbox.stub(mainController, "connectionManager").get(() => connectionManager);

        connectionInfo = new ConnectionInfo();
        connectionInfo.credentials = {
            server: "server",
            database: "database",
        } as unknown as ConnectionInfo["credentials"];

        vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => sampleConnectionUri);

        configurationGet = sandbox.stub().returns(false);
        configuration = {
            get: configurationGet,
        } as unknown as vscode.WorkspaceConfiguration;
        vscodeWrapper.getConfiguration.returns(configuration);

        const canSendRequestStub = sandbox.stub().returns("allowed");
        extensionContext = {
            languageModelAccessInformation: {
                canSendRequest: canSendRequestStub,
            },
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        const defaultResponse = {
            stream: (async function* () {
                yield new vscode.LanguageModelTextPart(sampleReplyText);
            })(),
            text: (async function* () {
                yield sampleReplyText;
            })(),
        };

        languageModelChatSendRequest = sandbox.stub().resolves(defaultResponse);
        languageModelChat = {
            sendRequest: languageModelChatSendRequest,
        } as unknown as vscode.LanguageModelChat;

        chatStreamMarkdown = sandbox.stub().returns(undefined);
        chatStreamProgress = sandbox.stub().returns(undefined);
        chatStream = {
            markdown: chatStreamMarkdown,
            progress: chatStreamProgress,
        } as unknown as vscode.ChatResponseStream;

        chatRequest = {
            prompt: samplePrompt,
            references: [],
            model: languageModelChat,
        } as unknown as vscode.ChatRequest;

        chatContext = {
            history: [],
        } as unknown as vscode.ChatContext;

        const disposeStub = sandbox.stub();
        cancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub().returns({ dispose: disposeStub }),
        } as unknown as vscode.CancellationToken;

        textDocument = {
            getText: sandbox.stub().returns("SELECT * FROM users"),
            languageId: "sql",
        } as unknown as vscode.TextDocument;

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
        copilotService.startConversation.resolves(true);
        connectionManager.getConnectionInfo.callsFake(() => connectionInfo);

        const completeResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.Complete,
            responseText: "Conversation completed",
            tools: [],
            requestMessages: [],
        };

        copilotService.getNextMessage.resolves(completeResponse);

        const handler = createHandler();

        const result = await handler(chatRequest, chatContext, chatStream, cancellationToken);

        expect(copilotService.startConversation).to.have.been.calledOnceWith(
            sinon.match.string,
            sampleConnectionUri,
            samplePrompt,
        );
        expect(copilotService.getNextMessage).to.have.been.calledOnce;
        expect(startActivityStub).to.have.been.called;
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
        copilotService.startConversation.resolves(true);
        connectionManager.getConnectionInfo.callsFake(() => connectionInfo);

        const fragmentResponse: GetNextMessageResponse = {
            conversationUri: sampleConversationUri,
            messageType: MessageType.Fragment,
            responseText: "Fragment message",
            tools: [],
            requestMessages: [],
        };

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
        copilotService.startConversation.throws(new Error("Connection failed"));
        connectionManager.getConnectionInfo.callsFake(() => connectionInfo);

        const handler = createHandler();

        await handler(chatRequest, chatContext, chatStream, cancellationToken);

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

            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });

            expect(languageModelChatSendRequest).to.have.been.calledOnce;
            const [, options] = languageModelChatSendRequest.firstCall.args;
            expect(options.tools).to.be.an("array").that.is.not.empty;
        });

        test("Handles tools with invalid JSON parameters by falling back to empty schema", async () => {
            setUpSuccessfulConversation();

            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_run_query",
                        functionDescription: "Runs a SQL query",
                        functionParameters: "{invalid json syntax here}",
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

            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });

            expect(languageModelChatSendRequest).to.have.been.calledOnce;
        });

        test("Handles tools with null or undefined description", async () => {
            setUpSuccessfulConversation();

            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_connect",
                        functionDescription: undefined as unknown as string,
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

            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });
        });

        test("Handles tools with empty or whitespace-only parameters", async () => {
            setUpSuccessfulConversation();

            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: "mssql_disconnect",
                        functionDescription: "Disconnects from database",
                        functionParameters: "   ",
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

            expect(result).to.deep.equal({
                metadata: { command: "", correlationId: sampleCorrelationId },
            });
        });

        test("Throws error when tool has invalid or missing functionName", async () => {
            setUpSuccessfulConversation();

            const requestLLMResponse: GetNextMessageResponse = {
                conversationUri: sampleConversationUri,
                messageType: MessageType.RequestLLM,
                responseText: "Processing request",
                tools: [
                    {
                        functionName: undefined as unknown as string,
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

            const markdownMessages = getMarkdownMessages();
            const matches = markdownMessages.filter((msg) => msg.includes("An error occurred"));
            expect(matches.length, `markdown outputs: ${markdownMessages.join(" || ")}`).to.equal(
                1,
            );
        });
    });
});
