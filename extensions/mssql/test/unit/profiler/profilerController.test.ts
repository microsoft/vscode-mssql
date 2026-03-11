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
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { ProfilerService } from "../../../src/services/profilerService";
import ConnectionManager from "../../../src/controllers/connectionManager";
import VscodeWrapper from "../../../src/controllers/vscodeWrapper";
import { SessionState, SessionType } from "../../../src/profiler/profilerTypes";
import { stubVscodeWrapper } from "../utils";

chai.use(sinonChai);

/**
 * Creates a mock ProfilerService for testing.
 */
function createMockProfilerService(
    sandbox: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<ProfilerService> {
    const mock = sandbox.createStubInstance(ProfilerService);
    mock.startProfiling.resolves({
        uniqueSessionId: "test-unique-id",
        canPause: true,
    } as any);
    mock.stopProfiling.resolves({} as any);
    mock.pauseProfiling.resolves({ isPaused: true } as any);
    mock.disconnectSession.resolves({} as any);
    mock.getXEventSessions.resolves({ sessions: ["Session1", "Session2"] } as any);
    mock.createXEventSession.resolves({} as any);
    mock.onEventsAvailable.returns(new vscode.Disposable(() => {}));
    mock.onSessionStopped.returns(new vscode.Disposable(() => {}));
    mock.onSessionCreated.returns(new vscode.Disposable(() => {}));
    return mock;
}

/**
 * Creates a mock ConnectionManager for testing.
 */
function createMockConnectionManager(
    sandbox: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<ConnectionManager> {
    const mock = sandbox.createStubInstance(ConnectionManager);
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
    Object.defineProperty(mock, "connectionStore", {
        get: () => connectionStore,
    });
    Object.defineProperty(mock, "connectionUI", {
        get: () => connectionUI,
    });
    mock.connect.resolves(true);
    mock.disconnect.resolves(true);
    return mock;
}

suite("ProfilerController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockSessionManager: ProfilerSessionManager;
    let mockProfilerService: sinon.SinonStubbedInstance<ProfilerService>;
    let registerCommandStub: sinon.SinonStub;
    let createWebviewPanelStub: sinon.SinonStub;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let mockStatusBarItem: vscode.StatusBarItem;
    let showQuickPickStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let registeredCommands: Map<string, (...args: unknown[]) => unknown>;

    setup(() => {
        sandbox = sinon.createSandbox();
        registeredCommands = new Map();

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

        // Capture registered commands
        registerCommandStub = sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake(
                (command: string, callback: (...args: unknown[]) => unknown): vscode.Disposable => {
                    registeredCommands.set(command, callback);
                    return { dispose: sandbox.stub() } as unknown as vscode.Disposable;
                },
            );

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "/test/path",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockVscodeWrapper.getConfiguration.returns({
            get: sandbox.stub().returns(10000),
        } as unknown as vscode.WorkspaceConfiguration);
        mockConnectionManager = createMockConnectionManager(sandbox);
        mockProfilerService = createMockProfilerService(sandbox);
        mockSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(async () => {
        await mockSessionManager.dispose();
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
        test("should register profiler launchFromObjectExplorer command", () => {
            createController();

            expect(registerCommandStub).to.have.been.called;
            expect(registeredCommands.has("mssql.profiler.launchFromObjectExplorer")).to.be.true;
        });

        test("should register profiler launchFromDatabase command", () => {
            createController();

            expect(registerCommandStub).to.have.been.called;
            expect(registeredCommands.has("mssql.profiler.launchFromDatabase")).to.be.true;
        });

        test("should not register mssql.profiler.launch command", () => {
            createController();

            expect(registeredCommands.has("mssql.profiler.launch")).to.be.false;
        });
    });

    suite("mssql.profiler.launchFromObjectExplorer command", () => {
        // Mock TreeNodeInfo with connection profile
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
            },
        };

        // Mock template selection item
        const mockTemplateItem = {
            label: "Standard",
            description: "Standard profiler template",
            detail: "Engine: Standalone",
            template: {
                id: "Standard_OnPrem",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        test("should handle connection failure", async () => {
            mockConnectionManager.connect.resolves(false);

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(showErrorMessageStub).to.have.been.called;
            expect(createWebviewPanelStub).to.not.have.been.called;
        });

        test("should create webview panel after template and session name selection", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

            // Set up session created handler to resolve immediately
            mockProfilerService.onSessionCreated.callsFake(
                (_ownerUri: string, handler: (params: unknown) => void) => {
                    // Simulate session created notification after a short delay
                    setTimeout(() => {
                        handler({ sessionName: "TestSession", templateName: "Standard" });
                    }, 10);
                    return { dispose: sandbox.stub() };
                },
            );

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(createWebviewPanelStub).to.have.been.calledOnce;
        });

        test("should fetch available XEvent sessions after template selection", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

            // Set up session created handler to resolve immediately
            mockProfilerService.onSessionCreated.callsFake(
                (_ownerUri: string, handler: (params: unknown) => void) => {
                    setTimeout(() => {
                        handler({ sessionName: "TestSession", templateName: "Standard" });
                    }, 10);
                    return { dispose: sandbox.stub() };
                },
            );

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(mockProfilerService.getXEventSessions).to.have.been.called;
        });

        test("should show information message when session is created successfully", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

            // Set up session created handler to resolve immediately
            mockProfilerService.onSessionCreated.callsFake(
                (_ownerUri: string, handler: (params: unknown) => void) => {
                    setTimeout(() => {
                        handler({ sessionName: "TestSession", templateName: "Standard" });
                    }, 10);
                    return { dispose: sandbox.stub() };
                },
            );

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(showInformationMessageStub).to.have.been.called;
        });

        test("should handle error during launch", async () => {
            mockConnectionManager.connect.rejects(new Error("Connection error"));

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(showErrorMessageStub).to.have.been.called;
        });

        test("should disconnect when template selection is cancelled", async () => {
            showQuickPickStub.resolves(undefined); // User cancelled template selection

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            // The webview should NOT be created since user cancelled
            expect(createWebviewPanelStub).to.not.have.been.called;
            expect(mockConnectionManager.disconnect).to.have.been.called;
        });

        test("should disconnect when session name input is cancelled", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves(undefined); // User cancelled input

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            // The webview should NOT be created since user cancelled
            expect(createWebviewPanelStub).to.not.have.been.called;
            expect(mockConnectionManager.disconnect).to.have.been.called;
        });
    });

    suite("mssql.profiler.launchFromDatabase command", () => {
        const mockDatabaseTreeNodeInfo = {
            connectionProfile: {
                server: "testserver",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
                database: "",
            },
            nodeType: "Database",
            metadata: {
                metadataTypeName: "Database",
                name: "AdventureWorks",
            },
        };

        const mockTemplateItem = {
            label: "Standard",
            description: "Standard profiler template",
            detail: "Engine: Standalone",
            template: {
                id: "Standard_OnPrem",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        test("should create webview panel with database filter when launched from database node", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

            // Set up session created handler to resolve immediately
            mockProfilerService.onSessionCreated.callsFake(
                (_ownerUri: string, handler: (params: unknown) => void) => {
                    setTimeout(() => {
                        handler({ sessionName: "TestSession", templateName: "Standard" });
                    }, 10);
                    return { dispose: sandbox.stub() };
                },
            );

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromDatabase");

            await launchCommand!(mockDatabaseTreeNodeInfo);

            expect(createWebviewPanelStub).to.have.been.calledOnce;
        });

        test("should handle connection failure from database node", async () => {
            mockConnectionManager.connect.resolves(false);

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromDatabase");

            await launchCommand!(mockDatabaseTreeNodeInfo);

            expect(showErrorMessageStub).to.have.been.called;
            expect(createWebviewPanelStub).to.not.have.been.called;
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
        // Mock TreeNodeInfo with connection profile
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
            },
        };

        // Mock template selection item
        const mockTemplateItem = {
            label: "Standard",
            description: "Standard profiler template",
            detail: "Engine: Standalone",
            template: {
                id: "Standard_OnPrem",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        test("should auto-start session after successful creation", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

            // Set up session created handler to resolve immediately
            mockProfilerService.onSessionCreated.callsFake(
                (_ownerUri: string, handler: (params: unknown) => void) => {
                    setTimeout(() => {
                        handler({ sessionName: "TestSession", templateName: "Standard" });
                    }, 10);
                    return { dispose: sandbox.stub() };
                },
            );

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            // Verify that startProfiling was called (session was auto-started)
            expect(mockProfilerService.startProfiling).to.have.been.called;
        });
    });

    suite("error handling", () => {
        // Mock TreeNodeInfo with connection profile
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
            },
        };

        test("should display error message on command error", async () => {
            mockConnectionManager.connect.rejects(new Error("Test error"));

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(showErrorMessageStub).to.have.been.called;
        });
    });
});

