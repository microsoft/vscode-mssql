/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
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
import {
  ActivityObject,
  ActivityStatus,
} from "../../src/sharedInterfaces/telemetry";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, {
  ConnectionInfo,
} from "../../src/controllers/connectionManager";
import {
  connectedLabelPrefix,
  disconnectedLabelPrefix,
} from "../../src/copilot/chatConstants";
import { IConnectionInfo } from "vscode-mssql";

chai.use(sinonChai);
const expect = chai.expect;

suite("Chat Agent Request Handler Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let mockCopilotService: sinon.SinonStubbedInstance<CopilotService>;
  let mockMainController: sinon.SinonStubbedInstance<MainController>;
  let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
  let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
  let connectionInfo: ConnectionInfo;
  let mockContext: vscode.ExtensionContext;
  let mockLmChat: vscode.LanguageModelChat;
  let languageModelChatSendRequest: sinon.SinonStub;
  let mockChatStream: vscode.ChatResponseStream;
  let chatStreamMarkdown: sinon.SinonStub;
  let chatStreamProgress: sinon.SinonStub;
  let mockChatRequest: vscode.ChatRequest;
  let mockChatContext: vscode.ChatContext;
  let mockToken: vscode.CancellationToken;
  let mockTextDocument: vscode.TextDocument;
  let mockConfiguration: vscode.WorkspaceConfiguration;
  let mockActivityObject: ActivityObject & {
    end: sinon.SinonStub;
    endFailed: sinon.SinonStub;
    update: sinon.SinonStub;
  };
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
    mockActivityObject = {
      end: sandbox.stub(),
      endFailed: sandbox.stub(),
      update: sandbox.stub(),
    } as unknown as ActivityObject & {
      end: sinon.SinonStub;
      endFailed: sinon.SinonStub;
      update: sinon.SinonStub;
    };

    // Stub telemetry functions
    startActivityStub = sandbox
      .stub(telemetry, "startActivity")
      .returns(mockActivityObject);
    sandbox.stub(telemetry, "sendActionEvent");
    // Stub the generateGuid function using sinon
    sandbox.stub(Utils, "generateGuid").returns(sampleCorrelationId);

    // Mock CopilotService
    mockCopilotService = sandbox.createStubInstance(CopilotService);
    // Mock MainController
    mockMainController = sandbox.createStubInstance(MainController);
    // Mock connectionManager
    mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
    sandbox
      .stub(mockMainController, "connectionManager")
      .get(() => mockConnectionManager);

    // Mock ConnectionInfo
    connectionInfo = new ConnectionInfo();
    connectionInfo.credentials = {
      server: "server",
      database: "database",
    } as IConnectionInfo;

    // Mock VscodeWrapper
    mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
    sandbox
      .stub(mockVscodeWrapper, "activeTextEditorUri")
      .get(() => sampleConnectionUri);

    // Mock configuration
    configurationGet = sandbox.stub().returns(false);
    mockConfiguration = {
      get: configurationGet,
    } as unknown as vscode.WorkspaceConfiguration;
    mockVscodeWrapper.getConfiguration.returns(mockConfiguration);

    // Mock ExtensionContext
    const canSendRequestStub = sandbox.stub().returns("allowed");
    mockContext = {
      languageModelAccessInformation: {
        canSendRequest: canSendRequestStub,
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    // Had to create a real object instead of using mock for the response object
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
    mockLmChat = {
      sendRequest: languageModelChatSendRequest,
    } as unknown as vscode.LanguageModelChat;

    // Mock ChatResponseStream
    chatStreamMarkdown = sandbox.stub().returns(undefined);
    chatStreamProgress = sandbox.stub().returns(undefined);
    mockChatStream = {
      markdown: chatStreamMarkdown,
      progress: chatStreamProgress,
    } as unknown as vscode.ChatResponseStream;

    // Mock Chat Request
    mockChatRequest = {
      prompt: samplePrompt,
      references: [],
      model: mockLmChat,
    } as unknown as vscode.ChatRequest;

    // Mock Chat Context
    mockChatContext = {
      history: [],
    } as vscode.ChatContext;

    // Mock CancellationToken
    const disposeStub = sandbox.stub();
    mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: sandbox.stub().returns({ dispose: disposeStub }),
    } as vscode.CancellationToken;

    // Mock TextDocument for reference handling
    mockTextDocument = {
      getText: sandbox.stub().returns("SELECT * FROM users"),
      languageId: "sql",
    } as unknown as vscode.TextDocument;

    // Stub the workspace.openTextDocument method instead of replacing the entire workspace object
    sandbox
      .stub(vscode.workspace, "openTextDocument")
      .resolves(mockTextDocument);
  });

  teardown(() => {
    sandbox.restore();
  });

  function createHandler(): ReturnType<typeof createSqlAgentRequestHandler> {
    return createSqlAgentRequestHandler(
      mockCopilotService,
      mockVscodeWrapper,
      mockContext,
      mockMainController,
    );
  }

  function getMarkdownMessages(): string[] {
    return chatStreamMarkdown.getCalls().map((call) => {
      const [message] = call.args;
      return message === undefined || message === null
        ? ""
        : message.toString();
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
      mockChatContext,
      mockChatStream,
      mockToken,
    );

    expect(markdownMatchCount((msg) => msg === "No model found.")).to.equal(1);
    expect(result).to.deep.equal({
      metadata: { command: "", correlationId: sampleCorrelationId },
    });
  });

  test("Handles successful conversation flow with complete message type", async () => {
    // Setup mocks for startConversation
    mockCopilotService.startConversation.resolves(true);
    // Mock the getConnectionInfo method to return a valid connection
    mockConnectionManager.getConnectionInfo.callsFake(() => connectionInfo);

    const completeResponse: GetNextMessageResponse = {
      conversationUri: sampleConversationUri,
      messageType: MessageType.Complete,
      responseText: "Conversation completed",
      tools: [],
      requestMessages: [],
    };

    // Mock the getNextMessage to return a Complete message type
    mockCopilotService.getNextMessage.resolves(completeResponse);

    const handler = createHandler();

    const result = await handler(
      mockChatRequest,
      mockChatContext,
      mockChatStream,
      mockToken,
    );

    // Verify startActivity was called
    expect(mockCopilotService.startConversation).to.have.been.calledOnceWith(
      sinon.match.string,
      sampleConnectionUri,
      samplePrompt,
    );
    expect(mockCopilotService.getNextMessage).to.have.been.calledOnce;
    expect(startActivityStub).to.have.been.called;
    // Verify end was called on the activity object
    expect(mockActivityObject.end).to.have.been.calledOnceWith(
      ActivityStatus.Succeeded,
      sinon.match.any,
    );
    const markdownMessages = getMarkdownMessages();
    const matches = markdownMessages.filter((msg) =>
      msg.startsWith(connectedLabelPrefix),
    );
    expect(
      matches.length,
      `markdown outputs: ${markdownMessages.join(" || ")}`,
    ).to.equal(1);
    expect(result).to.deep.equal({
      metadata: { command: "", correlationId: sampleCorrelationId },
    });
  });

  test("Handles conversation with disconnected editor", async () => {
    // Mock the getConnectionInfo method to return an invalid connection
    mockConnectionManager.getConnectionInfo.callsFake(() => undefined);

    const handler = createHandler();

    const result = await handler(
      mockChatRequest,
      mockChatContext,
      mockChatStream,
      mockToken,
    );

    const markdownMessages = getMarkdownMessages();
    const matches = markdownMessages.filter((msg) =>
      msg.startsWith(disconnectedLabelPrefix),
    );
    expect(
      matches.length,
      `markdown outputs: ${markdownMessages.join(" || ")}`,
    ).to.equal(1);
    expect(result).to.deep.equal({
      metadata: { command: "", correlationId: sampleCorrelationId },
    });
  });

  test("Handles conversation with Fragment message type", async () => {
    // Setup mocks for startConversation
    mockCopilotService.startConversation.resolves(true);
    // Mock the getConnectionInfo method to return a valid connection
    mockConnectionManager.getConnectionInfo.callsFake(() => connectionInfo);

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

    mockCopilotService.getNextMessage.callsFake(
      async () => responses[callCount++],
    );

    const handler = createHandler();

    await handler(mockChatRequest, mockChatContext, mockChatStream, mockToken);

    expect(mockCopilotService.getNextMessage).to.have.been.calledTwice;
  });

  test("Handles errors during conversation gracefully", async () => {
    // Setup mocks for startConversation to throw
    mockCopilotService.startConversation.throws(new Error("Connection failed"));
    // Mock the getConnectionInfo method to return a valid connection
    mockConnectionManager.getConnectionInfo.callsFake(() => connectionInfo);

    const handler = createHandler();

    await handler(mockChatRequest, mockChatContext, mockChatStream, mockToken);

    // Should show error message
    const markdownMessages = getMarkdownMessages();
    const matches = markdownMessages.filter((msg) =>
      msg.includes("An error occurred"),
    );
    expect(
      matches.length,
      `markdown outputs: ${markdownMessages.join(" || ")}`,
    ).to.equal(1);
  });

  suite("Tool Mapping Tests", () => {
    function setUpSuccessfulConversation(): void {
      mockCopilotService.startConversation.resolves(true);
      mockConnectionManager.getConnectionInfo.callsFake(() => connectionInfo);
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

      mockCopilotService.getNextMessage.callsFake(
        async () => responses[callCount++],
      );

      const handler = createHandler();

      const result = await handler(
        mockChatRequest,
        mockChatContext,
        mockChatStream,
        mockToken,
      );

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

      mockCopilotService.getNextMessage.callsFake(
        async () => responses[callCount++],
      );

      const handler = createHandler();

      const result = await handler(
        mockChatRequest,
        mockChatContext,
        mockChatStream,
        mockToken,
      );

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

      mockCopilotService.getNextMessage.callsFake(
        async () => responses[callCount++],
      );

      const handler = createHandler();

      const result = await handler(
        mockChatRequest,
        mockChatContext,
        mockChatStream,
        mockToken,
      );

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

      mockCopilotService.getNextMessage.callsFake(
        async () => responses[callCount++],
      );

      const handler = createHandler();

      const result = await handler(
        mockChatRequest,
        mockChatContext,
        mockChatStream,
        mockToken,
      );

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

      mockCopilotService.getNextMessage.resolves(requestLLMResponse);

      const handler = createHandler();

      await handler(
        mockChatRequest,
        mockChatContext,
        mockChatStream,
        mockToken,
      );

      // Should handle the error and show error message
      const markdownMessages = getMarkdownMessages();
      const matches = markdownMessages.filter((msg) =>
        msg.includes("An error occurred"),
      );
      // Verify error message is shown
      expect(
        matches.length,
        `markdown outputs: ${markdownMessages.join(" || ")}`,
      ).to.equal(1);
    });
  });

  suite("provideFollowups Tests", () => {
    let followupsSandbox: sinon.SinonSandbox;
    let followupsMainController: sinon.SinonStubbedInstance<MainController>;
    let followupsVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let followupsConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let followupsResult: ISqlChatResult;
    let followupsConnection: ConnectionInfo;

    setup(() => {
      followupsSandbox = sinon.createSandbox();

      followupsMainController =
        followupsSandbox.createStubInstance(MainController);
      followupsVscodeWrapper =
        followupsSandbox.createStubInstance(VscodeWrapper);
      followupsConnectionManager =
        followupsSandbox.createStubInstance(ConnectionManager);

      followupsSandbox
        .stub(followupsMainController, "connectionManager")
        .get(() => followupsConnectionManager);

      followupsConnection = new ConnectionInfo();

      followupsResult = {
        metadata: {
          command: "",
        },
      } as ISqlChatResult;
    });

    teardown(() => {
      followupsSandbox.restore();
    });

    test("should return empty array for non-help commands", async () => {
      followupsResult.metadata.command = "query";

      const followups = await provideFollowups(
        followupsResult,
        {} as vscode.ChatContext,
        {} as vscode.CancellationToken,
        followupsMainController,
        followupsVscodeWrapper,
      );

      expect(followups).to.be.an("array").that.is.empty;
    });

    test("should return connect follow-up when disconnected", async () => {
      followupsResult.metadata.command = "help";
      followupsSandbox
        .stub(followupsVscodeWrapper, "activeTextEditorUri")
        .get(() => undefined);

      const followups = await provideFollowups(
        followupsResult,
        {} as vscode.ChatContext,
        {} as vscode.CancellationToken,
        followupsMainController,
        followupsVscodeWrapper,
      );

      expect(followups).to.have.lengthOf(1);
      expect(followups[0]).to.have.property("prompt");
      expect(followups[0]).to.have.property("command", "connect");
    });

    test("should return database exploration follow-ups when connected", async () => {
      followupsResult.metadata.command = "help";
      const mockUriString = "file:///test.sql";
      followupsSandbox
        .stub(followupsVscodeWrapper, "activeTextEditorUri")
        .get(() => mockUriString);
      followupsConnectionManager.getConnectionInfo
        .withArgs(mockUriString)
        .returns(followupsConnection);

      const followups = await provideFollowups(
        followupsResult,
        {} as vscode.ChatContext,
        {} as vscode.CancellationToken,
        followupsMainController,
        followupsVscodeWrapper,
      );

      expect(followups).to.have.lengthOf(3);
      expect(followups[0]).to.have.property("prompt");
      expect(followups[1]).to.have.property("prompt");
      expect(followups[2]).to.have.property("prompt");
    });
  });
});
