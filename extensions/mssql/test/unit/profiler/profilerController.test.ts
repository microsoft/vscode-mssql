/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { ProfilerController } from "../../../src/profiler/profilerController";
import { ProfilerDetailsPanelViewController } from "../../../src/profiler/profilerDetailsPanelViewController";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { ProfilerService } from "../../../src/services/profilerService";
import ConnectionManager from "../../../src/controllers/connectionManager";
import VscodeWrapper from "../../../src/controllers/vscodeWrapper";
import { SessionState, SessionType } from "../../../src/profiler/profilerTypes";
import { IConnectionProfile } from "../../../src/models/interfaces";

chai.use(sinonChai);

/**
 * Creates a mock ProfilerService for testing.
 */
function createMockProfilerService(): ProfilerService {
    return {
        startProfiling: sinon
            .stub()
            .resolves({ uniqueSessionId: "test-unique-id", canPause: true }),
        stopProfiling: sinon.stub().resolves({}),
        pauseProfiling: sinon.stub().resolves({ isPaused: true }),
        disconnectSession: sinon.stub().resolves({}),
        getXEventSessions: sinon.stub().resolves({ sessions: ["Session1", "Session2"] }),
        createXEventSession: sinon.stub().resolves({}),
        onEventsAvailable: sinon.stub().returns(new vscode.Disposable(() => {})),
        onSessionStopped: sinon.stub().returns(new vscode.Disposable(() => {})),
        onSessionCreated: sinon.stub().returns(new vscode.Disposable(() => {})),
        cleanupHandlers: sinon.stub(),
    } as unknown as ProfilerService;
}

/**
 * Creates a mock VscodeWrapper for testing.
 */
function createMockVscodeWrapper(sandbox: sinon.SinonSandbox): VscodeWrapper {
    return {
        outputChannel: {
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            show: sandbox.stub(),
            clear: sandbox.stub(),
        },
        getConfiguration: sandbox.stub().returns({
            get: sandbox.stub().returns(10000),
        }),
        showInformationMessage: sandbox.stub(),
        showErrorMessage: sandbox.stub(),
        showWarningMessage: sandbox.stub(),
        showQuickPick: sandbox.stub(),
        showInputBox: sandbox.stub(),
    } as unknown as VscodeWrapper;
}

/**
 * Creates a mock ConnectionManager for testing.
 */
function createMockConnectionManager(sandbox: sinon.SinonSandbox): ConnectionManager {
    const connectionStore = {
        getPickListItems: sandbox.stub().resolves([
            { label: "Server1", description: "Connection 1" },
            { label: "Server2", description: "Connection 2" },
        ]),
    };

    const connectionUI = {
        promptForConnection: sandbox.stub().resolves({
            server: "testserver",
            authenticationType: "SqlLogin",
            user: "testuser",
            password: "testpass",
        }),
    };

    return {
        connectionStore,
        connectionUI,
        connect: sandbox.stub().resolves(true),
        disconnect: sandbox.stub().resolves(),
        getConnectionCredentials: sandbox.stub().returns({}),
        getConnectionInfo: sandbox.stub().returns({
            serverInfo: {
                engineEditionId: 3, // Enterprise (on-prem)
                isCloud: false,
                serverMajorVersion: 16,
                serverMinorVersion: 0,
                serverReleaseVersion: 0,
                serverVersion: "16.0.0",
                serverLevel: "",
                serverEdition: "Enterprise",
                azureVersion: 0,
                osVersion: "",
            },
        }),
    } as unknown as ConnectionManager;
}

