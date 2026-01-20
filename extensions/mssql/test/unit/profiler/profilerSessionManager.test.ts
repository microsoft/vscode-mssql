/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { ProfilerSessionOptions } from "../../../src/profiler/profilerSession";
import { SessionType, SessionState, EventRow } from "../../../src/profiler/profilerTypes";
import { ProfilerService } from "../../../src/services/profilerService";

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

suite("ProfilerSessionManager Tests", () => {
    let manager: ProfilerSessionManager;
    let mockProfilerService: ProfilerService;

    const defaultOptions: ProfilerSessionOptions = {
        id: "session-1",
        ownerUri: "profiler://test/connection1",
        sessionName: "Test Session",
        sessionType: SessionType.Live,
        templateName: "Standard",
    };

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
        mockProfilerService = createMockProfilerService();
        manager = new ProfilerSessionManager(mockProfilerService);
    });

    teardown(async () => {
        await manager.dispose();
    });

    suite("sessions property", () => {
        test("should expose sessions map", () => {
            expect(manager.sessions).to.be.instanceOf(Map);
            expect(manager.sessions.size).to.equal(0);
        });
    });

    suite("createSession", () => {
        test("should create a new session", () => {
            const session = manager.createSession(defaultOptions);

            expect(session).to.exist;
            expect(session.id).to.equal("session-1");
            expect(session.ownerUri).to.equal("profiler://test/connection1");
            expect(manager.sessionCount).to.equal(1);
        });

        test("should store session in sessions map", () => {
            const session = manager.createSession(defaultOptions);

            expect(manager.sessions.has(session.id)).to.be.true;
            expect(manager.sessions.get(session.id)).to.equal(session);
        });

        test("should throw error if session ID already exists", () => {
            manager.createSession(defaultOptions);

            expect(() => manager.createSession(defaultOptions)).to.throw(
                "Session with ID 'session-1' already exists",
            );
        });

        test("should allow multiple sessions with different IDs", () => {
            manager.createSession(defaultOptions);
            manager.createSession({
                ...defaultOptions,
                id: "session-2",
                ownerUri: "profiler://test/connection2",
            });

            expect(manager.sessionCount).to.equal(2);
        });
    });

    suite("addEvent", () => {
        test("should add event to session by connectionId", () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            const result = manager.addEvent(defaultOptions.ownerUri, createTestEvent());

            expect(result).to.exist;
            expect(result?.added.eventNumber).to.equal(1);
            expect(session.eventCount).to.equal(1);
        });

        test("should return undefined for non-existent session", () => {
            const result = manager.addEvent("non-existent", createTestEvent());
            expect(result).to.be.undefined;
        });

        test("should return undefined when session is paused", () => {
            const session = manager.createSession(defaultOptions);
            session.pause();

            const result = manager.addEvent(defaultOptions.ownerUri, createTestEvent());
            expect(result).to.be.undefined;
        });
    });

    suite("addEvents", () => {
        test("should add multiple events to session", () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            const events = manager.addEvents(defaultOptions.ownerUri, [
                createTestEvent({ eventClass: "Event1" }),
                createTestEvent({ eventClass: "Event2" }),
                createTestEvent({ eventClass: "Event3" }),
            ]);

            expect(events).to.have.length(3);
            expect(session.eventCount).to.equal(3);
        });

        test("should return empty array for non-existent session", () => {
            const events = manager.addEvents("non-existent", [createTestEvent()]);
            expect(events).to.deep.equal([]);
        });
    });

    suite("getSession", () => {
        test("should get session by ID", () => {
            const created = manager.createSession(defaultOptions);

            const retrieved = manager.getSession("session-1");

            expect(retrieved).to.equal(created);
        });

        test("should return undefined for non-existent ID", () => {
            const session = manager.getSession("non-existent");
            expect(session).to.be.undefined;
        });
    });

    suite("getSessionByOwnerUri", () => {
        test("should get session by ownerUri", () => {
            const created = manager.createSession(defaultOptions);

            const retrieved = manager.getSessionByOwnerUri(defaultOptions.ownerUri);

            expect(retrieved).to.equal(created);
        });

        test("should return undefined for non-existent ownerUri", () => {
            const session = manager.getSessionByOwnerUri("non-existent");
            expect(session).to.be.undefined;
        });
    });

    suite("removeSession", () => {
        test("should remove session by ID", async () => {
            manager.createSession(defaultOptions);

            const result = await manager.removeSession("session-1");

            expect(result).to.be.true;
            expect(manager.sessionCount).to.equal(0);
        });

        test("should return false for non-existent session", async () => {
            const result = await manager.removeSession("non-existent");
            expect(result).to.be.false;
        });

        test("should dispose session when removing", async () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            await manager.removeSession("session-1");

            // Session is disposed (handlers cleaned up) - we can verify the session is no longer in the manager
            expect(manager.hasSession("session-1")).to.be.false;
        });

        test("should remove ownerUri index", async () => {
            manager.createSession(defaultOptions);
            await manager.removeSession("session-1");

            const session = manager.getSessionByOwnerUri(defaultOptions.ownerUri);
            expect(session).to.be.undefined;
        });
    });

    suite("removeSessionByOwnerUri", () => {
        test("should remove session by ownerUri", async () => {
            manager.createSession(defaultOptions);

            const result = await manager.removeSessionByOwnerUri(defaultOptions.ownerUri);

            expect(result).to.be.true;
            expect(manager.sessionCount).to.equal(0);
        });

        test("should return false for non-existent ownerUri", async () => {
            const result = await manager.removeSessionByOwnerUri("non-existent");
            expect(result).to.be.false;
        });
    });

    suite("getAllSessions", () => {
        test("should return empty array when no sessions", () => {
            const sessions = manager.getAllSessions();
            expect(sessions).to.deep.equal([]);
        });

        test("should return all sessions as array", () => {
            manager.createSession(defaultOptions);
            manager.createSession({
                ...defaultOptions,
                id: "session-2",
                ownerUri: "profiler://test/connection2",
            });

            const sessions = manager.getAllSessions();

            expect(sessions).to.have.length(2);
        });
    });

    suite("getRunningSessions", () => {
        test("should return only running sessions", () => {
            const session1 = manager.createSession(defaultOptions);
            manager.createSession({
                ...defaultOptions,
                id: "session-2",
                ownerUri: "profiler://test/connection2",
            });
            session1.start();
            // session2 stays stopped

            const running = manager.getRunningSessions();

            expect(running).to.have.length(1);
            expect(running[0]).to.equal(session1);
        });
    });

    suite("hasSession", () => {
        test("should return true for existing session", () => {
            manager.createSession(defaultOptions);
            expect(manager.hasSession("session-1")).to.be.true;
        });

        test("should return false for non-existent session", () => {
            expect(manager.hasSession("non-existent")).to.be.false;
        });
    });

    suite("startSession", () => {
        test("should start session by ID", () => {
            const session = manager.createSession(defaultOptions);

            manager.startSession("session-1");

            expect(session.isRunning).to.be.true;
        });

        test("should throw for non-existent session", () => {
            expect(() => manager.startSession("non-existent")).to.throw(
                "Session 'non-existent' not found",
            );
        });
    });

    suite("pauseSession", () => {
        test("should pause session by ID", () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            manager.pauseSession("session-1");

            expect(session.isPaused).to.be.true;
        });

        test("should throw for non-existent session", () => {
            expect(() => manager.pauseSession("non-existent")).to.throw(
                "Session 'non-existent' not found",
            );
        });
    });

    suite("stopSession", () => {
        test("should stop session by ID", () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            manager.stopSession("session-1");

            expect(session.isStopped).to.be.true;
        });

        test("should throw for non-existent session", () => {
            expect(() => manager.stopSession("non-existent")).to.throw(
                "Session 'non-existent' not found",
            );
        });
    });

    suite("togglePauseSession", () => {
        test("should pause a running session", () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            const result = manager.togglePauseSession("session-1");

            expect(result).to.be.true;
            expect(session.isPaused).to.be.true;
        });

        test("should resume a paused session", () => {
            const session = manager.createSession(defaultOptions);
            session.start();
            session.pause();

            const result = manager.togglePauseSession("session-1");

            expect(result).to.be.false;
            expect(session.isRunning).to.be.true;
        });

        test("should throw for non-existent session", () => {
            expect(() => manager.togglePauseSession("non-existent")).to.throw(
                "Session 'non-existent' not found",
            );
        });
    });

    suite("togglePauseSessionByOwnerUri", () => {
        test("should toggle pause state by ownerUri", () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            const result = manager.togglePauseSessionByOwnerUri(defaultOptions.ownerUri);

            expect(result).to.be.true;
            expect(session.isPaused).to.be.true;
        });

        test("should throw for non-existent ownerUri", () => {
            expect(() => manager.togglePauseSessionByOwnerUri("non-existent")).to.throw(
                "Session with ownerUri 'non-existent' not found",
            );
        });
    });

    suite("getSessionState", () => {
        test("should return session state", () => {
            const session = manager.createSession(defaultOptions);

            expect(manager.getSessionState("session-1")).to.equal(SessionState.Stopped);

            session.start();
            expect(manager.getSessionState("session-1")).to.equal(SessionState.Running);

            session.pause();
            expect(manager.getSessionState("session-1")).to.equal(SessionState.Paused);
        });

        test("should throw for non-existent session", () => {
            expect(() => manager.getSessionState("non-existent")).to.throw(
                "Session 'non-existent' not found",
            );
        });
    });

    suite("clear", () => {
        test("should remove all sessions", async () => {
            manager.createSession(defaultOptions);
            manager.createSession({
                ...defaultOptions,
                id: "session-2",
                ownerUri: "profiler://test/connection2",
            });

            await manager.clear();

            expect(manager.sessionCount).to.equal(0);
        });

        test("should dispose all sessions when clearing", async () => {
            const session = manager.createSession(defaultOptions);
            session.start();

            await manager.clear();

            // Sessions are disposed and removed
            expect(manager.sessionCount).to.equal(0);
        });
    });

    suite("dispose", () => {
        test("should clear all sessions", async () => {
            manager.createSession(defaultOptions);

            await manager.dispose();

            expect(manager.sessionCount).to.equal(0);
        });
    });
});
