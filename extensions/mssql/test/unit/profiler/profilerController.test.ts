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
import { ConnectionStore } from "../../../src/models/connectionStore";
import { ConnectionUI } from "../../../src/views/connectionUI";
import { SessionState, SessionType } from "../../../src/profiler/profilerTypes";

chai.use(sinonChai);

/**
 * Creates a stubbed ProfilerService for testing.
 */
function createStubbedProfilerService(
    sandbox: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<ProfilerService> {
    const stub = sandbox.createStubInstance(ProfilerService);
    stub.startProfiling.resolves({ uniqueSessionId: "test-unique-id", canPause: true });
    stub.stopProfiling.resolves({});
    stub.pauseProfiling.resolves({ isPaused: true });
    stub.disconnectSession.resolves({});
    stub.getXEventSessions.resolves({ sessions: ["Session1", "Session2"] });
    stub.createXEventSession.resolves({});
    stub.onEventsAvailable.returns(new vscode.Disposable(() => {}));
    stub.onSessionStopped.returns(new vscode.Disposable(() => {}));
    stub.onSessionCreated.returns(new vscode.Disposable(() => {}));
    return stub;
}

/**
 * Creates a stubbed VscodeWrapper for testing.
 */
function createStubbedVscodeWrapper(
    sandbox: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<VscodeWrapper> {
    const stub = sandbox.createStubInstance(VscodeWrapper);
    stub.getConfiguration.returns({
        get: sandbox.stub().returns(10000),
    } as unknown as vscode.WorkspaceConfiguration);
    return stub;
}

/**
 * Creates a stubbed ConnectionManager for testing.
 */
function createStubbedConnectionManager(
    sandbox: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<ConnectionManager> {
    const connectionStore = sandbox.createStubInstance(ConnectionStore);
    connectionStore.getPickListItems.resolves([]);

    const connectionUI = sandbox.createStubInstance(ConnectionUI);
    connectionUI.promptForConnection.resolves(undefined);

    const stub = sandbox.createStubInstance(ConnectionManager);
    sandbox.stub(stub, "connectionStore").value(connectionStore);
    sandbox.stub(stub, "connectionUI").value(connectionUI);
    stub.connect.resolves(true);
    stub.disconnect.resolves(true);
    stub.getServerInfo.returns(undefined);
    return stub;
}

suite("ProfilerController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let sessionManager: ProfilerSessionManager;
    let profilerService: sinon.SinonStubbedInstance<ProfilerService>;
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

        vscodeWrapper = createStubbedVscodeWrapper(sandbox);
        connectionManager = createStubbedConnectionManager(sandbox);
        profilerService = createStubbedProfilerService(sandbox);
        sessionManager = new ProfilerSessionManager(profilerService);
    });

    teardown(async () => {
        await sessionManager.dispose();
        sandbox.restore();
    });

    function createController(): ProfilerController {
        return new ProfilerController(
            mockContext,
            connectionManager,
            vscodeWrapper,
            sessionManager,
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
            connectionManager.connect.resolves(false);

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
            profilerService.onSessionCreated.callsFake(
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
            profilerService.onSessionCreated.callsFake(
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

            expect(profilerService.getXEventSessions).to.have.been.called;
        });

        test("should show information message when session is created successfully", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves("TestSession");

            // Set up session created handler to resolve immediately
            profilerService.onSessionCreated.callsFake(
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
            connectionManager.connect.rejects(new Error("Connection error"));

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
            expect(connectionManager.disconnect).to.have.been.called;
        });

        test("should disconnect when session name input is cancelled", async () => {
            showQuickPickStub.resolves(mockTemplateItem);
            (vscode.window.showInputBox as sinon.SinonStub).resolves(undefined); // User cancelled input

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            // The webview should NOT be created since user cancelled
            expect(createWebviewPanelStub).to.not.have.been.called;
            expect(connectionManager.disconnect).to.have.been.called;
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
            profilerService.onSessionCreated.callsFake(
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
            connectionManager.connect.resolves(false);

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
            profilerService.onSessionCreated.callsFake(
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
            expect(profilerService.startProfiling).to.have.been.called;
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
            connectionManager.connect.rejects(new Error("Test error"));

            createController();
            const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

            await launchCommand!(mockTreeNodeInfo);

            expect(showErrorMessageStub).to.have.been.called;
        });
    });
});

suite("ProfilerController Integration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let sessionManager: ProfilerSessionManager;
    let profilerService: sinon.SinonStubbedInstance<ProfilerService>;
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

        profilerService = createStubbedProfilerService(sandbox);
        sessionManager = new ProfilerSessionManager(profilerService);
    });

    teardown(async () => {
        await sessionManager.dispose();
        sandbox.restore();
    });

    test("should integrate session manager with webview controller", async () => {
        // Create a session through the manager
        const session = sessionManager.createSession({
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
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let sessionManager: ProfilerSessionManager;
    let profilerService: sinon.SinonStubbedInstance<ProfilerService>;
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

        // Capture registered commands
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

        connectionManager = createStubbedConnectionManager(sandbox);
        connectionManager.listDatabases.resolves(["UserDB1", "UserDB2", "master", "tempdb"]);
        vscodeWrapper = createStubbedVscodeWrapper(sandbox);
        profilerService = createStubbedProfilerService(sandbox);
        sessionManager = new ProfilerSessionManager(profilerService);
    });

    teardown(async () => {
        await sessionManager.dispose();
        sandbox.restore();
    });

    function createController(): ProfilerController {
        return new ProfilerController(
            mockContext,
            connectionManager,
            vscodeWrapper,
            sessionManager,
        );
    }

    test("should connect and launch profiler for Fabric server", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.fabric.microsoft.com",
                authenticationType: "AzureMFA",
                database: "TestDB",
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

        expect(showWarningMessageStub).to.not.have.been.called;
        expect(connectionManager.connect.called).to.be.true;
    });

    test("should prompt for database when Azure SQL has no database selected", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected
            },
        };

        connectionManager.listDatabases.resolves(["master", "tempdb", "UserDB1"]);
        showQuickPickStub.resolves("UserDB1");

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        expect(connectionManager.listDatabases).to.have.been.called;
    });

    test("should prompt for database when Azure SQL has system database selected", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "master", // System database
            },
        };

        connectionManager.listDatabases.resolves(["master", "tempdb", "UserDB1"]);
        showQuickPickStub.resolves("UserDB1");

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        expect(connectionManager.listDatabases).to.have.been.called;
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

        // listDatabases should not have been called since user DB is already selected
        expect(connectionManager.listDatabases.called).to.be.false;
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
        expect(connectionManager.connect.called).to.be.true;
    });

    test("should return early when user cancels database selection for Azure SQL", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected
            },
        };

        // User cancels database selection via quick pick
        connectionManager.listDatabases.resolves(["master", "tempdb", "UserDB1"]);
        showQuickPickStub.resolves(undefined);

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should NOT create webview since user cancelled
        expect((vscode.window.createWebviewPanel as sinon.SinonStub).called).to.be.false;
    });

    test("should return early when connection fails during database selection for Azure SQL", async () => {
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "testserver.database.windows.net",
                authenticationType: "AzureMFA",
                database: "", // No database selected - will trigger database selection
            },
        };

        // The temp connection for listing databases fails
        connectionManager.connect.resolves(false);

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should NOT create webview since connection failed
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
        profilerService.getXEventSessions.resolves({
            sessions: ["ExistingSession", "OtherSession"],
        });

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should NOT call createXEventSession since session exists
        expect(profilerService.createXEventSession).to.not.have.been.called;
        // Should call startProfiling to start the existing session
        expect(profilerService.startProfiling).to.have.been.called;
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
        profilerService.getXEventSessions.resolves({ sessions: [] });

        // Session creation fails
        profilerService.createXEventSession.rejects(new Error("Failed to create session"));

        const showErrorMessageStub = vscode.window.showErrorMessage as sinon.SinonStub;

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // Should show error message about session creation failure
        expect(showErrorMessageStub).to.have.been.called;
        // Disconnect should be called during webview disposal
        expect(connectionManager.disconnect.called).to.be.true;
    });

    test("should clear database from on-prem profile when default database is set", async () => {
        // On-prem XEvent sessions use ON SERVER (server-scoped).
        // If the connection profile has a default (user) database, the database
        // must be cleared so the STS connects at server level.
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "localhost",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
                database: "MyUserDB", // Default database set in connection
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
        (vscode.window.showInputBox as sinon.SinonStub).resolves("Standard_OnPrem");
        profilerService.getXEventSessions.resolves({ sessions: [] });

        profilerService.onSessionCreated.callsFake(
            (_ownerUri: string, handler: (params: unknown) => void) => {
                setTimeout(() => {
                    handler({ sessionName: "Standard_OnPrem", templateName: "Standard" });
                }, 10);
                return { dispose: sandbox.stub() };
            },
        );

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // The connect call should have an empty database (cleared for server-scoped session)
        expect(connectionManager.connect).to.have.been.called;
        const connectArgs = connectionManager.connect.getCall(0).args;
        const usedProfile = connectArgs[1];
        expect(usedProfile.database).to.equal("");
    });

    test("should not clear system database from on-prem profile", async () => {
        // If the on-prem connection is to a system database (e.g. master),
        // there's no need to clear it — server-scoped sessions work fine from master.
        const mockTreeNodeInfo = {
            connectionProfile: {
                server: "localhost",
                authenticationType: "SqlLogin",
                user: "testuser",
                password: "testpass",
                database: "master",
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
        (vscode.window.showInputBox as sinon.SinonStub).resolves("Standard_OnPrem");
        profilerService.getXEventSessions.resolves({ sessions: [] });

        profilerService.onSessionCreated.callsFake(
            (_ownerUri: string, handler: (params: unknown) => void) => {
                setTimeout(() => {
                    handler({ sessionName: "Standard_OnPrem", templateName: "Standard" });
                }, 10);
                return { dispose: sandbox.stub() };
            },
        );

        createController();
        const launchCommand = registeredCommands.get("mssql.profiler.launchFromObjectExplorer");

        await launchCommand!(mockTreeNodeInfo);

        // The connect call should keep the database as "master"
        expect(connectionManager.connect).to.have.been.called;
        const connectArgs = connectionManager.connect.getCall(0).args;
        const usedProfile = connectArgs[1];
        expect(usedProfile.database).to.equal("master");
    });

    test("should not prompt for database when Azure SQL launched from database node", async () => {
        // When launching from a Database node on Azure, the databaseScopeFilter
        // pre-fills connectionProfile.database so ensureUserDatabaseSelected
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
        profilerService.onSessionCreated.callsFake(
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

        profilerService.onSessionCreated.callsFake(
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

        // The connect call should use the pre-filled database
        expect(connectionManager.connect).to.have.been.called;
        const connectArgs = connectionManager.connect.getCall(0).args;
        expect(connectArgs[1].database).to.equal("SalesDB");
    });
});
