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
    Formatters,
    Formatter,
} from "slickgrid-react";
import { makeStyles } from "@fluentui/react-components";
import { useProfilerSelector } from "./profilerSelector";
import { useProfilerContext } from "./profilerStateProvider";
import { ProfilerToolbar } from "./profilerToolbar";
import { ProfilerFilterDialog } from "./profilerFilterDialog";
import {
    SessionState,
    ProfilerNotifications,
    FetchRowsResponse,
    NewEventsAvailableParams,
    RowsRemovedParams,
    FilterClause,
} from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { locConstants } from "../../common/locConstants";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";

/** Number of rows to fetch per request */
const FETCH_SIZE = 100;

/** Stable empty array to prevent SlickgridReact from resetting DataView on re-renders */
const EMPTY_DATASET: never[] = [];

/** Module-level flag to ensure handlers are registered only once per webview lifecycle */
let notificationHandlersRegistered = false;

/**
 * Formatter for optional numeric fields - shows empty string for undefined/null
 */
const optionalNumberFormatter: Formatter = (_row, _cell, value) => {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
};

/**
 * Fields that should use the timestamp formatter (using built-in Formatters.date with custom format)
 */
const TIMESTAMP_FIELDS = ["timestamp"];

/**
 * Date format for timestamp columns - includes milliseconds using Tempo format tokens
 * Format: YYYY-MM-DD HH:mm:ss.SSS
 */
const TIMESTAMP_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS";

/**
 * Fields that should use the optional number formatter (may be undefined)
 */
const OPTIONAL_NUMBER_FIELDS = ["spid", "duration", "cpu", "reads", "writes"];

/**
 * Gets the appropriate formatter configuration for a field
 * Returns an object with formatter and optional params
 */
function getFormatterConfig(
    field: string,
): { formatter: Formatter; params?: Record<string, unknown> } | undefined {
    if (TIMESTAMP_FIELDS.includes(field)) {
        return {
            formatter: Formatters.date,
            params: { dateFormat: TIMESTAMP_DATE_FORMAT },
        };
    }
    if (OPTIONAL_NUMBER_FIELDS.includes(field)) {
        return { formatter: optionalNumberFormatter };
    }
    return undefined;
}

// Inject SlickGrid styles once
let stylesInjected = false;
function injectSlickGridStyles() {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;
    const styleElement = document.createElement("style");
    styleElement.textContent = slickGridStyles;
    document.head.appendChild(styleElement);
}