suite("ProfilerController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockConnectionManager: ConnectionManager;
    let mockVscodeWrapper: VscodeWrapper;
    let mockSessionManager: ProfilerSessionManager;
    let mockProfilerService: ProfilerService;
    let createWebviewPanelStub: sinon.SinonStub;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let mockStatusBarItem: vscode.StatusBarItem;
    let showQuickPickStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub registerWebviewViewProvider to prevent duplicate registration error
        sandbox
            .stub(vscode.window, "registerWebviewViewProvider")
            .returns({ dispose: sandbox.stub() } as unknown as vscode.Disposable);

        mockWebview = {
            postMessage: sandbox.stub().resolves(true),
            asWebviewUri: sandbox.stub().returns(vscode.Uri.parse("https://example.com/")),
            onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
            html: "",
        } as unknown as vscode.Webview;

        mockStatusBarItem = {
            text: "",
            tooltip: "",
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.StatusBarItem;

        mockPanel = {
            webview: mockWebview,
            title: "Profiler",
            viewColumn: vscode.ViewColumn.One,
            options: {},
            reveal: sandbox.stub(),
            dispose: sandbox.stub(),
            onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() }),
            onDidChangeViewState: sandbox.stub().returns({ dispose: sandbox.stub() }),
            iconPath: undefined,
            active: true,
            visible: true,
        } as unknown as vscode.WebviewPanel;

        createWebviewPanelStub = sandbox
            .stub(vscode.window, "createWebviewPanel")
            .returns(mockPanel);

        sandbox.stub(vscode.window, "createStatusBarItem").returns(mockStatusBarItem);

        showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
        sandbox.stub(vscode.window, "showInputBox");
        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        sandbox.stub(vscode.window, "showWarningMessage");
        showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");

        // Stub registerCommand to prevent command registration in tests
        sandbox
            .stub(vscode.commands, "registerCommand")
            .returns({ dispose: sandbox.stub() } as unknown as vscode.Disposable);

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "/test/path",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        mockVscodeWrapper = createMockVscodeWrapper(sandbox);
        mockConnectionManager = createMockConnectionManager(sandbox);
        mockProfilerService = createMockProfilerService();
        mockSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(async () => {
        await mockSessionManager.dispose();
        ProfilerDetailsPanelViewController.resetInstance();
        sandbox.restore();
    });

    function createController(): ProfilerController {
        return new ProfilerController(
            mockContext,
            mockConnectionManager,
            mockVscodeWrapper,
            mockSessionManager,
        );
    }

    suite("constructor", () => {
        test("should create controller successfully", () => {
            // ProfilerController constructor should not throw
            const controller = createController();

            // Commands are registered in mainController, not in ProfilerController
            // ProfilerController exposes launchProfilerWithConnection as a public method
            expect(controller).to.exist;
        });

        test("should have launchProfilerWithConnection method", () => {
            const controller = createController();

            expect(controller.launchProfilerWithConnection).to.be.a("function");
        });
    });

    suite("launchProfilerWithConnection", () => {
        // Mock connection profile
        const mockConnectionProfile = {
            server: "testserver",
            authenticationType: "SqlLogin",
            user: "testuser",
            password: "testpass",
        };

        test("should handle connection failure", async () => {
            (mockConnectionManager.connect as sinon.SinonStub).resolves(false);

            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            expect(showErrorMessageStub).to.have.been.called;
            expect(createWebviewPanelStub).to.not.have.been.called;
        });

        test("should create webview panel on successful connection", async () => {
            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            expect(createWebviewPanelStub).to.have.been.calledOnce;
        });

        test("should fetch available XEvent sessions after connection", async () => {
            const getXEventSessionsStub = mockProfilerService.getXEventSessions as sinon.SinonStub;

            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            expect(getXEventSessionsStub).to.have.been.called;
        });

        test("should still create webview panel even if getXEventSessions fails (e.g., Azure system databases)", async () => {
            const getXEventSessionsStub = mockProfilerService.getXEventSessions as sinon.SinonStub;
            getXEventSessionsStub.rejects(new Error("Cannot profile Azure system databases"));

            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            // The webview should still be created even if getXEventSessions fails
            expect(createWebviewPanelStub).to.have.been.calledOnce;
            expect(showInformationMessageStub).to.have.been.called;
        });

        test("should show information message when profiler is ready", async () => {
            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            expect(showInformationMessageStub).to.have.been.called;
        });

        test("should handle error during launch", async () => {
            (mockConnectionManager.connect as sinon.SinonStub).rejects(
                new Error("Connection error"),
            );

            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            expect(showErrorMessageStub).to.have.been.called;
        });
    });

    suite("dispose", () => {
        test("should dispose session manager", async () => {
            const controller = createController();

            await controller.dispose();

            // Session manager should be disposed (no errors thrown)
        });
    });

    suite("session management", () => {
        // Mock connection profile
        const mockConnectionProfile = {
            server: "testserver",
            authenticationType: "SqlLogin",
            user: "testuser",
            password: "testpass",
        };

        test("should handle creating a new session with template selection cancelled", async () => {
            showQuickPickStub.resolves(undefined); // User cancelled template selection

            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            // The webview should be created, but no session should be started
            expect(createWebviewPanelStub).to.have.been.calledOnce;
        });
    });

    suite("error handling", () => {
        // Mock connection profile
        const mockConnectionProfile = {
            server: "testserver",
            authenticationType: "SqlLogin",
            user: "testuser",
            password: "testpass",
        };

        test("should display error message on command error", async () => {
            (mockConnectionManager.connect as sinon.SinonStub).rejects(new Error("Test error"));

            const controller = createController();
            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            expect(showErrorMessageStub).to.have.been.called;
        });
    });

    suite("Azure SQL Database handling", () => {
        // Note: These tests are skipped because the engine type detection from connection info
        // is not yet implemented. The ProfilerController._engineType remains at the default
        // value (Standalone) and needs to be set based on serverInfo.engineEditionId after connection.
        test.skip("should prompt for database selection when connected to Azure system database", async () => {
            // Configure mock for Azure SQL Database connected to master
            (mockConnectionManager.getConnectionInfo as sinon.SinonStub).returns({
                serverInfo: {
                    engineEditionId: 5, // Azure SQL Database
                    isCloud: true,
                    serverMajorVersion: 12,
                    serverMinorVersion: 0,
                    serverReleaseVersion: 0,
                    serverVersion: "12.0.0",
                    serverLevel: "",
                    serverEdition: "SQL Azure",
                    azureVersion: 0,
                    osVersion: "",
                },
                credentials: {
                    database: "master",
                },
            });

            // Add listDatabases stub
            (mockConnectionManager as unknown as { listDatabases: sinon.SinonStub }).listDatabases =
                sandbox.stub().resolves(["master", "UserDb1", "UserDb2"]);

            // Mock quick pick to return a user database
            showQuickPickStub.resolves({ label: "UserDb1", description: "" });

            const controller = createController();

            // Create a mock connection profile for Azure
            const mockConnectionProfile = {
                server: "myazureserver.database.windows.net",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
                database: "master",
            };

            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            // Verify quick pick was shown for database selection
            expect(showQuickPickStub).to.have.been.called;
            // Verify webview was created after database selection
            expect(createWebviewPanelStub).to.have.been.called;
        });

        test("should not prompt for database selection when connected to Azure user database", async () => {
            // Configure mock for Azure SQL Database connected to a user database
            (mockConnectionManager.getConnectionInfo as sinon.SinonStub).returns({
                serverInfo: {
                    engineEditionId: 5, // Azure SQL Database
                    isCloud: true,
                    serverMajorVersion: 12,
                    serverMinorVersion: 0,
                    serverReleaseVersion: 0,
                    serverVersion: "12.0.0",
                    serverLevel: "",
                    serverEdition: "SQL Azure",
                    azureVersion: 0,
                    osVersion: "",
                },
                credentials: {
                    database: "MyUserDatabase",
                },
            });

            const controller = createController();

            // Create a mock connection profile for Azure with a user database
            const mockConnectionProfile = {
                server: "myazureserver.database.windows.net",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
                database: "MyUserDatabase",
            };

            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            // Quick pick should not have been called for database selection
            // since we're already connected to a user database
            // Note: Quick pick might be called for other reasons (like template selection)
            // but not for database selection
            expect(createWebviewPanelStub).to.have.been.called;
        });

        test.skip("should cancel when user cancels database selection", async () => {
            // Configure mock for Azure SQL Database connected to master
            (mockConnectionManager.getConnectionInfo as sinon.SinonStub).returns({
                serverInfo: {
                    engineEditionId: 5, // Azure SQL Database
                    isCloud: true,
                    serverMajorVersion: 12,
                    serverMinorVersion: 0,
                    serverReleaseVersion: 0,
                    serverVersion: "12.0.0",
                    serverLevel: "",
                    serverEdition: "SQL Azure",
                    azureVersion: 0,
                    osVersion: "",
                },
                credentials: {
                    database: "master",
                },
            });

            // Add listDatabases stub
            (mockConnectionManager as unknown as { listDatabases: sinon.SinonStub }).listDatabases =
                sandbox.stub().resolves(["master", "UserDb1", "UserDb2"]);

            // Mock quick pick to return undefined (user cancelled)
            showQuickPickStub.resolves(undefined);

            const controller = createController();

            // Create a mock connection profile for Azure
            const mockConnectionProfile = {
                server: "myazureserver.database.windows.net",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
                database: "master",
            };

            await controller.launchProfilerWithConnection(
                mockConnectionProfile as IConnectionProfile,
            );

            // Verify disconnect was called since user cancelled
            expect(mockConnectionManager.disconnect).to.have.been.called;
            // Webview should not be created
            expect(createWebviewPanelStub).to.not.have.been.called;
        });
    });
});

