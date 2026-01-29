/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { RingBuffer } from "./ringBuffer";
import { EventRow, Filter, SessionType, SessionState, ViewTemplate } from "./profilerTypes";
import { ProfilerService } from "../services/profilerService";
import { ProfilingSessionType } from "../models/contracts/profiler";

/**
 * Default event buffer capacity
 */
const DEFAULT_BUFFER_CAPACITY = 10000;

/**
 * Fields to index for fast filtering
 */
const INDEXED_FIELDS = ["eventClass", "databaseName", "spid"];

/**
 * Configuration options for creating a profiler session
 */
export interface ProfilerSessionOptions {
    /** Unique identifier for the session */
    id: string;
    /** Connection URI for the session */
    ownerUri: string;
    /** Display name for the session */
    sessionName: string;
    /** Type of session (file or live) */
    sessionType: SessionType;
    /** Name of the profiler template used */
    templateName: string;
    /** View configuration for displaying events */
    viewConfig?: ViewTemplate;
    /** Whether the session is read-only */
    readOnly?: boolean;
    /** Maximum number of events to buffer */
    bufferCapacity?: number;
}

/**
 * Result from starting profiling
 */
export interface StartProfilerResult {
    /** Unique session ID from server */
    uniqueSessionId: string;
    /** Whether the session can be paused */
    canPause: boolean;
}

/**
 * Represents a profiler session that captures and stores SQL Server events.
 * Handles RPC communication with the SQL Tools Service for profiling operations.
 */
export class ProfilerSession {
    /** Unique identifier for this session */
    public readonly id: string;

    /** Connection URI associated with this session */
    public readonly ownerUri: string;

    /** Display name for the session */
    public readonly sessionName: string;

    /** Type of session (file or live) */
    public readonly sessionType: SessionType;

    /** Name of the profiler template used */
    public readonly templateName: string;

    /** Event buffer */
    public readonly events: RingBuffer<EventRow>;

    /** Active filters applied to the session */
    public filters: Filter[];

    /** View configuration for displaying events */
    public viewConfig: ViewTemplate;

    /** Timestamp when the session was created */
    public readonly createdAt: number;

    /** Timestamp of the last received event */
    public lastEventTimestamp: number;

    /** Whether the session is read-only */
    public readonly readOnly: boolean;

    /** Unique session ID returned by server when profiling starts */
    public uniqueSessionId: string | undefined;

    /** Whether the session can be paused (determined by server) */
    public canPause: boolean = false;

    /** Current state of the session */
    private _state: SessionState;

    /** Reference to the profiler service for RPC calls */
    private readonly _profilerService: ProfilerService;

    /** Disposable for events available handler */
    private _eventsDisposable: vscode.Disposable | undefined;

    /** Disposable for session stopped handler */
    private _stoppedDisposable: vscode.Disposable | undefined;

    /** Disposable for session created handler */
    private _createdDisposable: vscode.Disposable | undefined;

    /** Callback for when events are received */
    private _onEventsReceived: ((events: EventRow[]) => void) | undefined;

    /** Callback for when events are removed from the ring buffer */
    private _onEventsRemoved: ((events: EventRow[]) => void) | undefined;

    /** Callback for when session is stopped */
    private _onSessionStopped: ((errorMessage?: string) => void) | undefined;
    /** Counter for generating sequential event numbers when service doesn't provide them */
    private _eventNumberCounter: number = 0;
    /**
     * Creates a new ProfilerSession.
     * @param options - Session configuration options
     * @param profilerService - Reference to the profiler service for RPC calls
     */
    constructor(options: ProfilerSessionOptions, profilerService: ProfilerService) {
        this.id = options.id;
        this.ownerUri = options.ownerUri;
        this.sessionName = options.sessionName;
        this.sessionType = options.sessionType;
        this.templateName = options.templateName;
        this.readOnly = options.readOnly ?? false;
        this._profilerService = profilerService;

        // Initialize event buffer with indexed fields
        const capacity = options.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY;
        this.events = new RingBuffer<EventRow>(capacity, INDEXED_FIELDS);

        // Initialize filters
        this.filters = [];

        // Initialize view config
        this.viewConfig = options.viewConfig ?? this.getDefaultViewConfig();

        // Initialize timestamps
        this.createdAt = Date.now();
        this.lastEventTimestamp = 0;

        // Initial state
        this._state = SessionState.Stopped;

        // Register handler for session created notification
        this._createdDisposable = this._profilerService.onSessionCreated(
            this.ownerUri,
            (params) => {
                // Verify this notification is for our session
                if (params.sessionName === this.sessionName) {
                    this.setCreated();
                }
            },
        );
    }

