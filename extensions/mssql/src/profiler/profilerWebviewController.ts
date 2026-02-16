/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { Writable } from "stream";
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
    DistinctValuesResponse,
    ProfilerRequests,
    ColumnType,
    FilterType,
    ProfilerSelectedEventDetails,
} from "../sharedInterfaces/profiler";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getProfilerConfigService } from "./profilerConfigService";
import { ProfilerSessionManager } from "./profilerSessionManager";
import { ProfilerSession } from "./profilerSession";
import {
    EventRow,
    SessionState,
    TEMPLATE_ID_STANDARD_ONPREM,
    FilterState,
    ColumnDataType,
    XelFileInfo,
} from "./profilerTypes";
import { FilteredBuffer } from "./filteredBuffer";
import { Profiler as LocProfiler, msgYes } from "../constants/locConstants";
import { generateCsvContent, generateExportTimestamp } from "./csvUtils";
import { ProfilerTelemetry, CloseWarningUserAction } from "./profilerTelemetry";

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
    /** Emitted when export to CSV is requested from the UI. Returns a stream to write CSV content to. */
    onExportToCsv?: (suggestedFileName: string) => Promise<Writable | undefined>;
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
    /** Persisted filter state per session (keyed by session ID) */
    private _sessionFilterState = new Map<string, FilterState>();
    private _isReadOnly: boolean;
    private _xelFileInfo: XelFileInfo | undefined;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        sessionManager: ProfilerSessionManager,
        availableSessions: Array<{ id: string; name: string }> = [],
        sessionName?: string,
        templateId: string = TEMPLATE_ID_STANDARD_ONPREM,
        isReadOnly: boolean = false,
        xelFileInfo?: XelFileInfo,
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

        // Determine title based on mode
        const title = xelFileInfo
            ? `Profiler: ${xelFileInfo.fileName}`
            : sessionName
              ? `Profiler: ${sessionName}`
              : "Profiler";

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
                filterState: { enabled: false, clauses: [] },
                autoScroll: !isReadOnly, // Disable auto-scroll for read-only file sessions
                sessionName: xelFileInfo?.fileName ?? sessionName,
                templateId: templateId,
                viewId: defaultViewId,
                viewConfig: viewConfig,
                availableViews: availableViews,
                availableTemplates: availableTemplates,
                availableSessions: availableSessions,
                isReadOnly: isReadOnly,
                xelFilePath: xelFileInfo?.filePath,
                xelFileName: xelFileInfo?.fileName,
            },
            {
                title: title,
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
        this._isReadOnly = isReadOnly;
        this._xelFileInfo = xelFileInfo;

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
                this.logger.error("Error disposing profiler session:", err);
            });
        }

        super.dispose();
    }

    /**
     * Override showRestorePrompt to show a simple confirmation when there are captured events.
     * Behaves like an unsaved file: the panel stays open until the user explicitly confirms closure.
     * "Yes" disposes the panel. "No" (or Escape) keeps it open.
     */
    protected override async showRestorePrompt(): Promise<
        | {
              title: string;
              run: () => Promise<void>;
          }
        | undefined
    > {
        const result = await vscode.window.showWarningMessage(
            LocProfiler.closeSessionConfirmation,
            {
                modal: true,
            },
            msgYes,
        );

        if (result === msgYes) {
            // User confirmed – allow close (dispose will handle cleanup)
            // Telemetry: user chose to discard unsaved events
            if (this._currentSession) {
                ProfilerTelemetry.sendCloseWarningShown(
                    this._currentSession.id,
                    this._currentSession.events.size,
                    CloseWarningUserAction.Discarded,
                );
            }
            return undefined;
        } else {
            // User cancelled (Escape / dismissed) – keep the panel open by recreating it
            // Telemetry: user cancelled close
            if (this._currentSession) {
                ProfilerTelemetry.sendCloseWarningShown(
                    this._currentSession.id,
                    this._currentSession.events.size,
                    CloseWarningUserAction.Cancelled,
                );
            }
            return {
                title: "",
                run: async () => {
                    this.createWebviewPanel();
                    this.panel.reveal(vscode.ViewColumn.Beside);
                },
            };
        }
    }

    /**
     * Generates CSV content from events using the current view configuration.
     * Uses shared csvUtils for consistent CSV formatting across the extension.
     * Writes directly to the provided stream for memory efficiency.
     */
    private async generateCsvFromEvents(
        stream: Writable,
        events: EventRow[],
        viewConfig: ProfilerViewConfig,
    ): Promise<void> {
        const columns = viewConfig.columns.map((col) => ({
            field: col.field,
            header: col.header,
        }));

        await generateCsvContent(stream, columns, events, (event, field) =>
            this.getEventFieldValue(event, field),
        );
    }

    /**
     * Gets the value of a field from an EventRow.
     * Handles both direct properties and additionalData.
     * Supports both PascalCase (from view config) and camelCase field names.
     * Returns undefined for missing values so CSV formatter can handle them properly.
     */
    private getEventFieldValue(event: EventRow, field: string): string | number | Date | undefined {
        // Map field names to EventRow properties (case-insensitive)
        switch (field.toLowerCase()) {
            case "eventnumber":
                return event.eventNumber;
            case "timestamp":
            case "starttime":
                // Return Date object for timestamp - formatCsvCell will handle conversion
                return event.timestamp;
            case "eventclass":
                return event.eventClass;
            case "textdata":
                return event.textData;
            case "databasename":
                return event.databaseName;
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
                // Check additionalData for other fields (e.g., ApplicationName, LoginName, etc.)
                return event.additionalData?.[field];
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
            if (!this._filteredBuffer) {
                return state;
            } else {
                this._filteredBuffer.setColumnFilters(payload.clauses);
                const totalCount = this._filteredBuffer.totalCount;
                const filteredCount = this._filteredBuffer.getFilteredCount();

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

                this.state = {
                    ...state,
                    filterState: {
                        enabled: payload.clauses.length > 0,
                        clauses: payload.clauses,
                        quickFilter: this._filteredBuffer.quickFilter,
                    },
                    totalRowCount: totalCount,
                    filteredRowCount: filteredCount,
                };
                this.updateStatusBar();

                // Telemetry: filter applied (column:operator pairs only, never values)
                if (this._currentSession && payload.clauses.length > 0) {
                    ProfilerTelemetry.sendFilterApplied(this._currentSession.id, payload.clauses);
                }

                return this.state;
            }
        });

        // Handle clear filter request from webview
        this.registerReducer("clearFilter", (state) => {
            if (this._filteredBuffer) {
                this._filteredBuffer.clearAllFilters();
                const totalCount = this._filteredBuffer.totalCount;

                // Notify webview of filter change
                void this.sendFilterStateChanged();

                // Notify webview to clear and refetch unfiltered data
                void this.sendNotification(ProfilerNotifications.ClearGrid, {});

                // After clear, notify of all available data, which is total count since filter is cleared
                setTimeout(() => {
                    void this.sendNotification(ProfilerNotifications.NewEventsAvailable, {
                        newCount: totalCount,
                        totalCount: totalCount,
                    } as NewEventsAvailableParams);
                }, 0);

                this.state = {
                    ...state,
                    filterState: { enabled: false, clauses: [], quickFilter: undefined },
                    totalRowCount: totalCount,
                    filteredRowCount: totalCount,
                };
                this.updateStatusBar();

                return this.state;
            }
            return state;
        });

        // Handle get distinct values request from webview (scans unfiltered ring buffer)
        this.onRequest(
            ProfilerRequests.GetDistinctValues,
            async (payload: { field: string }): Promise<DistinctValuesResponse> => {
                if (this._filteredBuffer) {
                    this.updateFilteredBufferConverter();
                    const values = this._filteredBuffer.getDistinctValuesForField(payload.field);
                    return {
                        field: payload.field,
                        values,
                    };
                }
                return { field: payload.field, values: [] };
            },
        );

        // Handle row selection from webview - update state with selected event details
        this.registerReducer("selectRow", (state, payload: { rowId: string }) => {
            state.selectedEvent = this.handleRowSelection(payload.rowId);
            return state;
        });

        // Handle Open in Editor request from embedded details panel
        this.onNotification(
            ProfilerNotifications.OpenInEditor,
            async (params: { textData: string; eventName?: string }) => {
                await this.openTextInEditor(params.textData);
            },
        );

        // Handle Copy to Clipboard request from embedded details panel
        this.onNotification(
            ProfilerNotifications.CopyToClipboard,
            async (params: { text: string }) => {
                await vscode.env.clipboard.writeText(params.text);
                void vscode.window.showInformationMessage(LocProfiler.copiedToClipboard);
            },
        );

        // Handle close details panel request
        this.registerReducer("closeDetailsPanel", (state) => {
            return {
                ...state,
                selectedEvent: undefined,
            };
        });

        // Handle export to CSV request from webview
        // Generate CSV from the RingBuffer (source of truth) rather than from grid data
        // This ensures ALL events in the session buffer are exported
        this.onNotification(ProfilerNotifications.ExportToCsv, async () => {
            if (
                this._currentSession &&
                this._currentSession.events.size > 0 &&
                this.state.viewConfig
            ) {
                const allEvents = this._currentSession.events.getAllRows();
                const viewConfig = this.state.viewConfig;

                // Generate suggested file name with timestamp
                const sessionName =
                    this._currentSession.sessionName || LocProfiler.defaultExportFileName;
                const timestamp = generateExportTimestamp();
                const suggestedFileName = `${sessionName}_${timestamp}`;

                if (this._eventHandlers.onExportToCsv) {
                    try {
                        const stream = await this._eventHandlers.onExportToCsv(suggestedFileName);
                        if (stream) {
                            await this.generateCsvFromEvents(stream, allEvents, viewConfig);
                            stream.end();

                            // Telemetry: export done
                            if (this._currentSession) {
                                this._currentSession.exported = true;
                                ProfilerTelemetry.sendExportDone(
                                    this._currentSession.id,
                                    "csv",
                                    allEvents.length,
                                );
                            }
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.logger.error("Failed to export profiler session to CSV:", error);
                        void vscode.window.showErrorMessage(LocProfiler.exportFailed(errorMessage));
                    }
                }
            }
        });

        // Handle set quick filter request from webview
        this.registerReducer("setQuickFilter", (state, payload: { term: string }) => {
            if (!this._filteredBuffer) {
                return state;
            } else {
                const quickFilter = payload.term.trim();
                const clauses = state.filterState?.clauses ?? [];
                const hasColumnFilters = clauses.length > 0;
                const hasQuickFilter = quickFilter !== "";

                // Delegate quick filter to FilteredBuffer
                this._filteredBuffer.setQuickFilter(hasQuickFilter ? quickFilter : undefined);

                const totalCount = this._filteredBuffer.totalCount;
                const filteredCount = this._filteredBuffer.getFilteredCount();

                // Notify webview to clear and refetch
                void this.sendNotification(ProfilerNotifications.ClearGrid, {});

                setTimeout(() => {
                    void this.sendNotification(ProfilerNotifications.NewEventsAvailable, {
                        newCount: filteredCount,
                        totalCount: filteredCount,
                    } as NewEventsAvailableParams);
                }, 0);

                this.state = {
                    ...state,
                    filterState: {
                        enabled: hasColumnFilters,
                        clauses,
                        quickFilter: hasQuickFilter ? quickFilter : undefined,
                    },
                    totalRowCount: totalCount,
                    filteredRowCount: filteredCount,
                };
                this.updateStatusBar();

                return this.state;
            }
        });
    }

    /**
     * Handle row selection - get event details and return them for state update
     */
    private handleRowSelection(rowId: string): ProfilerSelectedEventDetails | undefined {
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
            filteredCount: this._filteredBuffer.getFilteredCount(),
        };

        await this.sendNotification(ProfilerNotifications.FilterStateChanged, params);
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
                LocProfiler.failedToOpenInEditor(
                    error instanceof Error ? error.message : String(error),
                ),
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
        const isReadOnly = state.isReadOnly ?? this._isReadOnly;
        // Get count directly from current session's ring buffer if available (source of truth)
        const totalRowCount = this._currentSession?.events.size ?? state.totalRowCount ?? 0;

        // Use FilteredBuffer as single source of truth for filter state
        const isFilterActive = this._filteredBuffer?.isFilterActive ?? false;
        const filteredRowCount = isFilterActive
            ? (state.filteredRowCount ?? totalRowCount)
            : totalRowCount;

        let statusText = "";

        if (sessionName) {
            // For read-only file sessions, show file indicator
            if (isReadOnly && state.xelFileName) {
                statusText = LocProfiler.fileSessionLabel(state.xelFileName);
            } else {
                statusText = sessionName;
            }

            // Add status indicator
            if (isReadOnly) {
                statusText += ` $(lock) ${LocProfiler.stateReadOnly}`;
            } else {
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
     * Reveals the webview panel to the foreground
     */
    public revealToForeground(): void {
        this.panel.reveal(vscode.ViewColumn.Beside);
    }

    /**
     * Gets whether this is a read-only session
     */
    public get isReadOnly(): boolean {
        return this._isReadOnly;
    }

    /**
     * Gets the XEL file info if this is a file-based session
     */
    public get xelFileInfo(): XelFileInfo | undefined {
        return this._xelFileInfo;
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
                type?: string;
                width?: number;
                sortable?: boolean;
                filterable?: boolean;
                filterType?: string;
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
                type: (col.type ?? ColumnDataType.String) as ColumnType,
                width: col.width,
                sortable: col.sortable,
                filterable: col.filterable,
                filterType: col.filterType as FilterType | undefined,
            })),
        };
    }

    /**
     * Set the current session for data access.
     * This enables the pull model where the webview requests data from the session's RingBuffer.
     */
    public setCurrentSession(session: ProfilerSession | undefined): void {
        // Persist current session's filter state before switching
        if (this._currentSession) {
            const currentFilterState = this.state.filterState;
            if (currentFilterState) {
                this._sessionFilterState.set(this._currentSession.id, currentFilterState);
            }
        }

        this._currentSession = session;

        // Update state with the current session ID and its actual state
        if (session) {
            // Create a filtered buffer wrapping the session's ring buffer
            this._filteredBuffer = new FilteredBuffer(session.events);

            // Set up a row converter so filtering operates on view-level column names
            this.updateFilteredBufferConverter();

            // Restore persisted filter state for this session, if any
            const savedFilterState = this._sessionFilterState.get(session.id);

            const sessionState = this.getSessionStateFromSession(session);

            if (
                savedFilterState &&
                savedFilterState.enabled &&
                savedFilterState.clauses.length > 0
            ) {
                // Re-apply saved filter to the new buffer
                this._filteredBuffer.setColumnFilters(savedFilterState.clauses);
            }

            // Restore quick filter if present
            if (savedFilterState?.quickFilter) {
                this._filteredBuffer.setQuickFilter(savedFilterState.quickFilter);
            }

            this.state = {
                ...this.state,
                currentSessionId: session.id,
                sessionState,
                sessionName: session.sessionName,
                totalRowCount: session.events.size,
                filteredRowCount: savedFilterState?.enabled
                    ? this._filteredBuffer.filteredCount
                    : session.events.size,
                filterState: savedFilterState ?? { enabled: false, clauses: [] },
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

        // Delegate filtered count calculation to FilteredBuffer
        const hasAnyFilter = this._filteredBuffer.isFilterActive;
        const filteredCount = hasAnyFilter ? this._filteredBuffer.getFilteredCount() : totalCount;

        this.state = {
            ...this.state,
            totalRowCount: totalCount,
            filteredRowCount: filteredCount,
        };
        this.updateStatusBar();

        // When filter is active, notify only about filtered count
        const effectiveCount = hasAnyFilter ? filteredCount : totalCount;

        this.updateStatusBar();

        // Enable close prompt when there are unexported events
        if (totalCount > 0) {
            this.showRestorePromptAfterClose = true;
        }

        // Notify webview of new data availability
        const params: NewEventsAvailableParams = {
            newCount: hasAnyFilter ? filteredCount : newCount,
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
     * Delegates filtering and pagination to FilteredBuffer, then converts
     * the raw EventRows to ProfilerGridRows using the current view config.
     */
    private fetchRowsFromBuffer(startIndex: number, count: number): FetchRowsResponse {
        if (!this._currentSession || !this._filteredBuffer) {
            return {
                rows: [],
                startIndex,
                totalCount: 0,
            };
        }

        // Ensure converter is up to date for filtering
        this.updateFilteredBufferConverter();

        // Get filtered + paginated raw rows and total filtered count from FilteredBuffer
        const filteredRows = this._filteredBuffer.getFilteredRange(startIndex, count);
        const totalCount = this._filteredBuffer.getFilteredCount();

        // Convert raw EventRows to view-specific grid rows
        const configService = getProfilerConfigService();
        const view = configService.getView(this._currentViewId);
        const rows: ProfilerGridRow[] = view
            ? (configService.convertEventsToViewRows(filteredRows, view) as ProfilerGridRow[])
            : (filteredRows as unknown as ProfilerGridRow[]);

        return {
            rows,
            startIndex,
            totalCount,
        };
    }

    /**
     * Updates the row converter on the FilteredBuffer to use the current view.
     * Should be called whenever the view changes or when a session is set.
     */
    private updateFilteredBufferConverter(): void {
        if (!this._filteredBuffer) {
            return;
        }
        const configService = getProfilerConfigService();
        let view = configService.getView(this._currentViewId);
        if (!view) {
            const views = configService.getViews();
            if (views.length > 0) {
                view = views[0];
                this._currentViewId = view.id!;
            } else {
                this._filteredBuffer.setRowConverter(undefined);
                return;
            }
        }
        const viewRef = view;
        this._filteredBuffer.setRowConverter((event) => {
            return configService.convertEventToViewRow(event, viewRef) as Record<string, unknown>;
        });
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
     * Mark that export has been completed successfully.
     * This resets the hasUnexportedEvents flag and updates the lastExportTimestamp.
     * The close confirmation prompt remains active because the session is still running.
     */
    public setExportComplete(): void {
        this.state = {
            ...this.state,
            hasUnexportedEvents: false,
            lastExportTimestamp: Date.now(),
        };
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