suite("ProfilerController Integration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockSessionManager: ProfilerSessionManager;
    let mockProfilerService: sinon.SinonStubbedInstance<ProfilerService>;
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

        mockProfilerService = createMockProfilerService(sandbox);
        mockSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(async () => {
        await mockSessionManager.dispose();
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

suite("ProfilerController Server Type Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockSessionManager: ProfilerSessionManager;
    let mockProfilerService: sinon.SinonStubbedInstance<ProfilerService>;
    let registeredCommands: Map<string, (...args: unknown[]) => unknown>;
    let showWarningMessageStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let mockStatusBarItem: vscode.StatusBarItem;

    setup(() => {
        sandbox = sinon.createSandbox();
        registeredCommands = new Map();

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
        showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
        sandbox.stub(vscode.window, "showInputBox");
        sandbox.stub(vscode.window, "showInformationMessage");
        showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage");
        sandbox.stub(vscode.window, "showErrorMessage");

        sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake(
                (command: string, callback: (...args: unknown[]) => unknown): vscode.Disposable => {
                    registeredCommands.set(command, callback);
                    return { dispose: sandbox.stub() } as unknown as vscode.Disposable;
                },
            );

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "/test/path",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        const connectionStore = {
            getPickListItems: sandbox.stub().resolves([]),
        };
        const connectionUI = {
            promptForConnection: sandbox.stub().resolves(undefined),
        };
        Object.defineProperty(mockConnectionManager, "connectionStore", {
            get: () => connectionStore,
        });
        Object.defineProperty(mockConnectionManager, "connectionUI", {
            get: () => connectionUI,
        });
        mockConnectionManager.connect.resolves(true);
        mockConnectionManager.disconnect.resolves(true);
        mockConnectionManager.listDatabases.resolves(["UserDB1", "UserDB2", "master", "tempdb"]);

        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockVscodeWrapper.getConfiguration.returns({
            get: sandbox.stub().returns(10000),
        } as unknown as vscode.WorkspaceConfiguration);

        mockProfilerService = createMockProfilerService(sandbox);
        mockSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(async () => {
        await mockSessionManager.dispose();
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

    test("should show warning message when connecting to Fabric server", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.fabric.microsoft.com",
                authenticationType: "AzureMFA",
                database: "TestDB",
            },
        };

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        expect(showWarningMessageStub).to.have.been.called;
        expect(mockConnectionManager.connect.called).to.be.false;
    });

    test("should prompt for database when Azure SQL has no database selected", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected
            },
        };

        showQuickPickStub.resolves("UserDB1");

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        expect(showQuickPickStub).to.have.been.called;
    });

    test("should prompt for database when Azure SQL has system database selected", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "master", // System database
            },
        };

        showQuickPickStub.resolves("UserDB1");

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        expect(showQuickPickStub).to.have.been.called;
    });

    test("should not prompt for database when Azure SQL has user database selected", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "MyUserDatabase",
            },
        };

        // Mock the template selection quick pick
        showQuickPickStub.resolves({
            label: "Standard",
            template: { id: "Standard_Azure", name: "Standard", defaultView: "standard" },
        });

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should only call quick pick once for template selection, not for database selection
        // listDatabases should not have been called since user DB is already selected
        expect(mockConnectionManager.listDatabases.called).to.be.false;
    });

    test("should proceed normally for on-prem SQL Server", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "localhost",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
            },
        };

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should not show warning and should connect
        expect(showWarningMessageStub).to.not.have.been.called;
        expect(mockConnectionManager.connect.called).to.be.true;
    });

    test("should filter out system databases from quick pick for Azure SQL", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected
            },
        };

        showQuickPickStub.resolves("UserDB1");

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Check that quick pick was called with only user databases (not system databases)
        const quickPickCall = showQuickPickStub.getCall(0);
        const databases = quickPickCall?.args[0];
        if (databases) {
            expect(databases).to.not.include("master");
            expect(databases).to.not.include("tempdb");
            expect(databases).to.include("UserDB1");
            expect(databases).to.include("UserDB2");
        }
    });

    test("should return early when user cancels database selection for Azure SQL", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected
            },
        };

        showQuickPickStub.resolves(undefined); // User cancelled

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Connect should have been called for temp connection, then disconnect
        expect(mockConnectionManager.disconnect.called).to.be.true;
    });

    test("should show error when temp connection fails during database selection for Azure SQL", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected - will trigger database selection
            },
        };

        // First connect call (for temp connection to get database list) fails
        mockConnectionManager.connect.resolves(false);

        const showErrorMessageStub = vscode.window.showErrorMessage as sinon.SinonStub;

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should show error message about failed connection
        expect(showErrorMessageStub).to.have.been.called;
        // Should NOT create webview since we couldn't get databases
        expect((vscode.window.createWebviewPanel as sinon.SinonStub).called).to.be.false;
    });

    test("should show warning when no user databases found for Azure SQL", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected
            },
        };

        // Return only system databases
        mockConnectionManager.listDatabases.resolves(["master", "tempdb", "model", "msdb"]);

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should show warning about no databases found
        expect(showWarningMessageStub).to.have.been.called;
        // Should NOT create webview since no user databases
        expect((vscode.window.createWebviewPanel as sinon.SinonStub).called).to.be.false;
    });

    test("should start existing session without creating when session already exists", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "localhost",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
            },
        };

        const mockTemplateItem = {
            label: "Standard",
            description: "Standard profiler template",
            detail: "Engine: Standalone",
            template: {
                id: "Standard_OnPrem",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        // Template selection and session name
        showQuickPickStub.resolves(mockTemplateItem);
        (vscode.window.showInputBox as sinon.SinonStub).resolves("ExistingSession");

        // Session already exists on server
        mockProfilerService.getXEventSessions.resolves({
            sessions: ["ExistingSession", "OtherSession"],
        } as any);

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should NOT call createXEventSession since session exists
        expect(mockProfilerService.createXEventSession).to.not.have.been.called;
        // Should call startProfiling to start the existing session
        expect(mockProfilerService.startProfiling).to.have.been.called;
    });

    test("should show error and dispose webview when session creation fails", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "localhost",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
            },
        };

        const mockTemplateItem = {
            label: "Standard",
            description: "Standard profiler template",
            detail: "Engine: Standalone",
            template: {
                id: "Standard_OnPrem",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        showQuickPickStub.resolves(mockTemplateItem);
        (vscode.window.showInputBox as sinon.SinonStub).resolves("NewSession");

        // Session does not exist
        mockProfilerService.getXEventSessions.resolves({
            sessions: [],
        } as any);

        // Session creation fails
        mockProfilerService.createXEventSession.rejects(new Error("Failed to create session"));

        const showErrorMessageStub = vscode.window.showErrorMessage as sinon.SinonStub;

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should show error message about session creation failure
        expect(showErrorMessageStub).to.have.been.called;
        // Disconnect should be called during webview disposal
        expect(mockConnectionManager.disconnect.called).to.be.true;
    });

    test("should not prompt for database when Azure SQL launched from database node", async () => {
        // When launching from a Database node on Azure, the databaseScopeFilter
        // pre-fills connectionProfile.database so ensureAzureDatabaseSelected
        // sees a user database and skips the prompt entirely.
        const mockDatabaseTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // Database node connections typically have empty database
            },
            nodeType: "Database",
            metadata: {
                metadataTypeName: "Database",
                name: "MyAzureDB",
            },
        };

        const mockTemplateItem = {
            label: "Standard",
            description: "Standard Azure profiler template",
            detail: "Engine: AzureSQLDB",
            template: {
                id: "Standard_Azure",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        showQuickPickStub.resolves(mockTemplateItem);
        (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

        // Set up session created handler to resolve immediately
        mockProfilerService.onSessionCreated.callsFake(
            (_ownerUri: string, handler: (params: unknown) => void) => {
                setTimeout(() => {
                    handler({ sessionName: "TestSession", templateName: "Standard" });
                }, 10);
                return { dispose: sandbox.stub() };
            },
        );

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromDatabase");

        await launchCommand!(mockDatabaseTreeNodeInfo);

        // listDatabases should NOT have been called — database was pre-filled
        expect(mockConnectionManager.listDatabases.called).to.be.false;
    });

    test("should connect with pre-filled database for Azure launched from database node", async () => {
        // Verify the connection is made with the database from the OE node,
        // not the empty database from the original connection profile.
        const mockDatabaseTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // Empty — typical for Database nodes
            },
            nodeType: "Database",
            metadata: {
                metadataTypeName: "Database",
                name: "SalesDB",
            },
        };

        const mockTemplateItem = {
            label: "Standard",
            description: "Standard Azure profiler template",
            detail: "Engine: AzureSQLDB",
            template: {
                id: "Standard_Azure",
                name: "Standard",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION",
            },
        };

        showQuickPickStub.resolves(mockTemplateItem);
        (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

        mockProfilerService.onSessionCreated.callsFake(
            (_ownerUri: string, handler: (params: unknown) => void) => {
                setTimeout(() => {
                    handler({ sessionName: "TestSession", templateName: "Standard" });
                }, 10);
                return { dispose: sandbox.stub() };
            },
        );

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromDatabase");

        await launchCommand!(mockDatabaseTreeNodeInfo);

        // The connect call should use the pre-filled database name "SalesDB"
        expect(mockConnectionManager.connect).to.have.been.called;
        const connectArgs = mockConnectionManager.connect.getCall(0).args;
        const usedProfile = connectArgs[1];
        expect(usedProfile.database).to.equal("SalesDB");
    });
});