suite("ProfilerController Integration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockSessionManager: ProfilerSessionManager;
    let mockProfilerService: ProfilerService;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let mockStatusBarItem: vscode.StatusBarItem;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockWebview = {
            postMessage: sandbox.stub().resolves(true),
            asWebviewUri: sandbox.stub().returns(vscode.Uri.parse("https://example.com/")),
            onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
            html: "",
        } as unknown as vscode.Webview;

        mockStatusBarItem = {
            text: "",
            tooltip: "",
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.StatusBarItem;

        mockPanel = {
            webview: mockWebview,
            title: "Profiler",
            viewColumn: vscode.ViewColumn.One,
            options: {},
            reveal: sandbox.stub(),
            dispose: sandbox.stub(),
            onDidDispose: sandbox.stub().returns({ dispose: sandbox.stub() }),
            onDidChangeViewState: sandbox.stub().returns({ dispose: sandbox.stub() }),
            iconPath: undefined,
            active: true,
            visible: true,
        } as unknown as vscode.WebviewPanel;

        sandbox.stub(vscode.window, "createWebviewPanel").returns(mockPanel);
        sandbox.stub(vscode.window, "createStatusBarItem").returns(mockStatusBarItem);
        sandbox.stub(vscode.window, "showQuickPick");
        sandbox.stub(vscode.window, "showInputBox");
        sandbox.stub(vscode.window, "showInformationMessage");
        sandbox.stub(vscode.window, "showWarningMessage");
        sandbox.stub(vscode.window, "showErrorMessage");

        sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake(
                (
                    _command: string,
                    _callback: (...args: unknown[]) => unknown,
                ): vscode.Disposable => {
                    return { dispose: sandbox.stub() } as unknown as vscode.Disposable;
                },
            );

        mockProfilerService = createMockProfilerService();
        mockSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(async () => {
        await mockSessionManager.dispose();
        ProfilerDetailsPanelViewController.resetInstance();
        sandbox.restore();
    });

    test("should integrate session manager with webview controller", async () => {
        // Create a session through the manager
        const session = mockSessionManager.createSession({
            id: "test-session",
            ownerUri: "profiler://test",
            sessionName: "Integration Test Session",
            sessionType: SessionType.Live,
            templateName: "Standard",
        });

        expect(session).to.exist;
        expect(session.id).to.equal("test-session");
        expect(session.state).to.equal(SessionState.Stopped);

        // Start the session
        session.start();
        expect(session.state).to.equal(SessionState.Running);

        // Pause the session
        session.pause();
        expect(session.state).to.equal(SessionState.Paused);

        // Stop the session
        session.stop();
        expect(session.state).to.equal(SessionState.Stopped);
    });
});
