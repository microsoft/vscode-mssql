/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import { expect } from "chai";
import * as sinon from "sinon";
import {
    handleChatCommand,
    CHAT_COMMANDS,
    commandRequiresConnection,
    commandSkipsConnectionLabels,
    isSimpleCommand,
    isPromptSubstituteCommand,
    getCommandDefinition,
    getConnectionButtonInfo,
} from "../../src/copilot/chatCommands";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import * as telemetry from "../../src/telemetry/telemetry";

suite("Chat Commands Tests", () => {
    let mockMainController: TypeMoq.IMock<MainController>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockConnectionInfo: TypeMoq.IMock<ConnectionInfo>;
    let mockChatStream: TypeMoq.IMock<vscode.ChatResponseStream>;
    let mockChatRequest: TypeMoq.IMock<vscode.ChatRequest>;
    let sandbox: sinon.SinonSandbox;
    let mockActiveTextEditor: TypeMoq.IMock<vscode.TextEditor>;
    let mockTextDocument: TypeMoq.IMock<vscode.TextDocument>;

    const sampleConnectionUri = "file:///path/to/sample.sql";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub telemetry functions
        sandbox.stub(telemetry, "sendActionEvent");
        sandbox.stub(telemetry, "sendErrorEvent");

        // Mock TextDocument
        mockTextDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();
        mockTextDocument.setup((x) => x.languageId).returns(() => "sql");

        // Mock TextEditor
        mockActiveTextEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();
        mockActiveTextEditor.setup((x) => x.document).returns(() => mockTextDocument.object);

        // Mock ConnectionInfo with minimal required properties
        mockConnectionInfo = TypeMoq.Mock.ofType<ConnectionInfo>();
        mockConnectionInfo
            .setup((x) => x.credentials)
            .returns(
                () =>
                    ({
                        server: "localhost",
                        database: "testdb",
                        authenticationType: "Integrated",
                        user: "testuser",
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any,
            );

        // Mock ConnectionManager
        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();
        mockConnectionManager
            .setup((x) => x.getConnectionInfo(TypeMoq.It.isAny()))
            .returns(() => mockConnectionInfo.object);
        mockConnectionManager
            .setup((x) => x.getServerInfo(TypeMoq.It.isAny()))
            .returns(
                () =>
                    ({
                        serverVersion: "15.0.2000.5",
                        serverEdition: "Standard Edition",
                        isCloud: false,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any,
            );
        mockConnectionManager
            .setup((x) => x.disconnect(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));

        // Mock MainController
        mockMainController = TypeMoq.Mock.ofType<MainController>();
        mockMainController
            .setup((x) => x.connectionManager)
            .returns(() => mockConnectionManager.object);
        mockMainController.setup((x) => x.onNewConnection()).returns(() => Promise.resolve(true));
        mockMainController.setup((x) => x.onChooseDatabase()).returns(() => Promise.resolve(true));

        // Mock ChatResponseStream
        mockChatStream = TypeMoq.Mock.ofType<vscode.ChatResponseStream>();
        mockChatStream.setup((x) => x.markdown(TypeMoq.It.isAny())).returns(() => undefined);

        // Mock ChatRequest
        mockChatRequest = TypeMoq.Mock.ofType<vscode.ChatRequest>();
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
            mockChatRequest.setup((x) => x.command).returns(() => "unknownCommand");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.false;
            expect(result.errorMessage).to.be.undefined;
        });

        test("handleChatCommand returns handled=false for undefined command", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => undefined);

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.false;
        });

        test("handleChatCommand returns error for connection-required command without connection", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "disconnect");
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAny()))
                .returns(() => undefined); // No connection

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                undefined,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            // Should show error message via stream
            mockChatStream.verify((x) => x.markdown(TypeMoq.It.isAny()), TypeMoq.Times.once());
            // Should show connection button
            mockChatStream.verify((x) => x.button(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });

        test("connect command executes successfully", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "connect");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                undefined, // Connect doesn't need existing connection
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            mockMainController.verify(
                (x) => x.onNewQueryWithConnection(undefined, true),
                TypeMoq.Times.once(),
            );
            mockChatStream.verify((x) => x.markdown(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });

        test("disconnect command executes successfully with connection", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "disconnect");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            mockConnectionManager.verify(
                (x) => x.disconnect(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });

        test("getConnectionDetails command shows connection information", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "getConnectionDetails");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            // isConnectionActive calls getConnectionInfo once, handler calls it again
            mockConnectionManager.verify(
                (x) => x.getConnectionInfo(TypeMoq.It.isAny()),
                TypeMoq.Times.atLeastOnce(),
            );
            mockConnectionManager.verify(
                (x) => x.getServerInfo(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            mockChatStream.verify((x) => x.markdown(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });

        test("changeDatabase command executes successfully", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "changeDatabase");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            mockMainController.verify((x) => x.onChooseDatabase(), TypeMoq.Times.once());
        });

        test("help command shows capabilities and button when disconnected", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "help");
            mockConnectionManager
                .setup((x) => x.getConnectionInfo(TypeMoq.It.isAny()))
                .returns(() => undefined); // No connection

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                undefined, // No connection URI
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            // Should show welcome message and all capabilities
            mockChatStream.verify(
                (x) => x.markdown(TypeMoq.It.isAny()),
                TypeMoq.Times.atLeastOnce(),
            );
            // Should show connection button since not connected
            mockChatStream.verify(
                (x) =>
                    x.button(
                        TypeMoq.It.is(
                            (btn) => btn.command === "mssql.copilot.newQueryWithConnection",
                        ),
                    ),
                TypeMoq.Times.once(),
            );
        });

        test("help command does not show button when connected", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "help");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri, // Has connection
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            // Should show welcome message and all capabilities
            mockChatStream.verify(
                (x) => x.markdown(TypeMoq.It.isAny()),
                TypeMoq.Times.atLeastOnce(),
            );
            // Should NOT show connection button since already connected
            mockChatStream.verify(
                (x) =>
                    x.button(
                        TypeMoq.It.is(
                            (btn) => btn.command === "mssql.copilot.newQueryWithConnection",
                        ),
                    ),
                TypeMoq.Times.never(),
            );
        });

        test("listServers command executes successfully", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "listServers");
            const mockConnectionStore = {
                readAllConnections: () =>
                    Promise.resolve([
                        {
                            profileName: "Test Profile",
                            server: "localhost",
                            database: "testdb",
                            authenticationType: "Integrated",
                        },
                    ]),
            };
            mockConnectionManager
                .setup((x) => x.connectionStore)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .returns(() => mockConnectionStore as any);

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                undefined, // listServers doesn't need connection
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.be.undefined;
            mockChatStream.verify(
                (x) => x.markdown(TypeMoq.It.isAny()),
                TypeMoq.Times.atLeastOnce(),
            );
        });

        test("prompt substitute command returns promptToAdd", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "runQuery");

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                sampleConnectionUri,
            );

            expect(result.handled).to.be.false; // Prompt substitute commands don't handle completely
            expect(result.promptToAdd).to.not.be.undefined;
            expect(result.promptToAdd).to.contain("query"); // Should contain template text
        });

        test("command with exception returns error message", async () => {
            mockChatRequest.setup((x) => x.command).returns(() => "listServers");
            // Mock the connection store to throw an error
            const mockConnectionStore = {
                readAllConnections: () => Promise.reject(new Error("Database error")),
            };
            mockConnectionManager
                .setup((x) => x.connectionStore)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .returns(() => mockConnectionStore as any);

            const result = await handleChatCommand(
                mockChatRequest.object,
                mockChatStream.object,
                mockMainController.object,
                undefined,
            );

            expect(result.handled).to.be.true;
            expect(result.errorMessage).to.not.be.undefined;
            // Just check that an error message exists
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

    suite("getConnectionButtonInfo Tests", () => {
        test("returns 'Connect' label when SQL editor is active", () => {
            // Set up active editor with SQL language
            sandbox.stub(vscode.window, "activeTextEditor").value(mockActiveTextEditor.object);

            const buttonInfo = getConnectionButtonInfo();

            expect(buttonInfo.label).to.contain("Connect");
            expect(buttonInfo.args.forceNewEditor).to.be.false;
            expect(buttonInfo.args.forceConnect).to.be.true;
        });

        test("returns 'Open SQL editor and connect' label when no SQL editor active", () => {
            // No active editor
            sandbox.stub(vscode.window, "activeTextEditor").value(undefined);

            const buttonInfo = getConnectionButtonInfo();

            expect(buttonInfo.label).to.contain("Open SQL editor and connect");
            expect(buttonInfo.args.forceNewEditor).to.be.true;
            expect(buttonInfo.args.forceConnect).to.be.true;
        });

        test("returns 'Open SQL editor and connect' when active editor is not SQL", () => {
            // Active editor with non-SQL language
            mockTextDocument.reset();
            mockTextDocument.setup((x) => x.languageId).returns(() => "typescript");
            sandbox.stub(vscode.window, "activeTextEditor").value(mockActiveTextEditor.object);

            const buttonInfo = getConnectionButtonInfo();

            expect(buttonInfo.label).to.contain("Open SQL editor and connect");
            expect(buttonInfo.args.forceNewEditor).to.be.true;
            expect(buttonInfo.args.forceConnect).to.be.true;
        });
    });
});
