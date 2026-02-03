/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { ProfilerSession, ProfilerSessionOptions } from "../../../src/profiler/profilerSession";
import { ProfilerSessionManager } from "../../../src/profiler/profilerSessionManager";
import { EventRow, SessionState, SessionType } from "../../../src/profiler/profilerTypes";

/**
 * Creates a mock ProfilerSession for testing.
 * @param overrides - Partial overrides for session properties
 */
export function createMockSession(
    overrides: Partial<{
        id: string;
        sessionName: string;
        ownerUri: string;
        templateName: string;
        state: SessionState;
        eventCount: number;
        bufferCapacity: number;
        createdAt: number;
        events: EventRow[];
    }> = {},
): ProfilerSession {
    const defaultOptions: ProfilerSessionOptions = {
        id: overrides.id ?? "test-session-id",
        ownerUri: overrides.ownerUri ?? "mssql://localhost/testdb",
        sessionName: overrides.sessionName ?? "Test Session",
        sessionType: SessionType.Live,
        templateName: overrides.templateName ?? "Standard",
        bufferCapacity: overrides.bufferCapacity ?? 10000,
    };

    // Create a mock profiler service
    const mockProfilerService = {
        onSessionCreated: sinon.stub().returns({ dispose: sinon.stub() }),
        onEventsAvailable: sinon.stub().returns({ dispose: sinon.stub() }),
        onSessionStopped: sinon.stub().returns({ dispose: sinon.stub() }),
    } as any;

    // Create the session
    const session = new ProfilerSession(defaultOptions, mockProfilerService);

    // Override state if provided
    if (overrides.state !== undefined) {
        // Use the setter method or directly set the private property for testing
        switch (overrides.state) {
            case SessionState.Running:
                session["_state"] = SessionState.Running;
                break;
            case SessionState.Paused:
                session["_state"] = SessionState.Paused;
                break;
            case SessionState.Stopped:
                session["_state"] = SessionState.Stopped;
                break;
            case SessionState.Creating:
                session["_state"] = SessionState.Creating;
                break;
            case SessionState.Failed:
                session["_state"] = SessionState.Failed;
                break;
            case SessionState.NotStarted:
                session["_state"] = SessionState.NotStarted;
                break;
        }
    }

    // Add events if provided
    if (overrides.events) {
        for (const event of overrides.events) {
            session.events.add(event);
        }
    }

    return session;
}

/**
 * Creates a mock ProfilerSessionManager with configurable sessions.
 * @param sessions - Array of mock sessions to return
 */
export function createMockSessionManager(
    sessions: ProfilerSession[] = [],
): sinon.SinonStubbedInstance<ProfilerSessionManager> {
    const sessionsMap = new Map<string, ProfilerSession>();
    for (const session of sessions) {
        sessionsMap.set(session.id, session);
    }

    const mockManager = {
        sessions: sessionsMap,
        sessionCount: sessions.length,
        getAllSessions: sinon.stub().returns(sessions),
        getSession: sinon.stub().callsFake((id: string) => sessionsMap.get(id)),
        getRunningSessions: sinon
            .stub()
            .returns(sessions.filter((s) => s.state === SessionState.Running)),
        hasSession: sinon.stub().callsFake((id: string) => sessionsMap.has(id)),
    } as unknown as sinon.SinonStubbedInstance<ProfilerSessionManager>;

    return mockManager;
}

/**
 * Creates a mock EventRow for testing.
 * @param overrides - Partial overrides for event properties
 */
export function createMockEvent(
    overrides: Partial<EventRow> & { id?: string; eventNumber?: number } = {},
): EventRow {
    return {
        id: overrides.id ?? `event-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        eventNumber: overrides.eventNumber ?? 1,
        timestamp: overrides.timestamp ?? new Date(),
        eventClass: overrides.eventClass ?? "sql_batch_completed",
        textData: overrides.textData ?? "SELECT * FROM TestTable",
        databaseName: overrides.databaseName ?? "TestDatabase",
        spid: overrides.spid ?? 52,
        duration: overrides.duration ?? 1000,
        cpu: overrides.cpu ?? 100,
        reads: overrides.reads ?? 50,
        writes: overrides.writes ?? 10,
        additionalData: overrides.additionalData ?? {},
    };
}

/**
 * Options for creating multiple mock events.
 */
export interface CreateMockEventsOptions extends Partial<EventRow> {
    /** Base timestamp for the first event (defaults to Date.now()) */
    baseTimestamp?: number;
    /** Time increment between events in milliseconds (defaults to 1000ms) */
    timestampIncrement?: number;
}

/**
 * Creates multiple mock events with sequential numbers.
 * @param count - Number of events to create
 * @param options - Options for creating events
 */
export function createMockEvents(count: number, options: CreateMockEventsOptions = {}): EventRow[] {
    const events: EventRow[] = [];
    const { baseTimestamp, timestampIncrement = 1000, ...baseOverrides } = options;
    const baseTime = baseTimestamp ? new Date(baseTimestamp) : new Date();

    for (let i = 0; i < count; i++) {
        const timestamp = new Date(baseTime.getTime() + i * timestampIncrement);
        events.push(
            createMockEvent({
                ...baseOverrides,
                id: `event-${i}`,
                eventNumber: i + 1,
                timestamp,
            }),
        );
    }

    return events;
}

/**
 * Maps SessionState enum to string representation.
 * @param state - The session state enum value
 */
export function mapSessionStateToString(
    state: SessionState,
): "running" | "paused" | "stopped" | "creating" | "failed" | "notStarted" {
    switch (state) {
        case SessionState.Running:
            return "running";
        case SessionState.Paused:
            return "paused";
        case SessionState.Stopped:
            return "stopped";
        case SessionState.Creating:
            return "creating";
        case SessionState.Failed:
            return "failed";
        case SessionState.NotStarted:
            return "notStarted";
        default:
            return "stopped";
    }
}
