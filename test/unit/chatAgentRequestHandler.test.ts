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
import { GetNextMessageResponse, MessageType } from "../../src/models/contracts/copilot";
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
    let selectChatModelsStub: sinon.SinonStub;
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

        // Stub the vscode.lm.selectChatModels function
        // First, ensure the lm object exists
        if (!vscode.lm) {
            // Create the object if it doesn't exist for testing
            (vscode as any).lm = { selectChatModels: () => Promise.resolve([]) };
        }

        // Now stub the function
        selectChatModelsStub = sandbox
            .stub(vscode.lm, "selectChatModels")
            .resolves([mockLmChat.object]);

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

        expect(handler).to.be.a("function");
    });

    test("Returns early with a default response when no models are found", async () => {
        // Setup stub to return empty array for this specific test
        selectChatModelsStub.resolves([]);

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
});
