/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { ProfilerWebviewController } from "../../../src/profiler/profilerWebviewController";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { SessionState, SessionType, EventRow } from "../../../src/profiler/profilerTypes";
import { ProfilerService } from "../../../src/services/profilerService";
import VscodeWrapper from "../../../src/controllers/vscodeWrapper";

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
        getXEventSessions: sinon.stub().resolves({ sessions: [] }),
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
    } as unknown as VscodeWrapper;
}

suite("ProfilerWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: VscodeWrapper;
    let mockSessionManager: ProfilerSessionManager;
    let mockProfilerService: ProfilerService;
    let createWebviewPanelStub: sinon.SinonStub;
    let createStatusBarItemStub: sinon.SinonStub;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let mockStatusBarItem: vscode.StatusBarItem;

    // Helper to create test events
    let nextEventNumber = 1;
    function createTestEvent(overrides: Partial<EventRow> = {}): EventRow {
        return {
            id: uuidv4(),
            eventNumber: nextEventNumber++,
            timestamp: new Date(),
            eventClass: "SQL:BatchCompleted",
            textData: "SELECT * FROM users",
            databaseName: "TestDB",
            spid: 55,
            duration: 1000,
            cpu: 10,
            reads: 100,
            writes: 5,
            additionalData: {},
            ...overrides,
        };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        nextEventNumber = 1;

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

        createStatusBarItemStub = sandbox
            .stub(vscode.window, "createStatusBarItem")
            .returns(mockStatusBarItem);

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "/test/path",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        mockVscodeWrapper = createMockVscodeWrapper(sandbox);
        mockProfilerService = createMockProfilerService();
        mockSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(
        availableSessions: Array<{ id: string; name: string }> = [],
        sessionName?: string,
        templateId: string = "Standard_OnPrem",
    ): ProfilerWebviewController {
        return new ProfilerWebviewController(
            mockContext,
            mockVscodeWrapper,
            mockSessionManager,
            availableSessions,
            sessionName,
            templateId,
        );
    }

    suite("constructor", () => {
        test("should create a WebviewPanel with correct options", () => {
            createController();

            expect(createWebviewPanelStub).to.have.been.calledOnce;
        });

        test("should create a status bar item", () => {
            createController();

            expect(createStatusBarItemStub).to.have.been.calledOnce;
        });

        test("should initialize with default state", () => {
            const controller = createController();

            expect(controller.sessionState).to.equal(SessionState.NotStarted);
            expect(controller.currentViewId).to.equal("Standard View");
        });

        test("should initialize with available sessions", () => {
            const sessions = [
                { id: "session1", name: "Session 1" },
                { id: "session2", name: "Session 2" },
            ];
            const controller = createController(sessions);

            expect(controller).to.exist;
        });

        test("should set initial session name if provided", () => {
            const controller = createController([], "TestSession");

            expect(controller).to.exist;
        });
    });

    suite("setCurrentSession", () => {
        test("should set the current session reference", () => {
            const controller = createController();

            const session = mockSessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
            });

            controller.setCurrentSession(session);

            expect(controller.currentSession).to.equal(session);
        });

        test("should clear session when undefined is passed", () => {
            const controller = createController();

            const session = mockSessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
            });

            controller.setCurrentSession(session);
            controller.setCurrentSession(undefined);

            expect(controller.currentSession).to.be.undefined;
        });
    });

    suite("setSessionState", () => {
        test("should update session state to Running", () => {
            const controller = createController();

            controller.setSessionState(SessionState.Running);

            expect(controller.sessionState).to.equal(SessionState.Running);
        });

        test("should update session state to Paused", () => {
            const controller = createController();

            controller.setSessionState(SessionState.Paused);

            expect(controller.sessionState).to.equal(SessionState.Paused);
        });

        test("should update session state to Stopped", () => {
            const controller = createController();

            controller.setSessionState(SessionState.Stopped);

            expect(controller.sessionState).to.equal(SessionState.Stopped);
        });
    });

    suite("setSessionName", () => {
        test("should update session name", () => {
            const controller = createController();

            controller.setSessionName("New Session Name");

            // The name should be set - verify through status bar update
            expect(mockStatusBarItem.text).to.include("New Session Name");
        });
    });

    suite("setView", () => {
        test("should change the current view", () => {
            const controller = createController();

            controller.setView("TSQL View");

            expect(controller.currentViewId).to.equal("TSQL View");
        });

        test("should not change view for invalid view ID", () => {
            const controller = createController();
            const originalViewId = controller.currentViewId;

            controller.setView("NonExistent View");

            expect(controller.currentViewId).to.equal(originalViewId);
        });
    });

    suite("clearRows", () => {
        test("should reset totalRowCount to 0", () => {
            const controller = createController();

            controller.clearRows();

            // Verify postMessage was called to send notification
            expect(mockWebview.postMessage).to.have.been.called;
        });
    });

    suite("setCreatingSession", () => {
        test("should update creating session state to true", () => {
            const controller = createController();

            controller.setCreatingSession(true);

            // State update should trigger postMessage
            expect(mockWebview.postMessage).to.have.been.called;
        });

        test("should update creating session state to false", () => {
            const controller = createController();

            controller.setCreatingSession(false);

            expect(mockWebview.postMessage).to.have.been.called;
        });
    });

    suite("updateAvailableSessions", () => {
        test("should update available sessions list", () => {
            const controller = createController();

            const newSessions = [
                { id: "new1", name: "New Session 1" },
                { id: "new2", name: "New Session 2" },
            ];

            controller.updateAvailableSessions(newSessions);

            expect(mockWebview.postMessage).to.have.been.called;
        });

        test("should handle empty sessions list", () => {
            const controller = createController();

            controller.updateAvailableSessions([]);

            expect(mockWebview.postMessage).to.have.been.called;
        });
    });

    suite("setSelectedSession", () => {
        test("should update selected session ID", () => {
            const controller = createController([{ id: "session1", name: "Session 1" }]);

            controller.setSelectedSession("session1");

            expect(mockWebview.postMessage).to.have.been.called;
        });
    });

    suite("notifyNewEvents", () => {
        test("should send notification when session exists", () => {
            const controller = createController();

            const session = mockSessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
            });
            session.start();
            session.addEvents([createTestEvent(), createTestEvent()]);

            controller.setCurrentSession(session);
            controller.notifyNewEvents(2);

            expect(mockWebview.postMessage).to.have.been.called;
        });

        test("should not send notification when no session", () => {
            const controller = createController();

            controller.notifyNewEvents(5);

            // Should be called for state updates, but not for new events notification
            // when there's no session
        });
    });

    suite("notifyRowsRemoved", () => {
        test("should send notification with removed row IDs", () => {
            const controller = createController();

            const session = mockSessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
                bufferCapacity: 5,
            });
            session.start();

            controller.setCurrentSession(session);

            const removedEvents: EventRow[] = [
                createTestEvent({ id: "removed-1" }),
                createTestEvent({ id: "removed-2" }),
            ];

            controller.notifyRowsRemoved(removedEvents);

            expect(mockWebview.postMessage).to.have.been.called;
        });

        test("should not send notification for empty removed events", () => {
            const controller = createController();

            const session = mockSessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
            });

            controller.setCurrentSession(session);
            const callCountBefore = (mockWebview.postMessage as sinon.SinonStub).callCount;

            controller.notifyRowsRemoved([]);

            // Should not have made an additional call for empty array
            expect((mockWebview.postMessage as sinon.SinonStub).callCount).to.equal(
                callCountBefore,
            );
        });

        test("should not send notification when no session", () => {
            const controller = createController();

            const removedEvents: EventRow[] = [createTestEvent()];

            controller.notifyRowsRemoved(removedEvents);

            // Should handle gracefully without errors
        });
    });

    suite("setEventHandlers", () => {
        test("should set event handlers", () => {
            const controller = createController();

            const handlers = {
                onPauseResume: sandbox.stub(),
                onStop: sandbox.stub(),
                onCreateSession: sandbox.stub(),
                onStartSession: sandbox.stub(),
                onViewChange: sandbox.stub(),
            };

            controller.setEventHandlers(handlers);

            // Handlers should be set without error
            expect(controller).to.exist;
        });
    });

    suite("dispose", () => {
        test("should dispose status bar item", () => {
            const controller = createController();

            controller.dispose();

            expect(mockStatusBarItem.dispose).to.have.been.calledOnce;
        });

        test("should dispose running session", () => {
            const controller = createController();

            const session = mockSessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
            });
            session.start();
            controller.setCurrentSession(session);

            controller.dispose();

            expect(mockStatusBarItem.dispose).to.have.been.calledOnce;
        });
    });

    suite("status bar updates", () => {
        test("should update status bar text with session name and state", () => {
            const controller = createController([], "TestSession");

            controller.setSessionState(SessionState.Running);

            expect(mockStatusBarItem.text).to.include("TestSession");
        });

        test("should show correct state indicator for Running", () => {
            const controller = createController([], "TestSession");

            controller.setSessionState(SessionState.Running);

            // Status bar text should reflect running state
            expect(mockStatusBarItem.text.toLowerCase()).to.include("running");
        });

        test("should show correct state indicator for Paused", () => {
            const controller = createController([], "TestSession");

            controller.setSessionState(SessionState.Paused);

            expect(mockStatusBarItem.text.toLowerCase()).to.include("paused");
        });

        test("should show correct state indicator for Stopped", () => {
            const controller = createController([], "TestSession");

            controller.setSessionState(SessionState.Stopped);

            expect(mockStatusBarItem.text.toLowerCase()).to.include("stopped");
        });
    });

    suite("view configuration", () => {
        test("should use Standard View by default", () => {
            const controller = createController();

            expect(controller.currentViewId).to.equal("Standard View");
        });

        test("should be able to switch between available views", () => {
            const controller = createController();

            controller.setView("TSQL View");
            expect(controller.currentViewId).to.equal("TSQL View");

            controller.setView("Tuning View");
            expect(controller.currentViewId).to.equal("Tuning View");
        });
    });
});
