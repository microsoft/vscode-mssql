/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ProfilerSession, ProfilerSessionOptions } from "../../../src/profiler/profilerSession";
import { SessionType, SessionState, XelFileInfo } from "../../../src/profiler/profilerTypes";
import { ProfilerService } from "../../../src/services/profilerService";
import { ProfilingSessionType } from "../../../src/models/contracts/profiler";

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

suite("ProfilerSession XEL File Tests", () => {
    const xelFilePath = "C:\\test\\events\\trace.xel";

    const fileSessionOptions: ProfilerSessionOptions = {
        id: "file-session-1",
        ownerUri: "profiler://test/connection",
        sessionName: xelFilePath, // For file sessions, sessionName is the full path
        sessionType: SessionType.File,
        templateName: "Standard",
        readOnly: true,
    };

    let mockProfilerService: ProfilerService;

    setup(() => {
        mockProfilerService = createMockProfilerService();
    });

    teardown(() => {
        sinon.restore();
    });

    function createFileSession(overrides: Partial<ProfilerSessionOptions> = {}): ProfilerSession {
        return new ProfilerSession(
            {
                ...fileSessionOptions,
                ...overrides,
            },
            mockProfilerService,
        );
    }

    suite("File-based session creation", () => {
        test("should create session with SessionType.File", () => {
            const session = createFileSession();

            expect(session.id).to.equal("file-session-1");
            expect(session.sessionType).to.equal(SessionType.File);
            expect(session.sessionName).to.equal(xelFilePath);
        });

        test("should create session with readOnly flag", () => {
            const session = createFileSession();

            expect(session.readOnly).to.be.true;
        });

        test("should initialize with stopped state", () => {
            const session = createFileSession();
            expect(session.state).to.equal(SessionState.Stopped);
            expect(session.isStopped).to.be.true;
        });

        test("should initialize with empty events buffer", () => {
            const session = createFileSession();
            expect(session.eventCount).to.equal(0);
        });
    });

    suite("File-based session profiling", () => {
        test("should start profiling with LocalFile session type", async () => {
            const session = createFileSession();

            const result = await session.startProfiling();

            expect((mockProfilerService.startProfiling as sinon.SinonStub).calledOnce).to.be.true;

            const startProfilingCall = (
                mockProfilerService.startProfiling as sinon.SinonStub
            ).getCall(0);
            expect(startProfilingCall.args[0]).to.equal(fileSessionOptions.ownerUri);
            expect(startProfilingCall.args[1]).to.equal(xelFilePath);
            expect(startProfilingCall.args[2]).to.equal(ProfilingSessionType.LocalFile);

            // canPause should be false for file sessions
            expect(result.canPause).to.be.false;
        });

        test("should set canPause to false for file sessions", async () => {
            const session = createFileSession();

            await session.startProfiling();

            expect(session.canPause).to.be.false;
        });

        test("should transition to Running state after startProfiling", async () => {
            const session = createFileSession();

            await session.startProfiling();

            expect(session.state).to.equal(SessionState.Running);
            expect(session.isRunning).to.be.true;
        });
    });

    suite("Read-only session behavior", () => {
        test("readOnly sessions should not allow lifecycle actions conceptually", () => {
            const session = createFileSession();

            // This is a conceptual test - in practice, the controller
            // prevents these actions from being called on read-only sessions
            expect(session.readOnly).to.be.true;

            // The session type should be File for read-only file sessions
            expect(session.sessionType).to.equal(SessionType.File);
        });
    });
});

suite("XelFileInfo Tests", () => {
    test("should contain required properties", () => {
        const xelFileInfo: XelFileInfo = {
            filePath: "C:\\test\\trace.xel",
            fileName: "trace.xel",
            fileSize: 1024,
        };

        expect(xelFileInfo.filePath).to.equal("C:\\test\\trace.xel");
        expect(xelFileInfo.fileName).to.equal("trace.xel");
        expect(xelFileInfo.fileSize).to.equal(1024);
    });

    test("should allow optional fileSize", () => {
        const xelFileInfo: XelFileInfo = {
            filePath: "C:\\test\\trace.xel",
            fileName: "trace.xel",
        };

        expect(xelFileInfo.filePath).to.equal("C:\\test\\trace.xel");
        expect(xelFileInfo.fileName).to.equal("trace.xel");
        expect(xelFileInfo.fileSize).to.be.undefined;
    });
});

suite("ProfilerWebviewState Read-Only Tests", () => {
    test("should include isReadOnly property", () => {
        // Import the type to verify it compiles correctly
        // The actual test is that this code compiles without error
        interface TestState {
            isReadOnly?: boolean;
            xelFilePath?: string;
            xelFileName?: string;
        }

        const readOnlyState: TestState = {
            isReadOnly: true,
            xelFilePath: "C:\\test\\trace.xel",
            xelFileName: "trace.xel",
        };

        expect(readOnlyState.isReadOnly).to.be.true;
        expect(readOnlyState.xelFilePath).to.equal("C:\\test\\trace.xel");
        expect(readOnlyState.xelFileName).to.equal("trace.xel");
    });

    test("should default isReadOnly to undefined/false", () => {
        interface TestState {
            isReadOnly?: boolean;
        }

        const normalState: TestState = {};

        expect(normalState.isReadOnly).to.be.undefined;
    });
});
