/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    ProfilerWebviewState,
    ProfilerReducers,
    ProfilerGridRow,
    ProfilerViewConfig,
    FetchRowsResponse,
    ProfilerNotifications,
    NewEventsAvailableParams,
    RowsRemovedParams,
} from "../sharedInterfaces/profiler";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getProfilerConfigService } from "./profilerConfigService";
import { ProfilerSessionManager } from "./profilerSessionManager";
import { ProfilerSession } from "./profilerSession";
import { EventRow, SessionState } from "./profilerTypes";
import { Profiler as LocProfiler } from "../constants/locConstants";

/**
 * Events emitted by the profiler webview controller
 */
export interface ProfilerWebviewEvents {
    /** Emitted when pause/resume is requested from the UI */
    onPauseResume?: () => void;
    /** Emitted when stop is requested from the UI */
    onStop?: () => void;
    /** Emitted when create session is requested from the UI */
    onCreateSession?: () => void;
    /** Emitted when start session is requested from the UI */
    onStartSession?: (sessionId: string) => void;
    /** Emitted when view is changed from the UI */
    onViewChange?: (viewId: string) => void;
}

/**
 * Controller for the profiler webview that displays profiler events
 */
export class ProfilerWebviewController extends ReactWebviewPanelController<
    ProfilerWebviewState,
    ProfilerReducers
