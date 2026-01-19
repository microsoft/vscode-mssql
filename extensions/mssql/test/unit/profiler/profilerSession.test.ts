/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ProfilerSession, ProfilerSessionOptions } from "../../../src/profiler/profilerSession";
import {
    SessionType,
    SessionState,
    EventRow,
    FilterKind,
} from "../../../src/profiler/profilerTypes";
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

suite("ProfilerSession Tests", () => {
    const defaultOptions: ProfilerSessionOptions = {
        id: "test-session-1",
        ownerUri: "profiler://test/connection",
        sessionName: "Test Session",
        sessionType: SessionType.Live,
        templateName: "Standard",
    };

    let mockProfilerService: ProfilerService;

    setup(() => {
        mockProfilerService = createMockProfilerService();
    });

    function createSession(overrides: Partial<ProfilerSessionOptions> = {}): ProfilerSession {
        return new ProfilerSession(
            {
                ...defaultOptions,
                ...overrides,
            },
            mockProfilerService,
        );
    }

    function createTestEvent(
        overrides: Partial<Omit<EventRow, "sequenceNumber">> = {},
    ): Omit<EventRow, "sequenceNumber"> {
        return {
            id: "test-event-id",
            eventNumber: 1,
            timestamp: Date.now(),
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

    suite("constructor", () => {
        test("should create session with required properties", () => {
            const session = createSession();

            expect(session.id).to.equal("test-session-1");
            expect(session.ownerUri).to.equal("profiler://test/connection");
            expect(session.sessionName).to.equal("Test Session");
            expect(session.sessionType).to.equal(SessionType.Live);
            expect(session.templateName).to.equal("Standard");
        });

        test("should initialize with stopped state", () => {
            const session = createSession();
            expect(session.state).to.equal(SessionState.Stopped);
            expect(session.isStopped).to.be.true;
        });

        test("should initialize with empty events buffer", () => {
            const session = createSession();
            expect(session.eventCount).to.equal(0);
        });

        test("should initialize with empty filters", () => {
            const session = createSession();
            expect(session.filters).to.deep.equal([]);
        });

        test("should set createdAt timestamp", () => {
            const before = Date.now();
            const session = createSession();
            const after = Date.now();

            expect(session.createdAt).to.be.at.least(before);
            expect(session.createdAt).to.be.at.most(after);
        });

        test("should default readOnly to false", () => {
            const session = createSession();
            expect(session.readOnly).to.be.false;
        });

        test("should allow setting readOnly to true", () => {
            const session = createSession({ readOnly: true });
            expect(session.readOnly).to.be.true;
        });

        test("should use custom buffer capacity", () => {
            const session = createSession({ bufferCapacity: 500 });
            expect(session.events.capacity).to.equal(500);
        });

        test("should initialize with default view config", () => {
            const session = createSession();
            expect(session.viewConfig).to.exist;
            expect(session.viewConfig.name).to.equal("Default");
            expect(session.viewConfig.columns).to.be.an("array");
        });
    });

    suite("state management", () => {
        test("should transition to running state", () => {
            const session = createSession();

            session.start();

            expect(session.state).to.equal(SessionState.Running);
            expect(session.isRunning).to.be.true;
            expect(session.isPaused).to.be.false;
            expect(session.isStopped).to.be.false;
        });

        test("should transition to paused state", () => {
            const session = createSession();
            session.start();

            session.pause();

            expect(session.state).to.equal(SessionState.Paused);
            expect(session.isPaused).to.be.true;
            expect(session.isRunning).to.be.false;
        });

        test("should transition to stopped state", () => {
            const session = createSession();
            session.start();

            session.stop();

            expect(session.state).to.equal(SessionState.Stopped);
            expect(session.isStopped).to.be.true;
            expect(session.isRunning).to.be.false;
        });

        test("should pause event buffer when paused", () => {
            const session = createSession();
            session.start();

            session.pause();

            expect(session.events.isPaused()).to.be.true;
        });

        test("should unpause event buffer when started", () => {
            const session = createSession();
            session.pause();

            session.start();

            expect(session.events.isPaused()).to.be.false;
        });
    });

    suite("event management", () => {
        test("should add event to buffer", () => {
            const session = createSession();
            session.start();

            const event = session.addEvent(createTestEvent());

            expect(event).to.exist;
            expect(event?.added.eventNumber).to.equal(1);
            expect(session.eventCount).to.equal(1);
        });

        test("should update lastEventTimestamp when adding event", () => {
            const session = createSession();
            session.start();
            const timestamp = Date.now();

            session.addEvent(createTestEvent({ timestamp }));

            expect(session.lastEventTimestamp).to.equal(timestamp);
        });

        test("should not add events when paused", () => {
            const session = createSession();
            session.pause();

            const event = session.addEvent(createTestEvent());

            expect(event).to.be.undefined;
            expect(session.eventCount).to.equal(0);
        });

        test("should add multiple events", () => {
            const session = createSession();
            session.start();

            const events = session.addEvents([
                createTestEvent({ eventClass: "Event1" }),
                createTestEvent({ eventClass: "Event2" }),
                createTestEvent({ eventClass: "Event3" }),
            ]);

            expect(events).to.have.length(3);
            expect(session.eventCount).to.equal(3);
        });

        test("should clear events", () => {
            const session = createSession();
            session.start();
            session.addEvents([createTestEvent(), createTestEvent()]);

            session.clearEvents();

            expect(session.eventCount).to.equal(0);
            expect(session.lastEventTimestamp).to.equal(0);
        });
    });

    suite("filter management", () => {
        test("should set filters", () => {
            const session = createSession();
            const filters = [{ filters: [{ kind: FilterKind.Equal, field: "spid", value: 55 }] }];

            session.setFilters(filters);

            expect(session.filters).to.deep.equal(filters);
        });

        test("should add filter", () => {
            const session = createSession();
            const filter = {
                filters: [{ kind: FilterKind.Contains, field: "textData", value: "SELECT" }],
            };

            session.addFilter(filter);

            expect(session.filters).to.have.length(1);
            expect(session.filters[0]).to.deep.equal(filter);
        });

        test("should clear filters", () => {
            const session = createSession();
            session.addFilter({ filters: [] });
            session.addFilter({ filters: [] });

            session.clearFilters();

            expect(session.filters).to.deep.equal([]);
        });
    });

    suite("session types", () => {
        test("should support Live session type", () => {
            const session = createSession({ sessionType: SessionType.Live });
            expect(session.sessionType).to.equal(SessionType.Live);
        });

        test("should support File session type", () => {
            const session = createSession({ sessionType: SessionType.File });
            expect(session.sessionType).to.equal(SessionType.File);
        });
    });

    suite("toJSON", () => {
        test("should serialize session to JSON", () => {
            const session = createSession();
            session.start();
            session.addEvent(createTestEvent());

            const json = session.toJSON();

            expect(json.id).to.equal("test-session-1");
            expect(json.ownerUri).to.equal("profiler://test/connection");
            expect(json.sessionName).to.equal("Test Session");
            expect(json.sessionType).to.equal(SessionType.Live);
            expect(json.templateName).to.equal("Standard");
            expect(json.state).to.equal(SessionState.Running);
            expect(json.eventCount).to.equal(1);
            expect(json.readOnly).to.be.false;
        });
    });

    suite("view configuration", () => {
        test("should allow setting custom view config", () => {
            const customConfig = {
                id: "Custom",
                name: "Custom View",
                columns: [
                    { field: "eventClass", header: "Event", width: 200, eventsMapped: ["name"] },
                ],
            };
            const session = createSession({ viewConfig: customConfig });

            expect(session.viewConfig).to.deep.equal(customConfig);
        });

        test("should allow updating view config", () => {
            const session = createSession();
            const newConfig = {
                id: "Updated",
                name: "Updated View",
                columns: [
                    {
                        field: "textData",
                        header: "SQL",
                        width: 500,
                        eventsMapped: ["batch_text", "statement"],
                    },
                ],
            };

            session.viewConfig = newConfig;

            expect(session.viewConfig).to.deep.equal(newConfig);
        });
    });

    suite("File Session Tests", () => {
        const fileSessionOptions: ProfilerSessionOptions = {
            id: "file-session-1",
            ownerUri: "profiler://file/test",
            sessionName: "/test/path/to/events.xel",
            sessionType: SessionType.File,
            templateName: "File",
            readOnly: true,
        };

        test("should create file session with readOnly flag", () => {
            // File sessions should return canPause: false
            (mockProfilerService.startProfiling as sinon.SinonStub).resolves({
                uniqueSessionId: "test-file-session-id",
                canPause: false,
            });

            const session = new ProfilerSession(fileSessionOptions, mockProfilerService);

            expect(session.sessionType).to.equal(SessionType.File);
            expect(session.readOnly).to.be.true;
        });

        test("should use LocalFile profiling type when starting file session", async () => {
            // File sessions should return canPause: false
            (mockProfilerService.startProfiling as sinon.SinonStub).resolves({
                uniqueSessionId: "test-file-session-id",
                canPause: false,
            });

            const session = new ProfilerSession(fileSessionOptions, mockProfilerService);

            await session.startProfiling();

            expect((mockProfilerService.startProfiling as sinon.SinonStub).calledOnce).to.be.true;
            const callArgs = (mockProfilerService.startProfiling as sinon.SinonStub).firstCall.args;

            // Third argument should be ProfilingSessionType.LocalFile (value 1)
            expect(callArgs[2]).to.equal(1); // ProfilingSessionType.LocalFile
        });

        test("file session should have canPause set to false after starting", async () => {
            // File sessions should return canPause: false
            (mockProfilerService.startProfiling as sinon.SinonStub).resolves({
                uniqueSessionId: "test-file-session-id",
                canPause: false,
            });

            const session = new ProfilerSession(fileSessionOptions, mockProfilerService);

            await session.startProfiling();

            expect(session.canPause).to.be.false;
        });
    });
});