    /**
     * Gets the current state of the session.
     */
    get state(): SessionState {
        return this._state;
    }

    /**
     * Checks if the session is currently running.
     */
    get isRunning(): boolean {
        return this._state === SessionState.Running;
    }

    /**
     * Checks if the session is currently paused.
     */
    get isPaused(): boolean {
        return this._state === SessionState.Paused;
    }

    /**
     * Checks if the session is currently stopped.
     */
    get isStopped(): boolean {
        return this._state === SessionState.Stopped;
    }

    /**
     * Checks if the session is currently being created.
     */
    get isCreating(): boolean {
        return this._state === SessionState.Creating;
    }

    /**
     * Checks if the session has failed.
     */
    get isFailed(): boolean {
        return this._state === SessionState.Failed;
    }

    /** Error message if the session failed */
    private _errorMessage: string | undefined;

    /**
     * Gets the error message if the session failed.
     */
    get errorMessage(): string | undefined {
        return this._errorMessage;
    }

    /**
     * Sets a callback for when events are received.
     */
    onEventsReceived(callback: (events: EventRow[]) => void): void {
        this._onEventsReceived = callback;
    }

    /**
     * Sets a callback for when events are removed from the ring buffer.
     */
    onEventsRemoved(callback: (events: EventRow[]) => void): void {
        this._onEventsRemoved = callback;
    }

    /**
     * Sets a callback for when the session is stopped.
     */
    onSessionStopped(callback: (errorMessage?: string) => void): void {
        this._onSessionStopped = callback;
    }

    /**
     * Starts the profiling session on the server.
     * Registers event handlers and begins receiving events.
     * @returns Result containing unique session ID and pause capability
     */
    async startProfiling(): Promise<StartProfilerResult> {
        // Clean up previous handlers if any
        this._eventsDisposable?.dispose();
        this._stoppedDisposable?.dispose();

        // Register for events
        this._eventsDisposable = this._profilerService.onEventsAvailable(
            this.ownerUri,
            (params) => {
                // Convert and add events to buffer
                const convertedEvents = params.events.map((event) =>
                    this.convertProfilerEvent(event),
                );
                const addedEvents = this.addEvents(convertedEvents);

                // Notify callback if registered
                if (this._onEventsReceived) {
                    this._onEventsReceived(addedEvents);
                }
            },
        );

        // Register for session stopped
        this._stoppedDisposable = this._profilerService.onSessionStopped(
            this.ownerUri,
            (params) => {
                this._state = SessionState.Stopped;
                this.events.setPaused(true);

                if (this._onSessionStopped) {
                    this._onSessionStopped(params.errorMessage);
                }
            },
        );

        // Determine profiling session type from SessionType
        const profilingType =
            this.sessionType === SessionType.File
                ? ProfilingSessionType.LocalFile
                : ProfilingSessionType.RemoteSession;

        // Start profiling via RPC
        const result = await this._profilerService.startProfiling(
            this.ownerUri,
            this.sessionName,
            profilingType,
        );

        // Update state
        this._state = SessionState.Running;
        this.events.setPaused(false);
        this.uniqueSessionId = result.uniqueSessionId;
        this.canPause = result.canPause;

        return {
            uniqueSessionId: result.uniqueSessionId,
            canPause: result.canPause,
        };
    }

    /**
     * Pauses the profiling session.
     * Stops receiving events but server session continues.
     * @returns True if the session is now paused
     */
    async pauseProfiling(): Promise<boolean> {
        const result = await this._profilerService.pauseProfiling(this.ownerUri);

        if (result.isPaused) {
            this._state = SessionState.Paused;
            this.events.setPaused(true);
        } else {
            this._state = SessionState.Running;
            this.events.setPaused(false);
        }

        return result.isPaused;
    }

    /**
     * Resumes a paused profiling session.
     * @returns True if the session is now running
     */
    async resumeProfiling(): Promise<boolean> {
        const result = await this._profilerService.pauseProfiling(this.ownerUri);

        if (!result.isPaused) {
            this._state = SessionState.Running;
            this.events.setPaused(false);
        }

        return !result.isPaused;
    }