export const Profiler: React.FC = () => {
    const classes = useStyles();

    const totalRowCount = useProfilerSelector((s) => s.totalRowCount ?? 0);
    const clearGeneration = useProfilerSelector((s) => s.clearGeneration ?? 0);
    const sessionState = useProfilerSelector((s) => s.sessionState ?? SessionState.NotStarted);
    const viewConfig = useProfilerSelector((s) => s.viewConfig);
    const viewId = useProfilerSelector((s) => s.viewId);
    const availableViews = useProfilerSelector((s) => s.availableViews);
    const availableTemplates = useProfilerSelector((s) => s.availableTemplates);
    const availableSessions = useProfilerSelector((s) => s.availableSessions);
    const selectedSessionId = useProfilerSelector((s) => s.selectedSessionId);
    const autoScroll = useProfilerSelector((s) => s.autoScroll ?? true);
    const isCreatingSession = useProfilerSelector((s) => s.isCreatingSession ?? false);
    const filterState = useProfilerSelector(
        (s) => s.filterState ?? { enabled: false, clauses: [] },
    );

    const isFilterActive = filterState.enabled && filterState.clauses.length > 0;

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
        applyFilter,
        clearFilter,
    } = useProfilerContext();
    const { themeKind, extensionRpc } = useVscodeWebview2();

    const reactGridRef = useRef<SlickgridReactInstance | null>(null);
    const [localRowCount, setLocalRowCount] = useState(0);
    const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
    const [defaultFilterField, setDefaultFilterField] = useState<string | undefined>(undefined);
    const isFetchingRef = useRef(false);
    const pendingFetchRef = useRef<{ startIndex: number; count: number } | null>(null);
    const autoScrollRef = useRef(autoScroll);
    const fetchRowsRef = useRef(fetchRows);
    const lastClearGenerationRef = useRef(clearGeneration);

    // Inject SlickGrid styles on mount
    useEffect(() => {
        injectSlickGridStyles();
    }, []);

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

    /**
     * Opens the filter dialog with the specified column pre-selected
     * @param field The field name of the column to pre-select
     */
    const openFilterForColumn = useCallback((field: string) => {
        setDefaultFilterField(field);
        setIsFilterDialogOpen(true);
    }, []);

    // Store the callback in a ref so we can access it from the grid event handler
    const openFilterForColumnRef = useRef(openFilterForColumn);
    useEffect(() => {
        openFilterForColumnRef.current = openFilterForColumn;
    }, [openFilterForColumn]);

    // Store filter state in ref for access in header cell renderer
    const filterStateRef = useRef(filterState);
    useEffect(() => {
        filterStateRef.current = filterState;
    }, [filterState]);

    // Grid ready callback
    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;

        // Subscribe to header cell rendered event to add filter buttons
        const grid = reactGrid.slickGrid;
        if (grid) {
            grid.onHeaderCellRendered.subscribe((_e, args) => {
                const column = args.column;
                // Only add filter button to filterable columns
                if (column.filterable === false) {
                    return;
                }

                // Check if filter class already added (button already exists)
                if (args.node.classList.contains("slick-header-with-filter")) {
                    return;
                }

                // Add class to enable flexbox layout (same pattern as QueryResult)
                args.node.classList.add("slick-header-with-filter");

                // Add tooltip and aria-label to the column name element
                const columnNameElement = args.node.querySelector(".slick-column-name");
                if (columnNameElement) {
                    const columnName = column.name as string;
                    columnNameElement.setAttribute("title", columnName);
                    columnNameElement.setAttribute("aria-label", columnName);
                }

                // Check if this column has an active filter
                const hasActiveFilter = filterStateRef.current.clauses.some(
                    (clause) => clause.field === column.field,
                );

                // Create filter button (same class as QueryResult for consistent styling)
                const filterButton = document.createElement("button");
                filterButton.id = "filter-btn";
                filterButton.className = `slick-header-filterbutton${hasActiveFilter ? " filtered" : ""}`;
                filterButton.setAttribute("aria-label", locConstants.profiler.filterTooltip);
                filterButton.setAttribute("title", locConstants.profiler.filterTooltip);
                filterButton.tabIndex = -1;

                // Store the field name on the button for the click handler
                const fieldName = column.field as string;
                filterButton.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openFilterForColumnRef.current(fieldName);
                });

                // Append filter button to the header cell (same as QueryResult pattern)
                args.node.appendChild(filterButton);
            });

            // Clean up filter buttons when header cell is destroyed
            grid.onBeforeHeaderCellDestroy.subscribe((_e, args) => {
                const filterButton = args.node.querySelector(".slick-header-filterbutton");
                if (filterButton) {
                    filterButton.remove();
                }
                args.node.classList.remove("slick-header-with-filter");
            });

            // Force re-render of headers after subscribing to the event
            // This is needed because headers may have already been rendered before we subscribed
            const currentColumns = grid.getColumns();
            if (currentColumns.length > 0) {
                grid.setColumns(currentColumns);
            }
        }
    }

    // Update filter button states when filter state changes
    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return;
        }

        // Get all filter buttons and update their filtered state
        const headerContainer = grid.getContainerNode()?.querySelector(".slick-header-columns");
        if (!headerContainer) {
            return;
        }

        const gridColumns = grid.getColumns();
        gridColumns.forEach((column) => {
            const headerCell = headerContainer.querySelector(
                `.slick-header-column[data-id="${column.id}"]`,
            );
            if (!headerCell) {
                return;
            }

            const filterButton = headerCell.querySelector(".slick-header-filterbutton");
            if (!filterButton) {
                return;
            }

            const hasActiveFilter = filterState.clauses.some(
                (clause) => clause.field === column.field,
            );

            if (hasActiveFilter) {
                filterButton.classList.add("filtered");
            } else {
                filterButton.classList.remove("filtered");
            }
        });
    }, [filterState]);

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
                    sortable: false,
                    filterable: true,
                    resizable: true,
                    minWidth: 200,
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                },
            ];
        }

        return [
            ...viewConfig.columns.map((col) => {
                const formatterConfig = getFormatterConfig(col.field);
                return {
                    id: col.field,
                    name: col.header,
                    field: col.field,
                    width: col.width,
                    sortable: false, // Sorting disabled for profiler grid
                    filterable: col.filterable ?? true, // Default to filterable
                    resizable: true,
                    minWidth: 50,
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                    ...(formatterConfig && {
                        formatter: formatterConfig.formatter,
                        ...(formatterConfig.params && { params: formatterConfig.params }),
                    }),
                };
            }),
        ];
    }, [viewConfig]);

    // Re-render headers when columns change (e.g., when view changes)
    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid) {
            return;
        }
        // Force re-render of headers to add filter buttons to new columns
        const currentColumns = grid.getColumns();
        if (currentColumns.length > 0) {
            grid.setColumns(currentColumns);
        }
    }, [columns]);

    // Grid options
    const gridOptions: GridOption = useMemo(
        () => ({
            autoResize: {
                container: "#profilerGridContainer",
                calculateAvailableSizeBy: "container",
            },
            enableAutoResize: true,
            enableCellNavigation: true,
            enableColumnReorder: true,
            enableSorting: false,
            enableFiltering: false,
            enablePagination: false,
            enableColumnPicker: false, // Hide column picker menu
            enableGridMenu: false, // Hide grid menu (hamburger menu)
            enableHeaderMenu: false, // Hide header menu (column hide/show)
            enableAutoTooltip: true, // Enable tooltips to show cell values on hover
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
        void createSession("", ""); // Empty values signal to extension to show quick picks
    };

    const handleSelectSession = (sessionId: string) => {
        selectSession(sessionId);
    };

    const handleStart = () => {
        if (selectedSessionId) {
            void startSession(selectedSessionId);
        }
    };

    const handlePauseResume = () => {
        void pauseResume();
    };

    const handleStop = () => {
        void stop();
    };

    const handleClear = () => {
        clearEvents(localRowCount);
    };

    const handleViewChange = (newViewId: string) => {
        void changeView(newViewId);
    };

    const handleAutoScrollToggle = () => {
        toggleAutoScroll();
    };

    /**
     * Handles opening the filter dialog from the toolbar (no column pre-selected).
     */
    const handleFilter = useCallback(() => {
        setDefaultFilterField(undefined); // Clear any previously set default field
        setIsFilterDialogOpen(true);
    }, []);

    /**
     * Handles applying filter clauses from the filter dialog.
     * @param clauses The filter clauses to apply
     */
    const handleApplyFilter = useCallback(
        (clauses: FilterClause[]) => {
            applyFilter(clauses);
            setIsFilterDialogOpen(false);
            setDefaultFilterField(undefined); // Clear default field after applying
        },
        [applyFilter],
    );

    /**
     * Handles clearing the active filter from the toolbar.
     * Removes all filter clauses and shows all events.
     */
    const handleClearFilter = useCallback(() => {
        clearFilter();
        setIsFilterDialogOpen(false);
        setDefaultFilterField(undefined); // Clear default field after clearing filter
    }, [clearFilter]);

    /**
     * Handles dialog open/close state changes.
     * Clears the default field when dialog is closed.
     */
    const handleFilterDialogOpenChange = useCallback((open: boolean) => {
        setIsFilterDialogOpen(open);
        if (!open) {
            setDefaultFilterField(undefined);
        }
    }, []);

    return (
        <div className={classes.profilerContainer}>
            <ProfilerToolbar
                sessionState={sessionState}
                currentViewId={viewId}
                availableViews={availableViews}
                availableTemplates={availableTemplates}
                availableSessions={availableSessions}
                selectedSessionId={selectedSessionId}
                autoScroll={autoScroll}
                isCreatingSession={isCreatingSession}
                isFilterActive={isFilterActive}
                onNewSession={handleNewSession}
                onSelectSession={handleSelectSession}
                onStart={handleStart}
                onPauseResume={handlePauseResume}
                onStop={handleStop}
                onClear={handleClear}
                onViewChange={handleViewChange}
                onAutoScrollToggle={handleAutoScrollToggle}
                onFilter={handleFilter}
                onClearFilter={handleClearFilter}
            />
            <ProfilerFilterDialog
                columns={viewConfig?.columns ?? []}
                currentClauses={filterState.clauses}
                isOpen={isFilterDialogOpen}
                defaultField={defaultFilterField}
                onOpenChange={handleFilterDialogOpenChange}
                onApplyFilter={handleApplyFilter}
            />
            <div id="profilerGridContainer" className={classes.profilerGridContainer}>
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

// #region Styles

const useStyles = makeStyles({
    profilerContainer: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        padding: "0",
        boxSizing: "border-box",
    },
    profilerToolbar: {
        display: "flex",
        alignItems: "center",
        padding: "4px 8px",
        borderBottom: "1px solid var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-editor-background)",
        flexShrink: 0,
    },
    profilerToolbarViewSelector: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginLeft: "8px",
    },
    profilerToolbarLabel: {
        fontSize: "12px",
        color: "var(--vscode-foreground)",
    },
    profilerToolbarInfo: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginLeft: "auto",
        paddingLeft: "16px",
    },
    profilerToolbarSessionName: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        maxWidth: "200px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    profilerToolbarStatus: {
        fontSize: "12px",
        padding: "2px 8px",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
    },
    profilerToolbarEventCount: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    profilerGridContainer: {
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        padding: "0",
        margin: "8px",
        marginTop: "0",
        width: "calc(100% - 16px)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
    },
});

