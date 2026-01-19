/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ProfilerController } from "../../../src/profiler/profilerController";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { SessionType, SessionState } from "../../../src/profiler/profilerTypes";
import { ProfilerService } from "../../../src/services/profilerService";
import ConnectionManager from "../../../src/controllers/connectionManager";
import VscodeWrapper from "../../../src/controllers/vscodeWrapper";

/**
 * Creates a mock ProfilerService for testing.
 */
function createMockProfilerService(): ProfilerService {
    return {
        startProfiling: sinon
            .stub()
            .resolves({ uniqueSessionId: "test-unique-id", canPause: false }),
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

suite("ProfilerController XEL File Support Tests", () => {
    let controller: ProfilerController;
    let context: vscode.ExtensionContext;
    let connectionManager: ConnectionManager;
    let vscodeWrapper: VscodeWrapper;
    let profilerSessionManager: ProfilerSessionManager;
    let mockProfilerService: ProfilerService;

    setup(() => {
        // Mock extension context
        context = {
            subscriptions: [],
            extensionUri: vscode.Uri.file("/test"),
        } as unknown as vscode.ExtensionContext;

        // Mock connection manager
        connectionManager = {
            connect: sinon.stub().resolves(true),
            disconnect: sinon.stub().resolves(),
            connectionStore: {
                getPickListItems: sinon.stub().resolves([]),
            },
            connectionUI: {
                promptForConnection: sinon.stub().resolves(null),
            },
        } as unknown as ConnectionManager;

        // Mock vscode wrapper
        vscodeWrapper = {
            outputChannel: {
                appendLine: sinon.stub(),
            },
        } as unknown as VscodeWrapper;

        // Create mock profiler service and session manager
        mockProfilerService = createMockProfilerService();
        profilerSessionManager = new ProfilerSessionManager(mockProfilerService);

        // Create controller
        controller = new ProfilerController(
            context,
            connectionManager,
            vscodeWrapper,
            profilerSessionManager,
        );
    });

    teardown(async () => {
        await controller.dispose();
        sinon.restore();
    });

    suite("openXelFile", () => {
        test("should prompt user to select .xel file", async () => {
            const showOpenDialogStub = sinon.stub(vscode.window, "showOpenDialog").resolves([]);

            await controller.openXelFile();

            expect(showOpenDialogStub.calledOnce).to.be.true;
            const callArgs = showOpenDialogStub.firstCall.args[0];
            expect(callArgs?.filters).to.deep.equal({
                "Extended Events Files": ["xel"],
            });
        });

        test("should handle user cancellation gracefully", async () => {
            sinon.stub(vscode.window, "showOpenDialog").resolves(undefined);

            // Should not throw
            await controller.openXelFile();
        });

        test("should call launchProfilerForFile when file is selected", async () => {
            const testFilePath = "/test/path/to/events.xel";
            sinon
                .stub(vscode.window, "showOpenDialog")
                .resolves([vscode.Uri.file(testFilePath)]);

            const launchSpy = sinon.stub(controller, "launchProfilerForFile").resolves();

            await controller.openXelFile();

            expect(launchSpy.calledOnce).to.be.true;
            expect(launchSpy.firstCall.args[0]).to.equal(testFilePath);
        });
    });

    suite("launchProfilerForFile", () => {
        test("should create a file-based session", async () => {
            const testFilePath = "/test/path/to/events.xel";
            const createSessionSpy = sinon.spy(profilerSessionManager, "createSession");

            await controller.launchProfilerForFile(testFilePath);

            expect(createSessionSpy.calledOnce).to.be.true;
            const sessionOptions = createSessionSpy.firstCall.args[0];
            expect(sessionOptions.sessionType).to.equal(SessionType.File);
            expect(sessionOptions.readOnly).to.be.true;
            expect(sessionOptions.sessionName).to.equal(testFilePath);
        });

        test("should start profiling session automatically", async () => {
            const testFilePath = "/test/path/to/events.xel";
            const startProfilingSpy = sinon.spy(profilerSessionManager, "startProfilingSession");

            await controller.launchProfilerForFile(testFilePath);

            expect(startProfilingSpy.calledOnce).to.be.true;
        });

        test("should show success message when file is opened", async () => {
            const testFilePath = "/test/path/to/events.xel";
            const showInfoMessageStub = sinon.stub(vscode.window, "showInformationMessage");

            await controller.launchProfilerForFile(testFilePath);

            expect(showInfoMessageStub.calledOnce).to.be.true;
            const message = showInfoMessageStub.firstCall.args[0];
            expect(message).to.include("events.xel");
        });

        test("should handle errors gracefully", async () => {
            const testFilePath = "/test/path/to/events.xel";
            const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
            
            // Force an error by stubbing createSession to throw
            sinon.stub(profilerSessionManager, "createSession").throws(new Error("Test error"));

            await controller.launchProfilerForFile(testFilePath);

            expect(showErrorMessageStub.calledOnce).to.be.true;
        });
    });

    suite("Read-only session semantics", () => {
        test("file session should have canPause set to false", async () => {
            const testFilePath = "/test/path/to/events.xel";

            await controller.launchProfilerForFile(testFilePath);

            // The mock service returns canPause: false for file sessions
            const session = Array.from(profilerSessionManager.sessions.values())[0];
            expect(session.canPause).to.be.false;
        });

        test("file session should be marked as read-only", async () => {
            const testFilePath = "/test/path/to/events.xel";

            await controller.launchProfilerForFile(testFilePath);

            const session = Array.from(profilerSessionManager.sessions.values())[0];
            expect(session.readOnly).to.be.true;
        });

        test("file session should not require server connection", async () => {
            const testFilePath = "/test/path/to/events.xel";
            const connectSpy = sinon.spy(connectionManager, "connect");

            await controller.launchProfilerForFile(testFilePath);

            // Should not call connect since file sessions don't need server connection
            expect(connectSpy.called).to.be.false;
        });
    });
});
