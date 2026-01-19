/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ProfilerSession, ProfilerSessionOptions, StartProfilerResult } from "./profilerSession";
import { EventRow, SessionState } from "./profilerTypes";
import { ProfilerService } from "../services/profilerService";
import {
    ProfilerSessionCreatedParams,
    ProfilerSessionTemplate,
} from "../models/contracts/profiler";

/**
 * Manages multiple profiler sessions.
 * Provides centralized session lifecycle management and event routing.
 */
export class ProfilerSessionManager {
    /**
     * Map of session ID to ProfilerSession
     */
    private readonly _sessions: Map<string, ProfilerSession> = new Map();

    /**
     * Map of ownerUri to session ID for quick lookup
     */
    private readonly _ownerUriIndex: Map<string, string> = new Map();

    /**
     * Creates a new ProfilerSessionManager.
     * @param _profilerService - The profiler service for RPC calls
     */
    constructor(private readonly _profilerService: ProfilerService) {}

    /**
     * Gets the sessions map.
     */
    get sessions(): Map<string, ProfilerSession> {
        return this._sessions;
    }

    /**
     * Gets the number of active sessions.
     */
    get sessionCount(): number {
        return this._sessions.size;
    }

    /**
     * Gets the profiler service.
     */
    get profilerService(): ProfilerService {
        return this._profilerService;
    }

    // ============================================================
    // RPC Methods - Interact with SQL Tools Service
    // ============================================================

    /**
     * Gets a list of all XEvent sessions on the server.
     * @param ownerUri - Connection URI identifier
     * @returns Promise containing the list of session names
     */
    async getXEventSessions(ownerUri: string): Promise<string[]> {
        const result = await this._profilerService.getXEventSessions(ownerUri);
        return result.sessions;
    }

    /**
     * Creates a new XEvent session on the server.
     * @param ownerUri - Connection URI identifier
     * @param sessionName - Name for the new session
     * @param template - Session template containing the CREATE EVENT SESSION statement
     * @returns Promise that resolves when the session is created
     */
    async createXEventSession(
        ownerUri: string,
        sessionName: string,
        template: ProfilerSessionTemplate,
    ): Promise<void> {
        await this._profilerService.createXEventSession(ownerUri, sessionName, template);
    }

    /**
     * Registers a handler for session created notifications.
     * @param ownerUri - Connection URI to listen for
     * @param handler - Callback when session is created
     * @returns Disposable to unregister the handler
     */
    onSessionCreated(
        ownerUri: string,
        handler: (params: ProfilerSessionCreatedParams) => void,
    ): vscode.Disposable {
        return this._profilerService.onSessionCreated(ownerUri, handler);
    }

    // ============================================================
    // Session Management - Local state + RPC
    // ============================================================

    /**
     * Creates a new profiler session.
     * @param options - Session configuration options
     * @returns The created ProfilerSession
     * @throws Error if a session with the same ID already exists
     */
    createSession(options: ProfilerSessionOptions): ProfilerSession {
        if (this._sessions.has(options.id)) {
            throw new Error(`Session with ID '${options.id}' already exists`);
        }

        const session = new ProfilerSession(options, this._profilerService);
        this._sessions.set(session.id, session);
        this._ownerUriIndex.set(session.ownerUri, session.id);

        return session;
    }

