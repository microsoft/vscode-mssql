/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ProfilerWebviewController } from "../../../src/profiler/profilerWebviewController";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { ProfilerSession } from "../../../src/profiler/profilerSession";
import { SessionType, SessionState } from "../../../src/profiler/profilerTypes";
import { ProfilerService } from "../../../src/services/profilerService";
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

suite("ProfilerWebviewController Tests", () => {
    let context: vscode.ExtensionContext;
    let vscodeWrapper: VscodeWrapper;
    let profilerSessionManager: ProfilerSessionManager;
    let mockProfilerService: ProfilerService;

    setup(() => {
        // Mock extension context
        context = {
            subscriptions: [],
            extensionUri: vscode.Uri.file("/test"),
        } as unknown as vscode.ExtensionContext;

        // Mock vscode wrapper
        vscodeWrapper = {
            outputChannel: {
                appendLine: sinon.stub(),
            },
        } as unknown as VscodeWrapper;

        // Create mock profiler service and session manager
        mockProfilerService = createMockProfilerService();
        profilerSessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(() => {
        sinon.restore();
    });

    suite("setCurrentSession", () => {
        test("should set readOnly state from session.readOnly property for file sessions", () => {
            const webviewController = new ProfilerWebviewController(
                context,
                vscodeWrapper,
                profilerSessionManager,
                [],
                undefined,
                "Standard_OnPrem",
            );

            // Create a file session with readOnly=true
            const fileSession = profilerSessionManager.createSession({
                id: "file-session-1",
                ownerUri: "profiler://file/test",
                sessionName: "/test/path/to/events.xel",
                sessionType: SessionType.File,
                templateName: "File",
                readOnly: true,
            });

            // Set the current session
            webviewController.setCurrentSession(fileSession);

            // Verify the state includes readOnly from the session
            expect(webviewController.state.readOnly).to.be.true;
        });

        test("should set readOnly state to false for live sessions", () => {
            const webviewController = new ProfilerWebviewController(
                context,
                vscodeWrapper,
                profilerSessionManager,
                [],
                undefined,
                "Standard_OnPrem",
            );

            // Create a live session with readOnly=false (or undefined, which defaults to false)
            const liveSession = profilerSessionManager.createSession({
                id: "live-session-1",
                ownerUri: "profiler://test/connection",
                sessionName: "Test Session",
                sessionType: SessionType.Live,
                templateName: "Standard",
                readOnly: false,
            });

            // Set the current session
            webviewController.setCurrentSession(liveSession);

            // Verify the state includes readOnly=false from the session
            expect(webviewController.state.readOnly).to.be.false;
        });

        test("should clear readOnly state when session is set to undefined", () => {
            const webviewController = new ProfilerWebviewController(
                context,
                vscodeWrapper,
                profilerSessionManager,
                [],
                undefined,
                "Standard_OnPrem",
            );

            // First set a file session with readOnly=true
            const fileSession = profilerSessionManager.createSession({
                id: "file-session-1",
                ownerUri: "profiler://file/test",
                sessionName: "/test/path/to/events.xel",
                sessionType: SessionType.File,
                templateName: "File",
                readOnly: true,
            });

            webviewController.setCurrentSession(fileSession);
            expect(webviewController.state.readOnly).to.be.true;

            // Now clear the session
            webviewController.setCurrentSession(undefined);

            // Verify readOnly is cleared
            expect(webviewController.state.readOnly).to.be.false;
        });
    });
});