    /**
     * Toggles the pause state of the session.
     * @returns True if the session is now paused, false if resumed
     */
    async togglePause(): Promise<boolean> {
        const result = await this._profilerService.pauseProfiling(this.ownerUri);

        if (result.isPaused) {
            this._state = SessionState.Paused;
            this.events.setPaused(true);
        } else {
            this._state = SessionState.Running;
            this.events.setPaused(false);
        }

        return result.isPaused;
    }

    /**
     * Stops the profiling session and the server-side session.
     */
    async stopProfiling(): Promise<void> {
        await this._profilerService.stopProfiling(this.ownerUri);

        this._state = SessionState.Stopped;
        this.events.setPaused(true);

        // Clean up handlers
        this._eventsDisposable?.dispose();
        this._stoppedDisposable?.dispose();
        this._eventsDisposable = undefined;
        this._stoppedDisposable = undefined;
    }

    /**
     * Disconnects from the profiling session without stopping the server session.
     */
    async disconnect(): Promise<void> {
        await this._profilerService.disconnectSession(this.ownerUri);

        this._state = SessionState.Stopped;
        this.events.setPaused(true);

        // Clean up handlers
        this._eventsDisposable?.dispose();
        this._stoppedDisposable?.dispose();
        this._eventsDisposable = undefined;
        this._stoppedDisposable = undefined;
    }

    /**
     * Sets the session state to running (local state only, no RPC).
     */
    start(): void {
        this._state = SessionState.Running;
        this.events.setPaused(false);
    }

    /**
     * Sets the session state to paused (local state only, no RPC).
     */
    pause(): void {
        this._state = SessionState.Paused;
        this.events.setPaused(true);
    }

    /**
     * Sets the session state to stopped (local state only, no RPC).
     */
    stop(): void {
        this._state = SessionState.Stopped;
        this.events.setPaused(true);
    }

    /**
     * Sets the session state to creating (waiting for server confirmation).
     */
    setCreating(): void {
        this._state = SessionState.Creating;
        this._errorMessage = undefined;
    }

    /**
     * Sets the session state to stopped after successful creation on server.
     * Called when onSessionCreated notification is received.
     */
    setCreated(): void {
        this._state = SessionState.Stopped;
        this._errorMessage = undefined;
    }

    /**
     * Sets the session state to failed with an optional error message.
     * @param error - Optional error message describing the failure
     */
    setFailed(error?: string): void {
        this._state = SessionState.Failed;
        this._errorMessage = error;
        this.events.setPaused(true);
    }

    /**
     * Adds an event to the session's event buffer.
     * @param event - The event to add (must have id and eventNumber from library)
     * @returns Object containing the added event and removed event (if any), or undefined if paused
     */
    addEvent(event: EventRow): { added: EventRow; removed?: EventRow } | undefined {
        const result = this.events.add(event);
        if (result) {
            this.lastEventTimestamp = result.added.timestamp.getTime();
        }
        return result;
    }

    /**
     * Adds multiple events to the session's event buffer.
     * @param events - The events to add
     * @returns Array of added events
     */
    addEvents(events: EventRow[]): EventRow[] {
        const added: EventRow[] = [];
        const removed: EventRow[] = [];

        for (const event of events) {
            const result = this.addEvent(event);
            if (result) {
                added.push(result.added);
                if (result.removed) {
                    removed.push(result.removed);
                }
            }
        }

        // Notify about removed events if any
        if (removed.length > 0 && this._onEventsRemoved) {
            this._onEventsRemoved(removed);
        }

        return added;
    }

    /**
     * Clears all events from the buffer.
     */
    clearEvents(): void {
        this.events.clear();
        this.lastEventTimestamp = 0;
    }

    /**
     * Clears events from the buffer up to the specified count.
     * Used when the webview wants to clear only the events it has displayed.
     * @param count - Number of events to remove from the beginning of the buffer
     */
    clearEventsRange(count: number): void {
        this.events.clearRange(count);
    }

    /**
     * Gets the number of events in the buffer.
     */
    get eventCount(): number {
        return this.events.size;
    }

    /**
     * Sets the active filters for querying events.
     * @param filters - The filters to apply
     */
    setFilters(filters: Filter[]): void {
        this.filters = filters;
    }

    /**
     * Adds a filter to the active filters.
     * @param filter - The filter to add
     */
    addFilter(filter: Filter): void {
        this.filters.push(filter);
    }