    /**
     * Starts profiling on a session. Creates a dedicated connection, sets up
     * event handlers, and starts receiving events.
     * @param sessionId - The session ID
     * @returns Result containing unique session ID and pause capability
     * @throws Error if session not found
     */
    async startProfilingSession(sessionId: string): Promise<StartProfilerResult> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }

        return await session.startProfiling();
    }

    /**
     * Pauses profiling on a session (toggle behavior).
     * @param sessionId - The session ID
     * @returns True if the session is now paused
     * @throws Error if session not found
     */
    async pauseProfilingSession(sessionId: string): Promise<boolean> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }

        return await session.pauseProfiling();
    }

    /**
     * Toggles the pause state of a profiling session.
     * @param sessionId - The session ID
     * @returns True if the session is now paused
     * @throws Error if session not found
     */
    async togglePauseProfilingSession(sessionId: string): Promise<boolean> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }

        return await session.togglePause();
    }

    /**
     * Stops profiling on a session (stops server-side session too).
     * @param sessionId - The session ID
     * @throws Error if session not found
     */
    async stopProfilingSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }

        await session.stopProfiling();
    }

    /**
     * Disconnects from a profiling session without stopping the server session.
     * @param sessionId - The session ID
     * @throws Error if session not found
     */
    async disconnectProfilingSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }

        await session.disconnect();
    }

    // ============================================================
    // Event Management
    // ============================================================

    /**
     * Adds an event to a session identified by connection ID (ownerUri).
     * @param connectionId - The ownerUri of the session
     * @param event - The event to add (must have id and eventNumber from library)
     * @returns Object containing added event and removed event (if any), or undefined if session not found or paused
     */
    addEvent(
        connectionId: string,
        event: EventRow,
    ): { added: EventRow; removed?: EventRow } | undefined {
        const session = this.getSessionByOwnerUri(connectionId);
        if (!session) {
            return undefined;
        }
        return session.addEvent(event);
    }

    /**
     * Adds multiple events to a session identified by connection ID.
     * @param connectionId - The ownerUri of the session
     * @param events - The events to add
     * @returns Array of added events
     */
    addEvents(connectionId: string, events: EventRow[]): EventRow[] {
        const session = this.getSessionByOwnerUri(connectionId);
        if (!session) {
            return [];
        }
        return session.addEvents(events);
    }

    // ============================================================
    // Session Lookup
    // ============================================================

    /**
     * Gets a session by its ID.
     * @param sessionId - The session ID
     * @returns The session, or undefined if not found
     */
    getSession(sessionId: string): ProfilerSession | undefined {
        return this._sessions.get(sessionId);
    }

    /**
     * Gets a session by its ownerUri.
     * @param ownerUri - The connection URI
     * @returns The session, or undefined if not found
     */
    getSessionByOwnerUri(ownerUri: string): ProfilerSession | undefined {
        const sessionId = this._ownerUriIndex.get(ownerUri);
        if (!sessionId) {
            return undefined;
        }
        return this._sessions.get(sessionId);
    }

    /**
     * Removes a session from the manager.
     * @param sessionId - The session ID to remove
     * @returns True if the session was removed, false if not found
     */
    async removeSession(sessionId: string): Promise<boolean> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            return false;
        }

        // Dispose the session
        await session.dispose();

        this._ownerUriIndex.delete(session.ownerUri);
        this._sessions.delete(sessionId);
        return true;
    }

    /**
     * Removes a session by its ownerUri.
     * @param ownerUri - The connection URI
     * @returns True if the session was removed, false if not found
     */
    async removeSessionByOwnerUri(ownerUri: string): Promise<boolean> {
        const sessionId = this._ownerUriIndex.get(ownerUri);
        if (!sessionId) {
            return false;
        }
        return this.removeSession(sessionId);
    }

    /**
     * Gets all sessions as an array.
     */
    getAllSessions(): ProfilerSession[] {
        return Array.from(this._sessions.values());
    }

    /**
     * Gets all running sessions.
     */
    getRunningSessions(): ProfilerSession[] {
        return this.getAllSessions().filter((s) => s.isRunning);
    }

    /**
     * Checks if a session exists.
     * @param sessionId - The session ID to check
     */
    hasSession(sessionId: string): boolean {
        return this._sessions.has(sessionId);
    }

    // ============================================================
    // Local State Management (no RPC)
    // ============================================================

    /**
     * Starts a session (local state only, no RPC).
     * @param sessionId - The session ID
     * @throws Error if session not found
     */
    startSession(sessionId: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        session.start();
    }

    /**
     * Pauses a session (local state only, no RPC).
     * @param sessionId - The session ID
     * @throws Error if session not found
     */
    pauseSession(sessionId: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        session.pause();
    }

    /**
     * Stops a session (local state only, no RPC).
     * @param sessionId - The session ID
     * @throws Error if session not found
     */
    stopSession(sessionId: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        session.stop();
    }

    /**
     * Toggles the pause state of a session.
     * @param sessionId - The session ID
     * @returns True if the session is now paused, false if resumed
     * @throws Error if session not found
     */
    togglePauseSession(sessionId: string): boolean {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        if (session.isPaused) {
            session.start();
            return false;
        } else {
            session.pause();
            return true;
        }
    }

    /**
     * Toggles the pause state of a session by ownerUri.
     * @param ownerUri - The connection URI
     * @returns True if the session is now paused, false if resumed
     * @throws Error if session not found
     */
    togglePauseSessionByOwnerUri(ownerUri: string): boolean {
        const session = this.getSessionByOwnerUri(ownerUri);
        if (!session) {
            throw new Error(`Session with ownerUri '${ownerUri}' not found`);
        }
        return this.togglePauseSession(session.id);
    }

    /**
     * Gets the state of a session.
     * @param sessionId - The session ID
     * @returns The session state
     * @throws Error if session not found
     */
    getSessionState(sessionId: string): SessionState {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session '${sessionId}' not found`);
        }
        return session.state;
    }

    // ============================================================
    // Cleanup
    // ============================================================

    /**
     * Stops and removes all sessions.
     */
    async clear(): Promise<void> {
        const disposePromises: Promise<void>[] = [];
        for (const session of this._sessions.values()) {
            disposePromises.push(session.dispose());
        }
        await Promise.all(disposePromises);
        this._sessions.clear();
        this._ownerUriIndex.clear();
    }

    /**
     * Disposes of the manager and all sessions.
     */
    async dispose(): Promise<void> {
        await this.clear();
    }
}
