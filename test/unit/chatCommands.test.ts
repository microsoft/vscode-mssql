/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import {
    handleChatCommand,
    CHAT_COMMANDS,
    commandRequiresConnection,
    commandSkipsConnectionLabels,
    isSimpleCommand,
    isPromptSubstituteCommand,
    getCommandDefinition,
} from "../../src/copilot/chatCommands";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import * as telemetry from "../../src/telemetry/telemetry";

const { expect } = chai;

chai.use(sinonChai);

suite("Chat Commands Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionInfo: ConnectionInfo;
    let chatRequest: vscode.ChatRequest;
    let chatStream: vscode.ChatResponseStream;
    let chatStreamMarkdownStub: sinon.SinonStub;

    const sampleConnectionUri = "file:///path/to/sample.sql";

    setup(() => {
        sandbox = sinon.createSandbox();

        sandbox.stub(telemetry, "sendActionEvent");
        sandbox.stub(telemetry, "sendErrorEvent");

        connectionInfo = {
            credentials: {
                server: "localhost",
                database: "testdb",
                authenticationType: "Integrated",
                user: "testuser",
            },
        } as unknown as ConnectionInfo;

        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.getConnectionInfo.returns(connectionInfo);
        mockConnectionManager.getServerInfo.returns({
            serverVersion: "15.0.2000.5",
            serverEdition: "Standard Edition",
            isCloud: false,
        } as unknown as { serverVersion: string; serverEdition: string; isCloud: boolean });
        mockConnectionManager.disconnect.resolves(true);

        mockMainController = sandbox.createStubInstance(MainController);
        sandbox
            .stub(mockMainController, "connectionManager")
            .get(() => mockConnectionManager as unknown as ConnectionManager);
        mockMainController.onNewConnection.resolves(true);
        mockMainController.onChooseDatabase.resolves(true);

        chatStreamMarkdownStub = sandbox.stub();
        chatStream = {
            markdown: chatStreamMarkdownStub,
        } as unknown as vscode.ChatResponseStream;

        chatRequest = {
            command: "",
        } as unknown as vscode.ChatRequest;
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Command Definition Tests", () => {
        test("commandRequiresConnection returns correct values", () => {
            expect(commandRequiresConnection("connect")).to.be.false;
            expect(commandRequiresConnection("disconnect")).to.be.true;
            expect(commandRequiresConnection("getConnectionDetails")).to.be.true;
            expect(commandRequiresConnection("listServers")).to.be.false;
            expect(commandRequiresConnection("nonexistent")).to.be.false;
        });

        test("commandSkipsConnectionLabels returns correct values", () => {
            expect(commandSkipsConnectionLabels("connect")).to.be.true;
            expect(commandSkipsConnectionLabels("disconnect")).to.be.true;
            expect(commandSkipsConnectionLabels("getConnectionDetails")).to.be.true;
            expect(commandSkipsConnectionLabels("runQuery")).to.be.false;
            expect(commandSkipsConnectionLabels("nonexistent")).to.be.false;
        });

        test("isSimpleCommand returns correct values", () => {
            expect(isSimpleCommand("connect")).to.be.true;
            expect(isSimpleCommand("disconnect")).to.be.true;
            expect(isSimpleCommand("getConnectionDetails")).to.be.true;
            expect(isSimpleCommand("runQuery")).to.be.false;
            expect(isSimpleCommand("explain")).to.be.false;
        });

        test("isPromptSubstituteCommand returns correct values", () => {
            expect(isPromptSubstituteCommand("connect")).to.be.false;
            expect(isPromptSubstituteCommand("disconnect")).to.be.false;
            expect(isPromptSubstituteCommand("runQuery")).to.be.true;
            expect(isPromptSubstituteCommand("explain")).to.be.true;
            expect(isPromptSubstituteCommand("fix")).to.be.true;
        });

        test("getCommandDefinition returns correct command definitions", () => {
            const connectDef = getCommandDefinition("connect");
            expect(connectDef).to.not.be.undefined;
            expect(connectDef?.type).to.equal("simple");
            expect(connectDef?.requiresConnection).to.be.false;
            expect(connectDef?.skipConnectionLabels).to.be.true;

            const runQueryDef = getCommandDefinition("runQuery");
            expect(runQueryDef).to.not.be.undefined;
            expect(runQueryDef?.type).to.equal("prompt");
            expect(runQueryDef?.requiresConnection).to.be.true;

            const nonexistentDef = getCommandDefinition("nonexistent");
            expect(nonexistentDef).to.be.undefined;
        });
    });

    suite("Command Handler Tests", () => {
        test("handleChatCommand returns handled=false for unknown command", async () => {
            chatRequest.command = "unknownCommand";

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.false;
            expect(result.errorMessage).to.be.undefined;
        });

        test("handleChatCommand returns handled=false for undefined command", async () => {
            chatRequest.command = undefined;

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.false;
        });

        test("handleChatCommand returns error for connection-required command without connection", async () => {
            chatRequest.command = "disconnect";
            mockConnectionManager.getConnectionInfo.returns(undefined as unknown as ConnectionInfo);

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                undefined,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.contain("No active database connection");
        });

        test("connect command executes successfully", async () => {
            chatRequest.command = "connect";

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                undefined,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            expect(mockMainController.onNewConnection).to.have.been.calledOnce;
            expect(chatStreamMarkdownStub).to.have.been.calledOnce;
        });

        test("disconnect command executes successfully with connection", async () => {
            chatRequest.command = "disconnect";

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            expect(mockConnectionManager.disconnect).to.have.been.calledOnceWithExactly(
                sampleConnectionUri,
            );
        });

        test("getConnectionDetails command shows connection information", async () => {
            chatRequest.command = "getConnectionDetails";

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            expect(mockConnectionManager.getConnectionInfo).to.have.been.called;
            expect(mockConnectionManager.getServerInfo).to.have.been.calledOnce;
            expect(chatStreamMarkdownStub).to.have.been.calledOnce;
        });

        test("changeDatabase command executes successfully", async () => {
            chatRequest.command = "changeDatabase";

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            expect(mockMainController.onChooseDatabase).to.have.been.calledOnce;
        });

        test("listServers command executes successfully", async () => {
            chatRequest.command = "listServers";
            const mockConnectionStore = {
                readAllConnections: async () => [
                    {
                        profileName: "Test Profile",
                        server: "localhost",
                        database: "testdb",
                        authenticationType: "Integrated",
                    },
                ],
            };
            sandbox
                .stub(mockConnectionManager, "connectionStore")
                .get(() => mockConnectionStore as unknown as ConnectionManager["connectionStore"]);

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                undefined,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            expect(chatStreamMarkdownStub).to.have.been.called;
        });

        test("prompt substitute command returns promptToAdd", async () => {
            chatRequest.command = "runQuery";

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.false;
            expect(result.promptToAdd).to.not.be.undefined;
            expect(result.promptToAdd).to.contain("query");
        });

        test("command with exception returns error message", async () => {
            chatRequest.command = "listServers";
            const mockConnectionStore = {
                readAllConnections: async () => {
                    throw new Error("Database error");
                },
            };
            sandbox
                .stub(mockConnectionManager, "connectionStore")
                .get(() => mockConnectionStore as unknown as ConnectionManager["connectionStore"]);

            const result = await handleChatCommand(
                chatRequest,
                chatStream,
                mockMainController as unknown as MainController,
                undefined,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.not.be.undefined;
        });
    });

    suite("CHAT_COMMANDS Configuration", () => {
        test("All simple commands have handlers", () => {
            Object.entries(CHAT_COMMANDS).forEach(([name, def]) => {
                if (def.type === "simple") {
                    expect(def.handler, `Simple command ${name} should have a handler`).to.not.be
                        .undefined;
                }
            });
        });

        test("All prompt substitute commands have prompt templates", () => {
            Object.entries(CHAT_COMMANDS).forEach(([name, def]) => {
                if (def.type === "prompt") {
                    expect(
                        def.promptTemplate,
                        `Prompt substitute command ${name} should have a template`,
                    ).to.not.be.undefined;
                }
            });
        });

        test("Commands that skip connection labels are properly configured", () => {
            const skipLabelsCommands = Object.entries(CHAT_COMMANDS)
                .filter(([, def]) => def.skipConnectionLabels)
                .map(([name]) => name);

            expect(skipLabelsCommands).to.include("connect");
            expect(skipLabelsCommands).to.include("disconnect");
            expect(skipLabelsCommands).to.include("getConnectionDetails");
        });
    });
});
