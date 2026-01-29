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
    FilterClause,
    FilterStateChangedParams,
} from "../sharedInterfaces/profiler";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getProfilerConfigService } from "./profilerConfigService";
import { ProfilerSessionManager } from "./profilerSessionManager";
import { ProfilerSession } from "./profilerSession";
import { EventRow, SessionState, TEMPLATE_ID_STANDARD_ONPREM, FilterOperator } from "./profilerTypes";
import { FilteredBuffer } from "./filteredBuffer";
import { Profiler as LocProfiler } from "../constants/locConstants";
import { ProfilerDetailsPanelViewController } from "./profilerDetailsPanelViewController";
import { ProfilerTelemetry } from "./profilerTelemetry";

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
    /** Emitted when export to CSV is requested from the UI */
    onExportToCsv?: (
        csvContent: string,
        suggestedFileName: string,
        trigger: "manual" | "closePrompt",
    ) => void;
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
    /** Filtered buffer for applying client-side filtering */
    private _filteredBuffer: FilteredBuffer<EventRow> | undefined;
    private _detailsPanelController: ProfilerDetailsPanelViewController | undefined;
    /** Tracks whether the session was stopped before closing (for telemetry) */
    private _wasSessionPreviouslyStopped: boolean = false;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        sessionManager: ProfilerSessionManager,
        availableSessions: Array<{ id: string; name: string }> = [],
        sessionName?: string,
        templateId: string = TEMPLATE_ID_STANDARD_ONPREM,
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
                filteredRowCount: 0,
                clearGeneration: 0,
                sessionState: SessionState.NotStarted,
                autoScroll: true,
                filterState: { enabled: false, clauses: [] },
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
                showRestorePromptAfterClose: false, // Will be set to true when events are captured
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

        // Capture telemetry data before disposing
        const sessionId = this._currentSession?.id;
        const eventCount = this._currentSession?.events?.size ?? 0;
        const wasStopped = this._wasSessionPreviouslyStopped;

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

        // Send telemetry for session closed
        ProfilerTelemetry.sendSessionClosed(sessionId, eventCount, wasStopped);

        super.dispose();
    }

    /**
     * Override showRestorePrompt to show export prompt when there are unexported events.
     * Prompts the user to export or discard captured events before closing.
     * Like VS Code's native "unsaved changes" dialog: Export & Close, Close Without Export, Cancel
     */
    protected override async showRestorePrompt(): Promise<
        | {
              title: string;
              run: () => Promise<void>;
          }
        | undefined
    > {
        const result = await vscode.window.showWarningMessage(
            LocProfiler.unexportedEventsMessage,
            {
                modal: true,
            },
            LocProfiler.exportAndClose,
            LocProfiler.closeWithoutExport,
        );

        if (result === LocProfiler.exportAndClose) {
            // Perform export then allow close
            await this.performExportFromBuffer();
            return undefined; // Allow close
        } else if (result === LocProfiler.closeWithoutExport) {
            // Just close without export
            return undefined; // Allow close
        } else {
            // Cancel button clicked (result is undefined) - restore the panel
            return super.showRestorePrompt();
        }
    }

    /**
     * Generates CSV content from all events in the buffer and performs export.
     * Used by the close prompt to export before closing.
     */
    private async performExportFromBuffer(): Promise<void> {
        if (!this._currentSession || this._currentSession.events.size === 0) {
            return;
        }

        // Get all events from the buffer
        const allEvents = this._currentSession.events.getAllRows();

        if (allEvents.length === 0) {
            return;
        }

        // Get current view config to determine which columns to export
        const viewConfig = this.state.viewConfig;
        if (!viewConfig) {
            return;
        }

        // Generate CSV content
        const csvContent = this.generateCsvFromEvents(allEvents, viewConfig);

        // Generate suggested file name
        const sessionName = this._currentSession.sessionName || "profiler_events";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const suggestedFileName = `${sessionName}_${timestamp}`;

        // Perform export using event handler (triggered by close prompt)
        if (this._eventHandlers.onExportToCsv) {
            await new Promise<void>((resolve) => {
                // Create a temporary handler to know when export is complete
                const originalHandler = this._eventHandlers.onExportToCsv;
                this._eventHandlers.onExportToCsv = async (content, fileName, trigger) => {
                    if (originalHandler) {
                        await originalHandler(content, fileName, trigger);
                    }
                    resolve();
                };
                this._eventHandlers.onExportToCsv(csvContent, suggestedFileName, "closePrompt");
            });
        }
    }

    /**
     * Generates CSV content from events using the current view configuration.
     */
    private generateCsvFromEvents(events: EventRow[], viewConfig: ProfilerViewConfig): string {
        // Get column headers from view config
        const columns = viewConfig.columns;
        const headers = columns.map((col) => `"${col.header.replace(/"/g, '""')}"`);

        // Generate CSV rows
        const rows = events.map((event) => {
            return columns
                .map((col) => {
                    const value = this.getEventFieldValue(event, col.field);
                    // Escape quotes and wrap in quotes
                    const stringValue = String(value).replace(/"/g, '""');
                    return `"${stringValue}"`;
                })
                .join(",");
        });

        // Combine headers and rows
        return [headers.join(","), ...rows].join("\n");
    }

    /**
     * Gets the value of a field from an EventRow.
     * Handles both direct properties and additionalData.
     */
    private getEventFieldValue(event: EventRow, field: string): string | number | undefined {
        // Map common field names to EventRow properties
        switch (field) {
            case "eventNumber":
                return event.eventNumber;
            case "timestamp":
                return event.timestamp?.toISOString() ?? "";
            case "eventClass":
                return event.eventClass ?? "";
            case "textData":
                return event.textData ?? "";
            case "databaseName":
                return event.databaseName ?? "";
            case "spid":
                return event.spid;
            case "duration":
                return event.duration;
            case "cpu":
                return event.cpu;
            case "reads":
                return event.reads;
            case "writes":
                return event.writes;
            default:
                // Check additionalData for other fields
                return event.additionalData?.[field] ?? "";
        }
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
            // Capture event count before clearing for telemetry
            const eventCountBeforeClear = this._currentSession?.eventCount ?? 0;

            // Clear events from the RingBuffer up to localRowCount (what was displayed)
            // New events that arrived after the clear click will remain in the buffer
            if (this._currentSession) {
                this._currentSession.clearEventsRange(payload.localRowCount);
            }

            // Send telemetry for clear data
            ProfilerTelemetry.sendClearData(eventCountBeforeClear);

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
            const newAutoScroll = !state.autoScroll;

            // Send telemetry for auto-scroll toggle
            ProfilerTelemetry.sendAutoScrollToggled(newAutoScroll);

            return {
                ...state,
                autoScroll: newAutoScroll,
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

                // Update filtered count from actual fetch result when filter is active
                if (this._filteredBuffer?.isFilterActive) {
                    this.state = {
                        ...state,
                        filteredRowCount: response.totalCount,
                    };
                    this.updateStatusBar();
                    return this.state;
                }

                return state;
            },
        );

        // Handle apply filter request from webview (client-side only)
        this.registerReducer("applyFilter", (state, payload: { clauses: FilterClause[] }) => {
            if (this._filteredBuffer) {
                this._filteredBuffer.setFilter(payload.clauses);

                // Calculate filtered count using grid row-based filtering
                const filteredCount = this.calculateFilteredCount(payload.clauses);
                const totalCount = this._filteredBuffer.totalCount;

                // Send telemetry for filter applied
                // Summarize filter clauses for telemetry
                const filterSummary = payload.clauses.map((c) => c.field).join(",");
                const filterOperators = payload.clauses.map((c) => c.operator).join(",");
                ProfilerTelemetry.sendFilterApplied(filterSummary, filterOperators);

                // Notify webview of filter change
                void this.sendFilterStateChanged();

                // Notify webview to clear and refetch filtered data
                void this.sendNotification(ProfilerNotifications.ClearGrid, {});

                // After clear, notify of available filtered data
                setTimeout(() => {
                    void this.sendNotification(ProfilerNotifications.NewEventsAvailable, {
                        newCount: filteredCount,
                        totalCount: filteredCount,
                    } as NewEventsAvailableParams);
                }, 0);

                // Update status bar immediately to show filtered count
                this.state = {
                    ...state,
                    filterState: {
                        enabled: payload.clauses.length > 0,
                        clauses: payload.clauses,
                    },
                    totalRowCount: totalCount,
                    filteredRowCount: filteredCount,
                };
                this.updateStatusBar();

                return this.state;
            }
            return state;
        });

        // Handle clear filter request from webview
        this.registerReducer("clearFilter", (state) => {
            if (this._filteredBuffer) {
                this._filteredBuffer.clearFilter();
                const totalCount = this._filteredBuffer.totalCount;

                // Send telemetry for filter cleared
                ProfilerTelemetry.sendFilterCleared();

                // Notify webview of filter change
                void this.sendFilterStateChanged();

                // Notify webview to clear and refetch unfiltered data
                void this.sendNotification(ProfilerNotifications.ClearGrid, {});

                // After clear, notify of all available data
                setTimeout(() => {
                    void this.sendNotification(ProfilerNotifications.NewEventsAvailable, {
                        newCount: totalCount,
                        totalCount: totalCount,
                    } as NewEventsAvailableParams);
                }, 0);

                // Update status bar immediately to show total count
                this.state = {
                    ...state,
                    filterState: { enabled: false, clauses: [] },
                    totalRowCount: totalCount,
                    filteredRowCount: totalCount,
                };
                this.updateStatusBar();

                return this.state;
            }
            return state;
        });

        // Handle row selection from webview - update details panel
        this.registerReducer("selectRow", (state, payload: { rowId: string }) => {
            this.handleRowSelection(payload.rowId);
            return state;
        });

        // Handle export to CSV request from webview (manual trigger from toolbar)
        this.registerReducer(
            "exportToCsv",
            (state, payload: { csvContent: string; suggestedFileName: string }) => {
                // Export is handled asynchronously by the event handler
                if (this._eventHandlers.onExportToCsv) {
                    this._eventHandlers.onExportToCsv(
                        payload.csvContent,
                        payload.suggestedFileName,
                        "manual",
                    );
                }
                return state;
            },
        );
    }

    /**
     * Send filter state changed notification to the webview
     */
    private async sendFilterStateChanged(): Promise<void> {
        if (!this._filteredBuffer) {
            return;
        }

        const params: FilterStateChangedParams = {
            isFilterActive: this._filteredBuffer.isFilterActive,
            clauseCount: this._filteredBuffer.clauses.length,
            totalCount: this._filteredBuffer.totalCount,
            filteredCount: this._filteredBuffer.filteredCount,
        };

        await this.sendNotification(ProfilerNotifications.FilterStateChanged, params);
    }

    /**
     * Handle row selection - get event details and update the details panel
     */
    private handleRowSelection(rowId: string): void {
        if (!this._currentSession || !this._detailsPanelController) {
            return;
        }

        // Find the event in the ring buffer by its ID
        const event = this._currentSession.events.findById(rowId);
        if (!event) {
            return;
        }

        // Build the selected event details using the centralized ProfilerConfigService
        const viewConfig = this._currentSession.viewConfig;
        const selectedEventDetails = getProfilerConfigService().buildEventDetails(
            event,
            viewConfig,
        );

        // Reveal the details panel first (creates the webview if needed)
        // Then update the selected event after the panel is ready
        void this._detailsPanelController.reveal().then(() => {
            // Update the details panel after it's revealed
            this._detailsPanelController?.updateSelectedEvent(selectedEventDetails);
        });
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

        // Get filtered count from state (which is calculated using ProfilerGridRow filtering)
        // Don't use _filteredBuffer.filteredCount as it filters on raw EventRow fields
        const isFilterActive = this._filteredBuffer?.isFilterActive ?? false;
        const filteredRowCount = isFilterActive
            ? (state.filteredRowCount ?? totalRowCount)
            : totalRowCount;

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

            // Add event count (show filtered/total when filter is active)
            if (isFilterActive) {
                statusText += ` | ${LocProfiler.eventsCountFiltered(filteredRowCount, totalRowCount)}`;
            } else {
                statusText += ` | ${LocProfiler.eventsCount(totalRowCount)}`;
            }
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
     * Set the details panel controller for row selection updates
     */
    public setDetailsPanelController(controller: ProfilerDetailsPanelViewController): void {
        this._detailsPanelController = controller;
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
                type?: string;
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
                type: (col.type as "string" | "number" | "datetime") ?? "string",
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
            // Create a filtered buffer wrapping the session's ring buffer
            this._filteredBuffer = new FilteredBuffer(session.events);

            const sessionState = this.getSessionStateFromSession(session);
            this.state = {
                ...this.state,
                currentSessionId: session.id,
                sessionState,
                sessionName: session.sessionName,
                totalRowCount: session.events.size, // Reset to actual buffer size
                filteredRowCount: session.events.size, // Initially unfiltered
                filterState: { enabled: false, clauses: [] }, // Reset filter on session change
            };
        } else {
            this._filteredBuffer = undefined;
            this.state = {
                ...this.state,
                currentSessionId: undefined,
                sessionState: SessionState.NotStarted,
                sessionName: undefined,
                totalRowCount: 0,
                filteredRowCount: 0,
                filterState: { enabled: false, clauses: [] },
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
     * When filter is active, only notifies about events that match the filter.
     */
    public notifyNewEvents(newCount: number): void {
        if (!this._currentSession || !this._filteredBuffer) {
            return;
        }

        const totalCount = this._currentSession.events.size;

        // Calculate filtered count using the same conversion logic as data fetching
        // This ensures consistent filtering on ProfilerGridRow fields
        const filteredCount = this._filteredBuffer.isFilterActive
            ? this.calculateFilteredCount([...this._filteredBuffer.clauses])
            : totalCount;

        this.state = {
            ...this.state,
            totalRowCount: totalCount,
            filteredRowCount: filteredCount,
            hasUnexportedEvents: totalCount > 0, // Mark as having unexported events when we have data
        };
        this.updateStatusBar();

        // When filter is active, notify only about filtered count
        // This ensures the webview only fetches visible (matching) rows
        const effectiveCount = this._filteredBuffer.isFilterActive ? filteredCount : totalCount;

        // Enable close prompt when there are unexported events
        if (totalCount > 0) {
            this.showRestorePromptAfterClose = true;
        }

        // Notify webview of new data availability
        const params: NewEventsAvailableParams = {
            newCount: this._filteredBuffer.isFilterActive ? filteredCount : newCount,
            totalCount: effectiveCount,
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
     * Fetch rows from the buffer and convert to grid rows.
     * This is the core method for the pull model.
     * If filter is active, returns filtered rows; otherwise returns all rows.
     * Captures buffer size at start for consistency.
     */
    private fetchRowsFromBuffer(startIndex: number, count: number): FetchRowsResponse {
        if (!this._currentSession || !this._filteredBuffer) {
            return {
                rows: [],
                startIndex,
                totalCount: 0,
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
                    totalCount: 0,
                };
            }
        }

        // Get all events from the underlying buffer
        const allEvents = this._filteredBuffer.buffer.getAllRows();

        // Convert ALL events to grid rows first (needed for filtering by view column names)
        const allGridRows: ProfilerGridRow[] = allEvents.map((event) => {
            const row = configService.convertEventToViewRow(event, view);
            return row as ProfilerGridRow;
        });

        // Apply filtering to the converted grid rows
        let filteredRows: ProfilerGridRow[];
        if (this._filteredBuffer.isFilterActive) {
            filteredRows = allGridRows.filter((row) => this.matchesFilter(row));
        } else {
            filteredRows = allGridRows;
        }

        const effectiveTotalCount = filteredRows.length;

        // If startIndex is beyond available rows, return empty
        if (startIndex >= effectiveTotalCount) {
            return {
                rows: [],
                startIndex,
                totalCount: effectiveTotalCount,
            };
        }

        // Adjust count to not exceed available rows
        const availableCount = Math.min(count, effectiveTotalCount - startIndex);
        const endIndex = startIndex + availableCount;

        // Get the slice of filtered rows
        const rows = filteredRows.slice(startIndex, endIndex);

        return {
            rows,
            startIndex,
            totalCount: effectiveTotalCount,
        };
    }

    /**
     * Tests if a grid row matches the current filter clauses.
     * All clauses must match (AND logic).
     */
    private matchesFilter(row: ProfilerGridRow): boolean {
        const clauses = this._filteredBuffer?.clauses ?? [];
        for (const clause of clauses) {
            if (!this.evaluateClause(row, clause)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Evaluates a single filter clause against a grid row.
     */
    private evaluateClause(row: ProfilerGridRow, clause: FilterClause): boolean {
        const fieldValue = row[clause.field];
        const typeHint = clause.typeHint;

        switch (clause.operator) {
            case FilterOperator.IsNull:
                // eslint-disable-next-line eqeqeq
                return fieldValue == undefined;

            case FilterOperator.IsNotNull:
                // eslint-disable-next-line eqeqeq
                return fieldValue != undefined;

            case FilterOperator.Equals:
                return this.evaluateEquals(fieldValue, clause.value, typeHint);

            case FilterOperator.NotEquals:
                return !this.evaluateEquals(fieldValue, clause.value, typeHint);

            case FilterOperator.LessThan:
                return this.evaluateComparison(fieldValue, clause.value, typeHint) < 0;

            case FilterOperator.LessThanOrEqual:
                return this.evaluateComparison(fieldValue, clause.value, typeHint) <= 0;

            case FilterOperator.GreaterThan:
                return this.evaluateComparison(fieldValue, clause.value, typeHint) > 0;

            case FilterOperator.GreaterThanOrEqual:
                return this.evaluateComparison(fieldValue, clause.value, typeHint) >= 0;

            case FilterOperator.Contains:
                return this.evaluateContains(fieldValue, clause.value);

            case FilterOperator.NotContains:
                // eslint-disable-next-line eqeqeq
                if (fieldValue == undefined) {
                    return true; // null doesn't contain anything
                }
                return !this.evaluateContains(fieldValue, clause.value);

            case FilterOperator.StartsWith:
                return this.evaluateStartsWith(fieldValue, clause.value);

            case FilterOperator.NotStartsWith:
                // eslint-disable-next-line eqeqeq
                if (fieldValue == undefined) {
                    return true; // null doesn't start with anything
                }
                return !this.evaluateStartsWith(fieldValue, clause.value);

            default:
                return false;
        }
    }

    /**
     * Evaluates equality between field value and filter value (case-insensitive for strings).
     * For dates, compares using the comparison method for more accurate matching.
     */
    private evaluateEquals(
        fieldValue: string | number | null,
        filterValue: string | number | boolean | null | undefined,
        typeHint?: string,
    ): boolean {
        // eslint-disable-next-line eqeqeq
        if (fieldValue == undefined && filterValue == undefined) {
            return true;
        }
        // eslint-disable-next-line eqeqeq
        if (fieldValue == undefined) {
            return false;
        }
        // eslint-disable-next-line eqeqeq
        if (filterValue == undefined) {
            return false;
        }

        // For date/datetime types, use comparison method
        if (typeHint === "date" || typeHint === "datetime") {
            return this.evaluateComparison(fieldValue, filterValue, typeHint) === 0;
        }

        // Auto-detect date if field value looks like a date string
        if (typeof fieldValue === "string" && /^\d{4}-\d{2}-\d{2}[\sT]/.test(fieldValue)) {
            const fieldDate = this.tryParseDate(String(fieldValue));
            const filterDate = this.tryParseDate(String(filterValue));
            if (fieldDate && filterDate) {
                return fieldDate.getTime() === filterDate.getTime();
            }
        }

        // String comparison (case-insensitive)
        if (typeof fieldValue === "string" && typeof filterValue === "string") {
            return fieldValue.toLowerCase() === filterValue.toLowerCase();
        }

        // Number comparison
        if (typeof fieldValue === "number") {
            const numValue =
                typeof filterValue === "number" ? filterValue : parseFloat(String(filterValue));
            if (!isNaN(numValue)) {
                return fieldValue === numValue;
            }
        }

        return String(fieldValue).toLowerCase() === String(filterValue).toLowerCase();
    }

    /**
     * Tries to parse a string as a date. Supports common formats:
     * - "2026-01-21 20:29:10.000" (profiler format)
     * - "2026-01-21T20:29:10.000Z" (ISO 8601)
     * - "2026-01-21" (date only)
     */
    private tryParseDate(value: string): Date | undefined {
        if (!value || typeof value !== "string") {
            return undefined;
        }

        // Try profiler format (space separator, milliseconds)
        // Convert "2026-01-21 20:29:10.000" to "2026-01-21T20:29:10.000Z"
        const profilerMatch = value.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
        if (profilerMatch) {
            const isoString = `${profilerMatch[1]}T${profilerMatch[2]}Z`;
            const date = new Date(isoString);
            if (!isNaN(date.getTime())) {
                return date;
            }
        }

        // Try ISO 8601 format directly
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date;
        }

        return undefined;
    }

    /**
     * Evaluates comparison (numeric or date). Returns -1, 0, or 1.
     * Automatically detects dates based on field format.
     */
    private evaluateComparison(
        fieldValue: string | number | null,
        filterValue: string | number | boolean | null | undefined,
        typeHint?: string,
    ): number {
        // eslint-disable-next-line eqeqeq
        if (fieldValue == undefined) {
            return -1; // null is "less than" everything
        }
        // eslint-disable-next-line eqeqeq
        if (filterValue == undefined) {
            return 1; // field is "greater than" null/undefined filter
        }

        // Try date comparison first if field looks like a date or typeHint is date
        if (typeHint === "date" || typeHint === "datetime") {
            const fieldDate = this.tryParseDate(String(fieldValue));
            const filterDate = this.tryParseDate(String(filterValue));

            if (fieldDate && filterDate) {
                const fieldTime = fieldDate.getTime();
                const filterTime = filterDate.getTime();
                if (fieldTime < filterTime) {
                    return -1;
                }
                if (fieldTime > filterTime) {
                    return 1;
                }
                return 0;
            }
        }

        // Auto-detect date if field value looks like a date string
        if (typeof fieldValue === "string" && /^\d{4}-\d{2}-\d{2}[\sT]/.test(fieldValue)) {
            const fieldDate = this.tryParseDate(String(fieldValue));
            const filterDate = this.tryParseDate(String(filterValue));

            if (fieldDate && filterDate) {
                const fieldTime = fieldDate.getTime();
                const filterTime = filterDate.getTime();
                if (fieldTime < filterTime) {
                    return -1;
                }
                if (fieldTime > filterTime) {
                    return 1;
                }
                return 0;
            }
        }

        // Numeric comparison
        const numFieldValue =
            typeof fieldValue === "number" ? fieldValue : parseFloat(String(fieldValue));
        const numFilterValue =
            typeof filterValue === "number" ? filterValue : parseFloat(String(filterValue));

        if (isNaN(numFieldValue) || isNaN(numFilterValue)) {
            // Fall back to string comparison
            const strField = String(fieldValue).toLowerCase();
            const strFilter = String(filterValue).toLowerCase();
            if (strField < strFilter) {
                return -1;
            }
            if (strField > strFilter) {
                return 1;
            }
            return 0;
        }

        if (numFieldValue < numFilterValue) {
            return -1;
        }
        if (numFieldValue > numFilterValue) {
            return 1;
        }
        return 0;
    }

    /**
     * Evaluates contains (substring match, case-insensitive).
     */
    private evaluateContains(
        fieldValue: string | number | null,
        filterValue: string | number | boolean | null | undefined,
    ): boolean {
        // eslint-disable-next-line eqeqeq
        if (fieldValue == undefined) {
            return false;
        }
        // eslint-disable-next-line eqeqeq
        if (filterValue == undefined || filterValue === "") {
            return true; // Everything contains empty string
        }
        return String(fieldValue).toLowerCase().includes(String(filterValue).toLowerCase());
    }

    /**
     * Evaluates starts with (prefix match, case-insensitive).
     */
    private evaluateStartsWith(
        fieldValue: string | number | null,
        filterValue: string | number | boolean | null | undefined,
    ): boolean {
        // eslint-disable-next-line eqeqeq
        if (fieldValue == undefined) {
            return false;
        }
        // eslint-disable-next-line eqeqeq
        if (filterValue == undefined || filterValue === "") {
            return true; // Everything starts with empty string
        }
        return String(fieldValue).toLowerCase().startsWith(String(filterValue).toLowerCase());
    }

    /**
     * Calculates the count of rows that match the given filter clauses.
     * Converts all events to grid rows and applies the filter.
     */
    private calculateFilteredCount(clauses: FilterClause[]): number {
        if (!this._filteredBuffer || clauses.length === 0) {
            return this._filteredBuffer?.totalCount ?? 0;
        }

        const configService = getProfilerConfigService();
        const view = configService.getView(this._currentViewId);
        if (!view) {
            return this._filteredBuffer.totalCount;
        }

        // Get all events and convert to grid rows
        const allEvents = this._filteredBuffer.buffer.getAllRows();
        const allGridRows: ProfilerGridRow[] = allEvents.map((event) => {
            return configService.convertEventToViewRow(event, view) as ProfilerGridRow;
        });

        // Count rows matching the filter using direct clause evaluation
        let count = 0;
        for (const row of allGridRows) {
            if (this.matchesFilterClauses(row, clauses)) {
                count++;
            }
        }

        return count;
    }

    /**
     * Tests if a grid row matches the given filter clauses.
     * All clauses must match (AND logic).
     */
    private matchesFilterClauses(row: ProfilerGridRow, clauses: FilterClause[]): boolean {
        for (const clause of clauses) {
            if (!this.evaluateClause(row, clause)) {
                return false;
            }
        }
        return true;
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
        // Track when the session is stopped for telemetry on close
        if (sessionState === SessionState.Stopped) {
            this._wasSessionPreviouslyStopped = true;
        }

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
     * Mark that export has been completed successfully.
     * This resets the hasUnexportedEvents flag and updates the lastExportTimestamp.
     */
    public setExportComplete(): void {
        this.state = {
            ...this.state,
            hasUnexportedEvents: false,
            lastExportTimestamp: Date.now(),
        };
        // Disable close prompt since data has been exported
        this.showRestorePromptAfterClose = false;
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