> {
    private _currentViewId: string;
    private _eventHandlers: ProfilerWebviewEvents = {};
    private _currentSession: ProfilerSession | undefined;
    private _sessionManager: ProfilerSessionManager;
    private _statusBarItem: vscode.StatusBarItem;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        sessionManager: ProfilerSessionManager,
        availableSessions: Array<{ id: string; name: string }> = [],
        sessionName?: string,
        templateId: string = "Standard_OnPrem",
    ) {
        const configService = getProfilerConfigService();
        const template = configService.getTemplate(templateId);
        // Use template's default view, or fall back to first available view
        const defaultViewId =
            template?.defaultView ?? configService.getViews()[0]?.id ?? "Standard View";
        const view = configService.getView(defaultViewId);
        const viewConfig = view
            ? ProfilerWebviewController.toViewConfig(defaultViewId, view)
            : undefined;

        // Get available views and templates for the UI
        const availableViews = configService
            .getViews()
            .map((v) => ProfilerWebviewController.toViewConfig(v.id!, v));
        const availableTemplates = configService.getTemplates().map((t) => ({
            id: t.id!,
            name: t.name,
            description: t.description,
            defaultView: t.defaultView,
        }));

        super(
            context,
            vscodeWrapper,
            "profiler",
            "profiler",
            {
                totalRowCount: 0,
                clearGeneration: 0,
                sessionState: SessionState.NotStarted,
                autoScroll: true,
                sessionName: sessionName,
                templateId: templateId,
                viewId: defaultViewId,
                viewConfig: viewConfig,
                availableViews: availableViews,
                availableTemplates: availableTemplates,
                availableSessions: availableSessions,
            },
            {
                title: sessionName ? `Profiler: ${sessionName}` : "Profiler",
                viewColumn: vscode.ViewColumn.Beside,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_light.svg",
                    ),
                },
            },
        );

        this._sessionManager = sessionManager;
        this._currentViewId = defaultViewId;

        // Create status bar item for session info (unique ID per instance)
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.updateStatusBar();

        // Show/hide status bar based on webview focus
        this.panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }
        });

        // Show status bar if panel starts active
        if (this.panel.active) {
            this._statusBarItem.show();
        }

        this.registerReducers();
    }

    /**
     * Override dispose to stop only this webview's session when closing
     */
    public override dispose(): void {
        // Dispose status bar item
        this._statusBarItem.dispose();

        // Only dispose the session associated with THIS webview, not all sessions
        if (this._currentSession && this._currentSession.isRunning) {
            const sessionName = this._currentSession.sessionName;

            // Show notification that session is being stopped
            vscode.window.showInformationMessage(LocProfiler.stoppingSession(sessionName));

            // Stop and dispose only this session (fire and forget since dispose is sync)
            this._currentSession.dispose().catch((err) => {
                console.error("Error disposing profiler session:", err);
            });
        }

        super.dispose();
    }

    /**
     * Register reducers for webview state updates
     */
    private registerReducers(): void {
        // Handle pause/resume request from webview
        this.registerReducer("pauseResume", (state) => {
            // Only allow pause/resume if we have a current session
            if (this._currentSession && this._eventHandlers.onPauseResume) {
                this._eventHandlers.onPauseResume();
            }
            return state;
        });

        // Handle stop request from webview
        this.registerReducer("stop", (state) => {
            // Only allow stop if we have a current session
            if (this._currentSession && this._eventHandlers.onStop) {
                this._eventHandlers.onStop();
            }
            return state;
        });

        // Handle create session request from webview
        // Empty templateId/sessionName signals to show quick picks
        this.registerReducer(
            "createSession",
            (state, _payload: { templateId: string; sessionName: string }) => {
                if (this._eventHandlers.onCreateSession) {
                    this._eventHandlers.onCreateSession();
                }
                return state;
            },
        );

        // Handle start session request from webview
        this.registerReducer("startSession", (state, payload: { sessionId: string }) => {
            if (this._eventHandlers.onStartSession) {
                this._eventHandlers.onStartSession(payload.sessionId);
            }
            return state;
        });

        // Handle session selection from webview
        this.registerReducer("selectSession", (state, payload: { sessionId: string }) => {
            return {
                ...state,
                selectedSessionId: payload.sessionId,
            };
        });

        // Handle clear events request from webview (client-side clear)
        this.registerReducer("clearEvents", (state, payload: { localRowCount: number }) => {
            // Clear events from the RingBuffer up to localRowCount (what was displayed)
            // New events that arrived after the clear click will remain in the buffer
            if (this._currentSession) {
                this._currentSession.clearEventsRange(payload.localRowCount);
            }

            // Get remaining events count after clear
            const remainingEvents = this._currentSession?.eventCount ?? 0;

            // Send NewEventsAvailable notification so webview fetches remaining events
            // This is done asynchronously to ensure state update arrives first
            if (remainingEvents > 0) {
                setTimeout(() => {
                    void this.sendNotification(ProfilerNotifications.NewEventsAvailable, {
                        newCount: remainingEvents,
                        totalCount: remainingEvents,
                    } as NewEventsAvailableParams);
                }, 0);
            }

            // Update totalRowCount to reflect remaining events in buffer
            // and increment clearGeneration so webview resets its localRowCount to 0
            return {
                ...state,
                totalRowCount: remainingEvents,
                clearGeneration: (state.clearGeneration ?? 0) + 1,
            };
        });

        // Handle view change request from webview
        this.registerReducer("changeView", (state, payload: { viewId: string }) => {
            this.setView(payload.viewId);
            if (this._eventHandlers.onViewChange) {
                this._eventHandlers.onViewChange(payload.viewId);
            }
            return this.state;
        });

        // Handle auto-scroll toggle from webview
        this.registerReducer("toggleAutoScroll", (state) => {
            return {
                ...state,
                autoScroll: !state.autoScroll,
            };
        });

        // Handle fetch rows request from webview (pull model for infinite scroll)
        this.registerReducer(
            "fetchRows",
            (state, payload: { startIndex: number; count: number }) => {
                // Fetch rows from the RingBuffer and send response
                const response = this.fetchRowsFromBuffer(payload.startIndex, payload.count);
                // Send response to webview via notification
                void this.sendNotification(ProfilerNotifications.RowsAvailable, response);
                return state;
            },
        );

        // Handle row selection from webview - update state with selected event details
        this.registerReducer("selectRow", (state, payload: { rowId: string }) => {
            const selectedEvent = this.handleRowSelection(payload.rowId);
            return {
                ...state,
                selectedEvent,
            };
        });

        // Handle Open in Editor request from embedded details panel
        this.registerReducer(
            "openInEditor",
            async (state, payload: { textData: string; eventName?: string }) => {
                await this.openTextInEditor(payload.textData);
                return state;
            },
        );

        // Handle Copy to Clipboard request from embedded details panel
        this.registerReducer("copyToClipboard", async (state, payload: { text: string }) => {
            await vscode.env.clipboard.writeText(payload.text);
            void vscode.window.showInformationMessage("Copied to clipboard");
            return state;
        });

        // Handle close details panel request
        this.registerReducer("closeDetailsPanel", (state) => {
            return {
                ...state,
                selectedEvent: undefined,
            };
        });
    }

    /**
     * Handle row selection - get event details and return them for state update
     */
    private handleRowSelection(
        rowId: string,
    ): import("../sharedInterfaces/profiler").ProfilerSelectedEventDetails | undefined {
        if (!this._currentSession) {
            return undefined;
        }

        // Find the event in the ring buffer by its ID
        const event = this._currentSession.events.findById(rowId);
        if (!event) {
            return undefined;
        }

        // Build the selected event details using the centralized ProfilerConfigService
        const viewConfig = this._currentSession.viewConfig;
        const selectedEventDetails = getProfilerConfigService().buildEventDetails(
            event,
            viewConfig,
        );

        return selectedEventDetails;
    }

    /**
     * Open text content in a new VS Code editor
     */
    private async openTextInEditor(textData: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument({
                content: textData,
                language: "sql",
            });

            await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                preview: true,
            });
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Failed to open in editor: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Update the status bar with current session info
     */
    private updateStatusBar(): void {
        // Guard against being called during initialization before _statusBarItem or state is created
        if (!this._statusBarItem || !this.state) {
            return;
        }

        const state = this.state;
        const sessionName = state.sessionName;
        const sessionState = state.sessionState;
        // Get count directly from current session's ring buffer if available (source of truth)
        // Otherwise fall back to state (which might be stale)
        const totalRowCount = this._currentSession?.events.size ?? state.totalRowCount ?? 0;

        let statusText = "";

        if (sessionName) {
            statusText = sessionName;

            // Add status indicator
            switch (sessionState) {
                case SessionState.Running:
                    statusText += ` $(circle-filled) ${LocProfiler.stateRunning}`;
                    break;
                case SessionState.Paused:
                    statusText += ` $(debug-pause) ${LocProfiler.statePaused}`;
                    break;
                case SessionState.Stopped:
                    statusText += ` $(stop-circle) ${LocProfiler.stateStopped}`;
                    break;
                default:
                    statusText += ` $(circle-outline) ${LocProfiler.stateNotStarted}`;
            }

            // Add event count
            statusText += ` | ${LocProfiler.eventsCount(totalRowCount)}`;
        } else {
            statusText = LocProfiler.statusBarNoSession;
        }

        this._statusBarItem.text = statusText;
        this._statusBarItem.tooltip = LocProfiler.statusBarTooltip;
    }

    /**
     * Set event handlers for webview actions
     */
    public setEventHandlers(handlers: ProfilerWebviewEvents): void {
        this._eventHandlers = handlers;
    }

    /**
     * Convert a ViewTemplate to ProfilerViewConfig
     */
    private static toViewConfig(
        id: string,
        view: {
            name: string;
            description?: string;
            columns: Array<{
                field: string;
                header: string;
                width?: number;
                sortable?: boolean;
                filterable?: boolean;
            }>;
        },
    ): ProfilerViewConfig {
        return {
            id,
            name: view.name,
            description: view.description,
            columns: view.columns.map((col) => ({
                field: col.field,
                header: col.header,
                width: col.width,
                sortable: col.sortable,
                filterable: col.filterable,
            })),
        };
    }

    /**
     * Set the current session for data access.
     * This enables the pull model where the webview requests data from the session's RingBuffer.
     */
    public setCurrentSession(session: ProfilerSession | undefined): void {
        this._currentSession = session;

        // Update state with the current session ID and its actual state
        if (session) {
            const sessionState = this.getSessionStateFromSession(session);
            this.state = {
                ...this.state,
                currentSessionId: session.id,
                sessionState,
                sessionName: session.sessionName,
                totalRowCount: session.events.size, // Reset to actual buffer size
            };
        } else {
            this.state = {
                ...this.state,
                currentSessionId: undefined,
                sessionState: SessionState.NotStarted,
                sessionName: undefined,
                totalRowCount: 0,
            };
        }
        this.updateStatusBar();
    }

    /**
     * Get the session state from a ProfilerSession, defaulting to NotStarted if not found.
     */
    private getSessionStateFromSession(session: ProfilerSession): SessionState {
        const sessionInfo = this._sessionManager.getSession(session.id);
        return sessionInfo?.state ?? SessionState.NotStarted;
    }

    /**
     * Notify the webview that new events are available.
     * Updates totalRowCount and sends notification to trigger data fetch.
     */
    public notifyNewEvents(newCount: number): void {
        if (!this._currentSession) {
            return;
        }

        const totalCount = this._currentSession.events.size;
        this.state = {
            ...this.state,
            totalRowCount: totalCount,
        };
        this.updateStatusBar();

        // Notify webview of new data availability
        const params: NewEventsAvailableParams = {
            newCount,
            totalCount,
        };
        void this.sendNotification(ProfilerNotifications.NewEventsAvailable, params);
    }

    /**
     * Notify the webview that rows were removed from the ring buffer.
     * Sends row IDs that need to be removed from the grid.
     */
    public notifyRowsRemoved(removedEvents: EventRow[]): void {
        if (!this._currentSession || removedEvents.length === 0) {
            return;
        }

        // Convert removed events to row IDs (using UUID id for synchronization)
        const removedRowIds = removedEvents.map((event) => {
            // The row ID in the grid is the event's UUID id
            return event.id;
        });

        // Update totalRowCount to reflect current buffer size
        this.state = {
            ...this.state,
            totalRowCount: this._currentSession.events.size,
        };
        this.updateStatusBar();

        // Notify webview to remove these rows
        const params: RowsRemovedParams = {
            removedRowIds,
        };
        void this.sendNotification(ProfilerNotifications.RowsRemoved, params);
    }

    /**
     * Fetch rows from the RingBuffer and convert to grid rows.
     * This is the core method for the pull model.
     * Captures buffer size at start for consistency - any new events arriving
     * during fetch will trigger a separate notification cycle.
     */
    private fetchRowsFromBuffer(startIndex: number, count: number): FetchRowsResponse {
        if (!this._currentSession) {
            return {
                rows: [],
                startIndex,
                totalCount: 0,
            };
        }

        // Capture the buffer size at the start for consistency
        // Any new events arriving during this fetch will trigger another notification
        const bufferSize = this._currentSession.events.size;

        // If startIndex is beyond current buffer, return empty
        if (startIndex >= bufferSize) {
            return {
                rows: [],
                startIndex,
                totalCount: bufferSize,
            };
        }

        const configService = getProfilerConfigService();
        let view = configService.getView(this._currentViewId);

        // Fallback to first available view if current view not found
        if (!view) {
            const views = configService.getViews();
            if (views.length > 0) {
                view = views[0];
                this._currentViewId = view.id!;
            } else {
                return {
                    rows: [],
                    startIndex,
                    totalCount: bufferSize,
                };
            }
        }

        // Adjust count to not exceed available rows at time of capture
        const availableCount = Math.min(count, bufferSize - startIndex);

        // Get events from RingBuffer
        const events = this._currentSession.events.getRange(startIndex, availableCount);

        // Convert events to grid rows
        const rows: ProfilerGridRow[] = events.map((event) => {
            // Use UUID id for row synchronization, include eventNumber for display/tracking
            const row = configService.convertEventToViewRow(event, view);
            return row as ProfilerGridRow;
        });

        return {
            rows,
            startIndex,
            totalCount: bufferSize,
        };
    }

    /**
     * Clear all rows from the webview.
     */
    public clearRows(): void {
        this.state = {
            ...this.state,
            totalRowCount: 0,
        };
        this.updateStatusBar();
        // Notify webview to clear its DataView
        void this.sendNotification(ProfilerNotifications.ClearGrid, {});
    }

    /**
     * Set the session state
     */
    public setSessionState(sessionState: SessionState): void {
        // If we have a current session, verify state from the session manager
        if (this._currentSession) {
            const actualState = this.getSessionStateFromSession(this._currentSession);
            this.state = {
                ...this.state,
                sessionState: actualState,
            };
        } else {
            this.state = {
                ...this.state,
                sessionState,
            };
        }
        this.updateStatusBar();
    }

    /**
     * Set the session name
     */
    public setSessionName(sessionName: string): void {
        this.state = {
            ...this.state,
            sessionName,
        };
        this.updateStatusBar();
    }

    /**
     * Change the current view
     */
    public setView(viewId: string): void {
        const configService = getProfilerConfigService();
        const view = configService.getView(viewId);

        if (!view) {
            return;
        }

        this._currentViewId = viewId;
        const viewConfig = ProfilerWebviewController.toViewConfig(viewId, view);

        this.state = {
            ...this.state,
            viewId,
            viewConfig,
        };
    }

    /**
     * Get the current view ID
     */
    public get currentViewId(): string {
        return this._currentViewId;
    }

    /**
     * Get the current session state
     */
    public get sessionState(): SessionState {
        return this.state.sessionState;
    }

    /**
     * Get the current session reference
     */
    public get currentSession(): ProfilerSession | undefined {
        return this._currentSession;
    }

    /**
     * Set the creating session state (shows spinner in UI)
     */
    public setCreatingSession(isCreating: boolean): void {
        this.state = {
            ...this.state,
            isCreatingSession: isCreating,
        };
    }

    /**
     * Update the available sessions list
     */
    public updateAvailableSessions(sessions: Array<{ id: string; name: string }>): void {
        this.state = {
            ...this.state,
            availableSessions: sessions,
        };
    }

    /**
     * Set the selected session ID and optionally auto-select it
     */
    public setSelectedSession(sessionId: string): void {
        this.state = {
            ...this.state,
            selectedSessionId: sessionId,
        };
    }
}