    /**
     * Clears all active filters.
     */
    clearFilters(): void {
        this.filters = [];
    }

    /**
     * Disposes of the session and cleans up resources.
     * If the session is running, stops it first to clean up server-side XEvent session.
     */
    async dispose(): Promise<void> {
        // Stop profiling if session is running to clean up server-side XEvent session
        if (this.isRunning) {
            try {
                await this.stopProfiling();
            } catch (e) {
                // Log but don't throw - we still want to clean up client resources
                console.error(`Error stopping profiling session during dispose: ${e}`);
            }
        }

        this._eventsDisposable?.dispose();
        this._stoppedDisposable?.dispose();
        this._createdDisposable?.dispose();
        this._eventsDisposable = undefined;
        this._stoppedDisposable = undefined;
        this._createdDisposable = undefined;
    }

    /**
     * Converts a profiler event from the RPC response to an EventRow.
     */
    private convertProfilerEvent(event: {
        id?: string;
        eventNumber?: number;
        name: string;
        timestamp: string;
        values: Record<string, string>;
    }): EventRow {
        // Generate id and eventNumber if not provided by SQL Tools Service
        // Try to get event_number from values field first, then use counter as fallback
        const id = event.id || uuidv4();
        const eventNumberFromValues = event.values["event_sequence"]
            ? parseInt(event.values["event_sequence"], 10)
            : undefined;
        const eventNumber =
            event.eventNumber ?? eventNumberFromValues ?? this._eventNumberCounter++;

        return {
            id,
            eventNumber,
            timestamp: new Date(event.timestamp),
            eventClass: event.name,
            textData: event.values["sql_text"] || event.values["statement"] || "",
            databaseName: event.values["database_name"] || "",
            spid: this.parseOptionalInt(event.values["session_id"]),
            duration: this.parseOptionalInt(event.values["duration"]),
            cpu: this.parseOptionalInt(event.values["cpu_time"]),
            reads: this.parseOptionalInt(event.values["logical_reads"]),
            writes: this.parseOptionalInt(event.values["writes"]),
            additionalData: event.values,
        };
    }

    /**
     * Parses a string value to an integer, returning undefined if the value is empty or not a valid number.
     */
    private parseOptionalInt(value: string | undefined): number | undefined {
        if (!value || value.trim() === "") {
            return undefined;
        }
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? undefined : parsed;
    }

    /**
     * Gets the default view configuration.
     */
    private getDefaultViewConfig(): ViewTemplate {
        return {
            id: "Default",
            name: "Default",
            columns: [
                {
                    field: "eventNumber",
                    header: "Event #",
                    width: 80,
                    eventsMapped: ["event_sequence"],
                },
                { field: "eventClass", header: "Event Class", width: 150, eventsMapped: ["name"] },
                {
                    field: "textData",
                    header: "Text Data",
                    width: 400,
                    eventsMapped: ["options_text", "batch_text", "statement"],
                },
                {
                    field: "databaseName",
                    header: "Database",
                    width: 120,
                    eventsMapped: ["database_name"],
                },
                { field: "spid", header: "SPID", width: 60, eventsMapped: ["session_id"] },
                {
                    field: "duration",
                    header: "Duration (μs)",
                    width: 100,
                    eventsMapped: ["duration"],
                },
                { field: "cpu", header: "CPU (ms)", width: 80, eventsMapped: ["cpu_time"] },
                { field: "reads", header: "Reads", width: 80, eventsMapped: ["logical_reads"] },
                { field: "writes", header: "Writes", width: 80, eventsMapped: ["writes"] },
                {
                    field: "timestamp",
                    header: "Timestamp",
                    width: 150,
                    eventsMapped: ["timestamp"],
                },
            ],
        };
    }

    /**
     * Serializes the session to a JSON-compatible object.
     */
    toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            ownerUri: this.ownerUri,
            sessionName: this.sessionName,
            sessionType: this.sessionType,
            templateName: this.templateName,
            state: this._state,
            eventCount: this.events.size,
            filters: this.filters,
            viewConfig: this.viewConfig,
            createdAt: this.createdAt,
            lastEventTimestamp: this.lastEventTimestamp,
            readOnly: this.readOnly,
            uniqueSessionId: this.uniqueSessionId,
            canPause: this.canPause,
        };
    }
}
