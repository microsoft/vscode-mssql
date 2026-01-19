/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useMemo, useEffect, useCallback, useState } from "react";
import {
    SlickgridReact,
    SlickgridReactInstance,
    Column,
    GridOption,
} from "slickgrid-react";
import { useProfilerSelector } from "./profilerSelector";
import { useProfilerContext } from "./profilerStateProvider";
import { ProfilerToolbar } from "./profilerToolbar";
import {
    SessionState,
    ProfilerNotifications,
    FetchRowsResponse,
    NewEventsAvailableParams,
    RowsRemovedParams,
} from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";
import "./profilerPage.css";

/** Number of rows to fetch per request */
const FETCH_SIZE = 100;

/** Stable empty array to prevent SlickgridReact from resetting DataView on re-renders */
const EMPTY_DATASET: never[] = [];

/** Module-level flag to ensure handlers are registered only once per webview lifecycle */
let notificationHandlersRegistered = false;

export const ProfilerPage: React.FC = () => {
    const totalRowCount = useProfilerSelector((s) => s.totalRowCount ?? 0);
    const clearGeneration = useProfilerSelector((s) => s.clearGeneration ?? 0);
    const sessionState = useProfilerSelector(
        (s) => s.sessionState ?? SessionState.NotStarted,
    );
    const viewConfig = useProfilerSelector((s) => s.viewConfig);
    const viewId = useProfilerSelector((s) => s.viewId);
    const availableViews = useProfilerSelector((s) => s.availableViews);
    const availableTemplates = useProfilerSelector((s) => s.availableTemplates);
    const availableSessions = useProfilerSelector((s) => s.availableSessions);
    const selectedSessionId = useProfilerSelector((s) => s.selectedSessionId);
    const autoScroll = useProfilerSelector((s) => s.autoScroll ?? true);
    const isCreatingSession = useProfilerSelector((s) => s.isCreatingSession ?? false);

    const {
        pauseResume,
        stop,
        createSession,
        startSession,
        selectSession,
        clearEvents,
        changeView,
        toggleAutoScroll,
        fetchRows,
    } = useProfilerContext();
    const { themeKind, extensionRpc } = useVscodeWebview2();

    const reactGridRef = useRef<SlickgridReactInstance | null>(null);
    const [localRowCount, setLocalRowCount] = useState(0);
    const isFetchingRef = useRef(false);
    const pendingFetchRef = useRef<{ startIndex: number; count: number } | null>(null);
    const autoScrollRef = useRef(autoScroll);
    const fetchRowsRef = useRef(fetchRows);
    const lastClearGenerationRef = useRef(clearGeneration);

    // Keep refs in sync with current values
    useEffect(() => {
        autoScrollRef.current = autoScroll;
    }, [autoScroll]);

    useEffect(() => {
        fetchRowsRef.current = fetchRows;
    }, [fetchRows]);

    // Handle clear when clearGeneration changes (ensures RingBuffer is cleared before we reset local index)
    useEffect(() => {
        if (clearGeneration !== lastClearGenerationRef.current) {
            // Generation changed, meaning a clear happened - now safe to reset local state
            lastClearGenerationRef.current = clearGeneration;
            if (reactGridRef.current?.dataView) {
                reactGridRef.current.dataView.setItems([]);
            }
            setLocalRowCount(0);
            isFetchingRef.current = false;
            pendingFetchRef.current = null;
            // Don't fetch here - NewEventsAvailable notification from extension will handle it
        }
    }, [clearGeneration]);

    // Grid ready callback
    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;
    }

    // Register notification handlers ONCE per webview lifecycle
    useEffect(() => {
        // Use module-level flag to absolutely prevent duplicate registrations
        if (notificationHandlersRegistered) {
            return;
        }
        notificationHandlersRegistered = true;

        // Handle rows received from extension
        extensionRpc.onNotification(
            ProfilerNotifications.RowsAvailable,
            (response: FetchRowsResponse) => {
                isFetchingRef.current = false;

                if (!reactGridRef.current?.dataView) {
                    return;
                }

                const dataView = reactGridRef.current.dataView;
                const grid = reactGridRef.current.slickGrid;

                // Add new rows to the DataView
                if (response.rows.length > 0) {
                    // Filter out duplicates - only add rows that don't already exist
                    const newRows = response.rows.filter((row) => !dataView.getItemById(row.id));

                    if (newRows.length > 0) {
                        // Use beginUpdate/endUpdate to lock the DataView during add
                        dataView.beginUpdate();
                        dataView.addItems(newRows);
                        dataView.endUpdate();

                        const newCount = dataView.getItemCount();
                        setLocalRowCount(newCount);

                        // Auto-scroll if enabled
                        if (autoScrollRef.current && grid) {
                            grid.scrollRowToTop(newCount - 1);
                        }
                    }
                }

                // Process pending fetch if any - recalculate based on current count
                if (pendingFetchRef.current) {
                    const currentCount = dataView.getItemCount();
                    const targetTotalCount = pendingFetchRef.current.count;
                    pendingFetchRef.current = null;

                    // Only fetch if there's still data we don't have
                    const eventsToFetch = targetTotalCount - currentCount;
                    if (eventsToFetch > 0) {
                        fetchRowsRef.current(currentCount, eventsToFetch);
                        isFetchingRef.current = true;
                    }
                }
            },
        );

        // Handle new events notification from extension
        extensionRpc.onNotification(
            ProfilerNotifications.NewEventsAvailable,
            (params: NewEventsAvailableParams) => {
                if (!reactGridRef.current?.dataView) {
                    return;
                }

                const currentCount = reactGridRef.current.dataView.getItemCount();
                const eventsToFetch = params.totalCount - currentCount;

                if (eventsToFetch > 0) {
                    if (isFetchingRef.current) {
                        // Queue the target total - we'll recalculate startIndex when processing
                        pendingFetchRef.current = {
                            startIndex: 0,
                            count: params.totalCount,
                        };
                    } else {
                        fetchRowsRef.current(currentCount, eventsToFetch);
                        isFetchingRef.current = true;
                    }
                }
            },
        );

        // Handle clear grid notification
        extensionRpc.onNotification(ProfilerNotifications.ClearGrid, () => {
            if (reactGridRef.current?.dataView) {
                reactGridRef.current.dataView.setItems([]);
            }
            setLocalRowCount(0);
            isFetchingRef.current = false;
            pendingFetchRef.current = null;
        });

        // Handle rows removed notification (ring buffer overflow)
        extensionRpc.onNotification(
            ProfilerNotifications.RowsRemoved,
            (params: RowsRemovedParams) => {
                if (!reactGridRef.current?.dataView) {
                    return;
                }

                const dataView = reactGridRef.current.dataView;

                // Remove items from DataView by their IDs
                dataView.beginUpdate();
                dataView.deleteItems(params.removedRowIds);
                dataView.endUpdate();

                // Update local row count
                const newCount = dataView.getItemCount();
                setLocalRowCount(newCount);
            },
        );
    }, []);

    // Handle scroll event for infinite scroll
    const handleScroll = useCallback(
        (event: CustomEvent) => {
            const args = event.detail?.args;
            if (!args || !reactGridRef.current?.dataView) {
                return;
            }

            const viewportElm = args.grid.getViewportNode();
            if (!viewportElm) {
                return;
            }

            // Check if scrolled to bottom
            const isAtBottom =
                Math.ceil(viewportElm.offsetHeight + args.scrollTop) >= args.scrollHeight;

            if (isAtBottom && !isFetchingRef.current) {
                const currentCount = reactGridRef.current.dataView.getItemCount();
                // Only fetch if there's more data available
                if (currentCount < totalRowCount) {
                    fetchRows(currentCount, FETCH_SIZE);
                    isFetchingRef.current = true;
                }
            }
        },
        [fetchRows, totalRowCount],
    );

    // Convert view config columns to SlickGrid column definitions
    const columns: Column[] = useMemo(() => {
        if (!viewConfig?.columns) {
            // Default single column if no view config
            return [
                {
                    id: "eventClass",
                    name: "Event",
                    field: "eventClass",
                    sortable: true,
                    filterable: false,
                    resizable: true,
                    minWidth: 200,
                },
            ];
        }

        return [
            ...viewConfig.columns.map((col) => ({
                id: col.field,
                name: col.header,
                field: col.field,
                width: col.width,
                sortable: col.sortable ?? true,
                filterable: col.filterable ?? false,
                resizable: true,
                minWidth: 50,
            })),
        ];
    }, [viewConfig]);

    // Grid options
    const gridOptions: GridOption = useMemo(
        () => ({
            autoResize: {
                container: ".profiler-grid-container",
                calculateAvailableSizeBy: "container",
            },
            enableAutoResize: true,
            enableCellNavigation: true,
            enableColumnReorder: true,
            enableSorting: false,
            enableFiltering: false,
            enablePagination: false,
            rowHeight: 25,
            headerRowHeight: 30,
            showHeaderRow: false,
            forceFitColumns: false,
            darkMode: themeKind === ColorThemeKind.Dark,
        }),
        [themeKind],
    );

    // Toolbar handlers
    const handleNewSession = () => {
        // The extension will handle showing quick picks for template and session name
        // We just need to signal that the user wants to create a new session
        createSession("", ""); // Empty values signal to extension to show quick picks
    };

    const handleSelectSession = (sessionId: string) => {
        selectSession(sessionId);
    };

    const handleStart = () => {
        if (selectedSessionId) {
            startSession(selectedSessionId);
        }
    };

    const handlePauseResume = () => {
        pauseResume();
    };

    const handleStop = () => {
        stop();
    };

    const handleClear = () => {
        clearEvents(localRowCount);
    };

    const handleViewChange = (newViewId: string) => {
        changeView(newViewId);
    };

    const handleAutoScrollToggle = () => {
        toggleAutoScroll();
    };

    return (
        <div className="profiler-container">
            <ProfilerToolbar
                sessionState={sessionState}
                currentViewId={viewId}
                availableViews={availableViews}
                availableTemplates={availableTemplates}
                availableSessions={availableSessions}
                selectedSessionId={selectedSessionId}
                autoScroll={autoScroll}
                isCreatingSession={isCreatingSession}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onStart={handleStart}
                onPauseResume={handlePauseResume}
                onStop={handleStop}
                onClear={handleClear}
                onViewChange={handleViewChange}
                onAutoScrollToggle={handleAutoScrollToggle}
            />
            <div className="profiler-grid-container">
                <SlickgridReact
                    gridId="profilerGrid"
                    columns={columns}
                    options={gridOptions}
                    dataset={EMPTY_DATASET}
                    onReactGridCreated={(e) => reactGridReady(e.detail)}
                    onScroll={handleScroll}
                />
            </div>
        </div>
    );
};