// Global styles for SlickGrid that need to be injected as CSS
// These use CSS custom properties with --slick- prefix which makeStyles doesn't support well
const slickGridStyles = `
#profilerGrid {
    /* Main grid colors */
    --slick-cell-even-background-color: var(--vscode-editor-background);
    --slick-cell-odd-background-color: var(--vscode-editor-background);
    --slick-row-mouse-hover-color: var(--vscode-list-hoverBackground);
    --slick-cell-selected-color: var(--vscode-list-activeSelectionBackground);
    --slick-cell-text-color: var(--vscode-foreground);
    --slick-grid-header-background: var(--vscode-editor-background);
    --slick-grid-header-text-color: var(--vscode-foreground);
    --slick-grid-header-column-width: auto;
    --slick-header-row-border-color: var(--vscode-panel-border);

    /* Border colors */
    --slick-border-color: var(--vscode-editorWidget-border);
    --slick-cell-border-right: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-top: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-bottom: 1px solid var(--vscode-editorWidget-border);
    --slick-cell-border-left: 0;

    /* Column picker colors */
    --slick-column-picker-background-color: var(--vscode-menu-background);
    --slick-column-picker-item-color: var(--vscode-menu-foreground);
    --slick-column-picker-item-hover-color: var(--vscode-menu-selectionBackground);
    --slick-column-picker-border-color: var(--vscode-menu-border);

    /* Scrollbar colors */
    --slick-scrollbar-background: var(--vscode-scrollbar-background);
    --slick-scrollbar-thumb-background: var(--vscode-scrollbarSlider-background);
    --slick-scrollbar-thumb-hover-background: var(--vscode-scrollbarSlider-hoverBackground);
    --slick-scrollbar-thumb-active-background: var(--vscode-scrollbarSlider-activeBackground);

    flex: 1;
    width: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

/* Hide any sort indicators since sorting is disabled */
#profilerGrid .slick-sort-indicator,
#profilerGrid .slick-sort-indicator-asc,
#profilerGrid .slick-sort-indicator-desc {
    display: none !important;
}

/* Header cell with filter - use flexbox layout (same pattern as QueryResult) */
#profilerGrid .slick-header-column.slick-header-with-filter {
    display: flex;
    align-items: center;
    overflow: hidden;
}

/* Column name should use flex to allow filter button space */
#profilerGrid .slick-header-with-filter .slick-column-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 0;
    min-width: 0;
    margin-bottom: 0;
}

/* Filter button base styling */
#profilerGrid .slick-header-filterbutton {
    background-position: center center;
    background-repeat: no-repeat;
    cursor: pointer;
    display: inline-block;
    width: 16px;
    height: 16px;
    background-size: 14px;
    flex: 0 0 auto;
    margin-left: 4px;
    background-color: transparent;
    border: 0;
    padding: 0;
    opacity: 0.6;
    transition: opacity 0.15s ease;
}

#profilerGrid .slick-header-filterbutton:hover {
    opacity: 1;
}

/* Filter icon (funnel) - dark theme (default) */
#profilerGrid .slick-header-filterbutton {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2048 2048'%3E%3Cpath fill='%23C5C5C5' d='M0 320q0-40 15-75t41-61 61-41 75-15h1664q40 0 75 15t61 41 41 61 15 75q0 82-60 139l-648 618q-14 14-25 30t-19 33q-16 35-16 76v768q0 26-19 45t-45 19q-19 0-35-11l-384-256q-29-19-29-53v-512q0-40-15-76-8-18-19-33t-26-30L60 459Q0 402 0 320zm1920-1q0-26-19-44t-45-19H192q-26 0-45 18t-19 45q0 29 20 47l649 618q47 45 73 106t26 126v478l256 170v-648q0-65 26-126t73-106l649-618q20-18 20-47z'/%3E%3C/svg%3E");
}

/* Filter icon (funnel) - light theme */
.vscode-light #profilerGrid .slick-header-filterbutton {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2048 2048'%3E%3Cpath fill='%23424242' d='M0 320q0-40 15-75t41-61 61-41 75-15h1664q40 0 75 15t61 41 41 61 15 75q0 82-60 139l-648 618q-14 14-25 30t-19 33q-16 35-16 76v768q0 26-19 45t-45 19q-19 0-35-11l-384-256q-29-19-29-53v-512q0-40-15-76-8-18-19-33t-26-30L60 459Q0 402 0 320zm1920-1q0-26-19-44t-45-19H192q-26 0-45 18t-19 45q0 29 20 47l649 618q47 45 73 106t26 126v478l256 170v-648q0-65 26-126t73-106l649-618q20-18 20-47z'/%3E%3C/svg%3E");
}

/* Filtered state - filled funnel icon for dark theme */
#profilerGrid .slick-header-filterbutton.filtered {
    opacity: 1;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2048 2048'%3E%3Cpath fill='%2375BEFF' d='M0 320q0-40 15-75t41-61 61-41 75-15h1664q40 0 75 15t61 41 41 61 15 75q0 82-60 139l-648 618q-14 14-25 29t-20 34q-15 36-15 76v768q0 26-19 45t-45 19q-19 0-35-11l-384-256q-13-8-21-22t-8-31v-512q0-40-15-76-8-18-19-33t-26-30L60 459Q0 402 0 320z'/%3E%3C/svg%3E");
}

/* Filtered state - filled funnel icon for light theme */
.vscode-light #profilerGrid .slick-header-filterbutton.filtered {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2048 2048'%3E%3Cpath fill='%23007ACC' d='M0 320q0-40 15-75t41-61 61-41 75-15h1664q40 0 75 15t61 41 41 61 15 75q0 82-60 139l-648 618q-14 14-25 29t-20 34q-15 36-15 76v768q0 26-19 45t-45 19q-19 0-35-11l-384-256q-13-8-21-22t-8-31v-512q0-40-15-76-8-18-19-33t-26-30L60 459Q0 402 0 320z'/%3E%3C/svg%3E");
}

/* Auto-hide scrollbars when not needed */
#profilerGrid .slick-viewport {
    overflow: auto !important;
}

/* Ensure internal grid structure fills container */
#profilerGrid .slick-pane {
    flex: 1;
}

#profilerGrid .slick-canvas {
    width: 100%;
    height: 100%;
}

/* Hide scrollbars when content fits */
#profilerGrid .slick-viewport::-webkit-scrollbar {
    width: 14px;
    height: 14px;
}

#profilerGrid .slick-viewport::-webkit-scrollbar-track {
    background-color: transparent;
}

#profilerGrid .slick-viewport::-webkit-scrollbar-thumb {
    background-color: var(--vscode-scrollbarSlider-background);
    border-radius: 7px;
    border: 3px solid transparent;
    background-clip: padding-box;
}

#profilerGrid .slick-viewport::-webkit-scrollbar-thumb:hover {
    background-color: var(--vscode-scrollbarSlider-hoverBackground);
}

#profilerGrid .slick-viewport::-webkit-scrollbar-thumb:active {
    background-color: var(--vscode-scrollbarSlider-activeBackground);
}
`;

// #endregion
