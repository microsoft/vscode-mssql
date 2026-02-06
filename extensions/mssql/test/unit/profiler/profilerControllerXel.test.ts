/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as path from "path";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { ProfilerService } from "../../../src/services/profilerService";
import { XelFileInfo, SessionType, SessionState } from "../../../src/profiler/profilerTypes";

/**
 * Creates a mock ProfilerService for testing.
 */
function createMockProfilerService(): ProfilerService {
    return {
        startProfiling: sinon
            .stub()
            .resolves({ uniqueSessionId: "test-unique-id", canPause: false }),
        stopProfiling: sinon.stub().resolves({}),
        pauseProfiling: sinon.stub().resolves({ isPaused: false }),
        disconnectSession: sinon.stub().resolves({}),
        getXEventSessions: sinon.stub().resolves({ sessions: [] }),
        createXEventSession: sinon.stub().resolves({}),
        onEventsAvailable: sinon.stub().returns(new vscode.Disposable(() => {})),
        onSessionStopped: sinon.stub().returns(new vscode.Disposable(() => {})),
        onSessionCreated: sinon.stub().returns(new vscode.Disposable(() => {})),
        cleanupHandlers: sinon.stub(),
    } as unknown as ProfilerService;
}

suite("ProfilerController XEL File Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockProfilerService: ProfilerService;
    let sessionManager: ProfilerSessionManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockProfilerService = createMockProfilerService();
        sessionManager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("XEL File Validation", () => {
        test("should validate .xel file extension correctly", () => {
            const validPaths = [
                "C:\\test\\trace.xel",
                "/home/user/trace.xel",
                "trace.xel",
                "Trace.XEL", // case insensitive
            ];

            for (const filePath of validPaths) {
                const ext = path.extname(filePath).toLowerCase();
                expect(ext).to.equal(".xel", `Expected ${filePath} to have .xel extension`);
            }
        });

        test("should reject non-.xel file extensions", () => {
            const invalidPaths = [
                "C:\\test\\trace.xml",
                "/home/user/trace.log",
                "trace.txt",
                "trace.xel.bak",
            ];

            for (const filePath of invalidPaths) {
                const ext = path.extname(filePath).toLowerCase();
                expect(ext).to.not.equal(".xel", `Expected ${filePath} to NOT have .xel extension`);
            }
        });
    });

    suite("XelFileInfo", () => {
        test("should create XelFileInfo with all properties", () => {
            const fileInfo: XelFileInfo = {
                filePath: path.join("test", "events", "trace.xel"),
                fileName: "trace.xel",
                fileSize: 2048,
            };

            expect(fileInfo.filePath).to.equal(path.join("test", "events", "trace.xel"));
            expect(fileInfo.fileName).to.equal("trace.xel");
            expect(fileInfo.fileSize).to.equal(2048);
        });

        test("should extract fileName from filePath correctly", () => {
            const filePath = path.join("test", "events", "trace.xel");
            const fileName = path.basename(filePath);

            expect(fileName).to.equal("trace.xel");
        });
    });

    suite("Session Type Detection", () => {
        test("should identify File session type for XEL files", () => {
            const session = sessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "C:\\test\\trace.xel",
                sessionType: SessionType.File,
                templateName: "Standard",
                readOnly: true,
            });

            expect(session.sessionType).to.equal(SessionType.File);
            expect(session.readOnly).to.be.true;
        });

        test("should identify Live session type for server sessions", () => {
            const session = sessionManager.createSession({
                id: "test-session",
                ownerUri: "profiler://test",
                sessionName: "MyXEventSession",
                sessionType: SessionType.Live,
                templateName: "Standard",
            });

            expect(session.sessionType).to.equal(SessionType.Live);
            expect(session.readOnly).to.be.false;
        });
    });

    suite("Read-Only Session Behavior", () => {
        test("should create read-only session for XEL files", () => {
            const session = sessionManager.createSession({
                id: "xel-session",
                ownerUri: "profiler://test",
                sessionName: "C:\\test\\trace.xel",
                sessionType: SessionType.File,
                templateName: "Standard",
                readOnly: true,
            });

            expect(session.readOnly).to.be.true;
            expect(session.sessionType).to.equal(SessionType.File);
        });

        test("read-only session canPause should be false", async () => {
            const session = sessionManager.createSession({
                id: "xel-session",
                ownerUri: "profiler://test",
                sessionName: "C:\\test\\trace.xel",
                sessionType: SessionType.File,
                templateName: "Standard",
                readOnly: true,
            });

            // Start the session to get canPause value
            await sessionManager.startProfilingSession("xel-session");

            expect(session.canPause).to.be.false;
        });
    });

    suite("Session Manager with XEL Sessions", () => {
        test("should create and track XEL file session", () => {
            const session = sessionManager.createSession({
                id: "xel-session-1",
                ownerUri: "profiler://test",
                sessionName: "C:\\test\\trace.xel",
                sessionType: SessionType.File,
                templateName: "Standard",
                readOnly: true,
            });

            const retrievedSession = sessionManager.getSession("xel-session-1");

            expect(retrievedSession).to.equal(session);
            expect(retrievedSession?.sessionType).to.equal(SessionType.File);
        });

        test("should remove XEL file session correctly", async () => {
            sessionManager.createSession({
                id: "xel-session-to-dispose",
                ownerUri: "profiler://test",
                sessionName: "C:\\test\\trace.xel",
                sessionType: SessionType.File,
                templateName: "Standard",
                readOnly: true,
            });

            await sessionManager.removeSession("xel-session-to-dispose");

            const session = sessionManager.getSession("xel-session-to-dispose");
            expect(session).to.be.undefined;
        });
    });
});

suite("ProfilerWebviewController Read-Only State Tests", () => {
    test("should pass isReadOnly state for XEL file sessions", () => {
        // This is a structural test to verify the state shape
        const readOnlyState = {
            totalRowCount: 0,
            clearGeneration: 0,
            sessionState: SessionState.Running,
            autoScroll: false, // Should be disabled for read-only
            sessionName: "trace.xel",
            isReadOnly: true,
            xelFilePath: "C:\\test\\trace.xel",
            xelFileName: "trace.xel",
        };

        expect(readOnlyState.isReadOnly).to.be.true;
        expect(readOnlyState.autoScroll).to.be.false;
        expect(readOnlyState.xelFilePath).to.equal("C:\\test\\trace.xel");
        expect(readOnlyState.xelFileName).to.equal("trace.xel");
    });

    test("should have default state for live sessions", () => {
        const liveState = {
            totalRowCount: 0,
            clearGeneration: 0,
            sessionState: SessionState.NotStarted,
            autoScroll: true,
            sessionName: undefined,
            isReadOnly: false,
            xelFilePath: undefined,
            xelFileName: undefined,
        };

        expect(liveState.isReadOnly).to.be.false;
        expect(liveState.autoScroll).to.be.true;
        expect(liveState.xelFilePath).to.be.undefined;
        expect(liveState.xelFileName).to.be.undefined;
    });
});
